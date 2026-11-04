"""Meta Model API adapter (Muse Spark / Muse Wonder) over Chat Completions.

Credentials come only from MODEL_API_KEY / META_API_KEY or from the file named
by MODEL_API_KEY_FILE (a bare key or a ``name="value"`` line). The key is never
stored on the response, logged, or returned. Unlike the generic OpenAI
adapter, this one keeps ``finish_reason``, reasoning tokens and cached tokens
in ``ModelResponse.raw`` so truncation (Muse counts reasoning tokens against
``max_tokens``) can be separated from wrong answers in the benchmark.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

import httpx

from ..ai.provider import AIProvider
from ..ai.types import Message, ModelResponse, TokenUsage
from ..core.errors import ProviderError

META_BASE_URL = "https://api.meta.ai/v1"


def load_meta_api_key() -> str:
    for var in ("MODEL_API_KEY", "META_API_KEY"):
        value = os.getenv(var, "").strip()
        if value:
            return value
    path = os.getenv("MODEL_API_KEY_FILE", "").strip()
    if not path:
        raise ValueError("set MODEL_API_KEY, META_API_KEY or MODEL_API_KEY_FILE")
    lines = [line.strip() for line in Path(path).read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if not lines:
        raise ValueError("the Model API key file is empty")
    raw = lines[0].split("=", 1)[1] if "=" in lines[0] else lines[0]
    key = raw.strip().strip("'\"")
    if not key:
        raise ValueError("the Model API key file has no value")
    return key


class MetaModelAPIProvider(AIProvider):
    def __init__(
        self,
        *,
        model: str,
        base_url: str = META_BASE_URL,
        timeout_seconds: float = 120.0,
        client: httpx.AsyncClient | None = None,
        default_reasoning_effort: str | None = None,
    ) -> None:
        if not model.strip():
            raise ValueError("an explicit Meta model id is required")
        self.model = model.strip()
        self._api_key = load_meta_api_key()
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._client = client
        # Applied when a caller does not pass reasoning_effort. Reasoning tokens count
        # against max_tokens on the Model API, so short-answer protocols need a low setting.
        self._default_reasoning_effort = default_reasoning_effort

    @property
    def name(self) -> str:
        return "meta"

    async def generate(self, messages: Sequence[Message], **kwargs: Any) -> ModelResponse:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": item.role, "content": item.content} for item in messages],
        }
        for key in ("temperature", "max_tokens", "seed", "response_format", "reasoning_effort"):
            if key in kwargs and kwargs[key] is not None:
                payload[key] = kwargs[key]
        if "reasoning_effort" not in payload and self._default_reasoning_effort:
            payload["reasoning_effort"] = self._default_reasoning_effort
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self._timeout_seconds)
        try:
            response = await client.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
            )
            status = response.status_code
            if status != 200:
                raise ProviderError(f"Meta Model API returned HTTP {status}")
            body = response.json()
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"Meta Model API request failed ({type(exc).__name__})") from exc
        finally:
            if owns_client:
                await client.aclose()
        try:
            choice = body["choices"][0]
            usage = body.get("usage") or {}
            details = usage.get("completion_tokens_details") or {}
            prompt_details = usage.get("prompt_tokens_details") or {}
            return ModelResponse(
                content=str(choice["message"].get("content") or ""),
                model=str(body.get("model") or self.model),
                usage=TokenUsage(
                    input_tokens=int(usage.get("prompt_tokens") or 0),
                    output_tokens=int(usage.get("completion_tokens") or 0),
                ),
                raw={
                    "finish_reason": choice.get("finish_reason"),
                    "reasoning_tokens": int(details.get("reasoning_tokens") or 0),
                    "cached_tokens": int(prompt_details.get("cached_tokens") or 0),
                    "response_id": body.get("id"),
                },
            )
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError("Meta Model API returned an invalid response shape") from exc

    def stream(self, messages: Sequence[Message], **kwargs: Any) -> AsyncIterator[str]:
        async def _once() -> AsyncIterator[str]:
            yield (await self.generate(messages, **kwargs)).content

        return _once()
