"""Meta Muse Code agent as an AIProvider.

Each `generate` call runs one headless Muse Code agent (`muse exec --json`,
Meta's first-party agent harness) on the Meta Model API and returns its final
answer. The agent has no tools (shell, write, web, MCP all disabled), so a
benchmark call measures the agent harness + model, not tool access.

Protocol notes (recorded in every response's `raw`):
* Muse Code exposes no temperature or max_tokens control; the harness default
  sampling is used and answers are not truncated by the caller.
* Usage comes from the harness `run.usage` event, including cached input
  tokens; `raw["cost_cached_aware_usd"]` prices cached input separately.
"""

from __future__ import annotations

import asyncio
import glob
import json
import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

from ..ai.provider import AIProvider
from ..ai.types import Message, ModelResponse, TokenUsage
from ..core.errors import ProviderError
from .meta import load_meta_api_key

# USD per 1M tokens, Meta Model API Standard mode (checked 2026-11-03).
_PRICES = {
    "muse-spark-1.3": (1.25, 0.15, 4.25), "muse-spark-1.2": (1.25, 0.15, 4.25),
    "muse-spark-1.1": (1.25, 0.15, 4.25), "muse-wonder-1.0": (4.00, 0.20, 20.00),
}


def find_muse() -> str:
    explicit = os.environ.get("MUSE_BIN")
    if explicit and Path(explicit).exists():
        return explicit
    local = os.environ.get("LOCALAPPDATA")
    if local:
        found = sorted(glob.glob(str(Path(local) / "Programs" / "muse" / "muse-bin-*.exe")))
        if found:
            return found[-1]
    which = shutil.which("muse")
    if which:
        return which
    raise ProviderError("Muse Code CLI not found (set MUSE_BIN or install Muse Code)")


def cached_aware_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> float | None:
    price = _PRICES.get(model)
    if price is None:
        return None
    fresh = max(0, input_tokens - cached_tokens)
    return (fresh * price[0] + cached_tokens * price[1] + output_tokens * price[2]) / 1e6


class SpendCeilingReached(BaseException):
    """Raised before an agent call that could cross the run's dollar ceiling.

    A BaseException on purpose: provider wrappers convert ordinary exceptions
    into recorded call failures, which would let a benchmark continue past its
    ceiling. This one stops the run."""


class SpendGuard:
    """Estimated (cached-aware, list-price) spend across all Muse Code agent calls in a process.

    A pre-call guard, not a provider-enforced cap: before each call it refuses if spend so far
    plus the priciest call seen (at least $0.10) would pass the ceiling. Benchmarks run at
    concurrency 1, so only a single call larger than that margin could overshoot."""

    def __init__(self) -> None:
        self.ceiling_usd: float | None = None
        self.spent_usd = 0.0
        self.calls = 0
        self.max_call_usd = 0.0

    def check(self) -> None:
        if self.ceiling_usd is None:
            return
        # Leave room for one more call at least as expensive as the priciest so far.
        if self.spent_usd + max(self.max_call_usd, 0.10) > self.ceiling_usd:
            raise SpendCeilingReached(f"spend ceiling ${self.ceiling_usd:.2f} reached (spent ${self.spent_usd:.4f})")

    def add(self, cost: float | None) -> None:
        cost = float(cost or 0.0)
        self.spent_usd += cost
        self.calls += 1
        self.max_call_usd = max(self.max_call_usd, cost)


SPEND_GUARD = SpendGuard()


class MuseCodeAgentProvider(AIProvider):
    """One Muse Code agent per call. `name` is "muse_agent"."""

    def __init__(self, *, model: str, reasoning_effort: str = "minimal", preset: str = "empty",
                 max_model_steps: int = 2, timeout_seconds: float = 240.0) -> None:
        if not model.strip():
            raise ValueError("an explicit Meta model id is required")
        self.model = model.strip()
        self.reasoning_effort = reasoning_effort
        self.preset = preset
        self.max_model_steps = max_model_steps
        self.timeout_seconds = timeout_seconds
        self._binary = find_muse()

    @property
    def name(self) -> str:
        return "muse_agent"

    async def generate(self, messages: Sequence[Message], **kwargs: Any) -> ModelResponse:
        return await asyncio.to_thread(self._run, list(messages))

    def stream(self, messages: Sequence[Message], **kwargs: Any) -> AsyncIterator[str]:
        async def _once() -> AsyncIterator[str]:
            yield (await self.generate(messages, **kwargs)).content

        return _once()

    def _run(self, messages: list[Message]) -> ModelResponse:
        SPEND_GUARD.check()
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        user = "\n\n".join(m.content for m in messages if m.role != "system")
        prompt = (f"{system.strip()}\n\n## Input\n{user.strip()}\n\n"
                  "Reply with the final answer only.") if system else user
        with tempfile.TemporaryDirectory(prefix="muse-agent-") as tmp:
            work = Path(tmp)
            prompt_file = work / "prompt.md"
            prompt_file.write_text(prompt, encoding="utf-8")
            cmd = [self._binary, "exec", "--json", "--api-key-stdin", "--preset", self.preset,
                   "--model", self.model, "--reasoning-effort", self.reasoning_effort,
                   "--max-model-steps", str(self.max_model_steps),
                   "--disable-shell", "--disable-write", "--disable-web-tools", "--disable-reminders",
                   "--disable-request-user-input", "--disable-approval", "--no-foreign-personal-context",
                   "--no-session-log", "--workspace", str(work), "--prompt-file", str(prompt_file)]
            started = time.perf_counter()
            try:
                proc = subprocess.run(cmd, input=load_meta_api_key() + "\n", capture_output=True, text=True,
                                      encoding="utf-8", errors="replace", cwd=work,
                                      timeout=self.timeout_seconds)
            except subprocess.TimeoutExpired as exc:
                raise ProviderError("Muse Code agent timed out") from exc
            except OSError as exc:
                raise ProviderError(f"Muse Code agent could not start ({type(exc).__name__})") from exc
        latency = time.perf_counter() - started
        text, terminal, reason, models, meta = "", None, None, [], {}
        for line in proc.stdout.splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            pt, pl = ev.get("payload_type", ""), ev.get("payload") or {}
            if pt == "run.usage":
                models = pl.get("models") or []
                meta = {k: pl.get(k) for k in ("calls", "completed_calls", "failed_calls")}
            elif pt.startswith("run.terminal"):
                terminal, text, reason = pl.get("terminal"), pl.get("text") or "", pl.get("reason")
        SPEND_GUARD.add(sum(cached_aware_cost(m.get("model", self.model), int(m.get("input_tokens") or 0),
                                              int(m.get("cached_tokens") or 0),
                                              int(m.get("output_tokens") or 0)) or 0.0 for m in models))
        if proc.returncode != 0 or terminal not in (None, "completed") and not text:
            # Only the exit code and terminal class are kept; stderr can echo environment details.
            raise ProviderError(f"Muse Code agent ended {terminal or 'abnormally'} (exit {proc.returncode})")
        inp = sum(int(m.get("input_tokens") or 0) for m in models)
        cached = sum(int(m.get("cached_tokens") or 0) for m in models)
        out = sum(int(m.get("output_tokens") or 0) for m in models)
        reasoning = sum(int(m.get("reasoning_tokens") or 0) for m in models)
        return ModelResponse(
            content=text.strip(),
            model=self.model,
            usage=TokenUsage(input_tokens=inp, output_tokens=out),
            raw={"harness": "Muse Code", "terminal": terminal, "terminal_reason": reason,
                 "cached_tokens": cached, "reasoning_tokens": reasoning, "model_calls": meta.get("calls"),
                 "failed_model_calls": meta.get("failed_calls"), "agent_seconds": round(latency, 3),
                 "reasoning_effort": self.reasoning_effort, "preset": self.preset,
                 "cost_cached_aware_usd": cached_aware_cost(self.model, inp, cached, out)},
        )
