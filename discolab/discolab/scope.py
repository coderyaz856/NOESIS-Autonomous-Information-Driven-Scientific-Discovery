"""Mode classifier: can this lab execute experiments for a free-text research question?

The lab can only run genetic-algorithm experiments on its pre-registered
hypotheses (population entropy as an early-warning signal for evolutionary-
search stagnation, and entropy-driven mutation control after landscape
shifts). One Muse Spark call with a JSON schema maps the operator's question
onto those hypotheses ('lab' mode). Any other question is still accepted and
runs in 'open' mode (research, hypotheses, protocols; nothing executed). The
model only classifies; it never produces results. The call, its usage and its
cost are recorded with the run.
"""

from __future__ import annotations

import json
import time

import httpx

from .muse import estimate_cost, load_api_key
from .prereg import load_prereg

BASE_URL = "https://api.meta.ai/v1"
MODEL = "muse-spark-1.3"
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["in_scope", "hypotheses", "focus", "reason"],
    "properties": {
        "in_scope": {"type": "boolean"},
        "hypotheses": {"type": "array", "items": {"type": "string"}},
        "focus": {"type": "string"},
        "reason": {"type": "string"},
    },
}


def design_space() -> dict:
    pr = load_prereg()
    return {
        "domain": " ".join(pr["question"].split()),
        "hypotheses": [{"id": h["id"], "statement": " ".join(str(h["statement"]).split())} for h in pr["hypotheses"]],
        "landscapes": pr["landscapes"],
        "experiment_kinds": ["prediction (AUROC of stagnation onset from population features)",
                             "control (recovery after landscape shifts under mutation controllers)"],
    }


def check(question: str, timeout: float = 60.0) -> dict:
    question = " ".join(question.split())
    if not question:
        return {"in_scope": False, "hypotheses": [], "focus": "", "reason": "empty question", "model": None}
    space = design_space()
    system = (
        "You decide whether a research question can be studied by a specific automated lab. The lab can ONLY run "
        "genetic-algorithm simulations that test its pre-registered hypotheses listed below. A question is in scope "
        "only if answering it requires nothing beyond those hypotheses, landscapes and experiment kinds. Questions "
        "about other domains (biology, medicine, finance, other algorithms in general, real-world data) are out of "
        "scope even if they mention entropy or optimisation. Map an in-scope question to the hypothesis ids it "
        "concerns and restate it as a one-sentence focus for the lab. Reply with JSON only.\n\nLAB:\n"
        + json.dumps(space))
    body = {"model": MODEL, "temperature": 0, "seed": 0, "max_tokens": 1500, "reasoning_effort": "low",
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": question}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "scope", "schema": SCHEMA,
                                                                        "strict": True}}}
    t0 = time.time()
    r = httpx.post(f"{BASE_URL}/chat/completions", json=body, timeout=timeout,
                   headers={"Authorization": f"Bearer {load_api_key()}"})
    latency = time.time() - t0
    if r.status_code != 200:
        raise RuntimeError(f"scope check failed: HTTP {r.status_code}")
    data = r.json()
    msg = data["choices"][0]["message"].get("content") or ""
    out = json.loads(msg)
    known = {h["id"] for h in space["hypotheses"]}
    out["hypotheses"] = [h for h in out.get("hypotheses", []) if h in known]
    if out.get("in_scope") and not out["hypotheses"]:
        out["in_scope"] = False
        out["reason"] = (out.get("reason", "") + " (no pre-registered hypothesis matched)").strip()
    u = data.get("usage") or {}
    cached = int((u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
    out.update(model=data.get("model", MODEL), latency_sec=round(latency, 3),
               usage={"input_tokens": u.get("prompt_tokens"), "cached_tokens": cached,
                      "output_tokens": u.get("completion_tokens")},
               cost_usd=estimate_cost(MODEL, int(u.get("prompt_tokens") or 0), cached,
                                      int(u.get("completion_tokens") or 0)))
    return out
