"""Model clients behind one interface: generate(system, user) -> Reply.

OllamaClient runs local models for free development runs. FakeClient returns scripted replies for
tests. The Anthropic client is added in M4.
"""
from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass, field


@dataclass
class Reply:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    seconds: float = 0.0
    model: str = ""
    extra: dict = field(default_factory=dict)


class OllamaClient:
    """Local model through Ollama's chat API, JSON mode, temperature 0."""

    def __init__(self, model: str, host: str = "http://localhost:11434", timeout: int = 300):
        self.model, self.host, self.timeout = model, host, timeout
        self.name = f"ollama:{model}"

    def generate(self, system: str, user: str, max_tokens: int = 600) -> Reply:
        body = {"model": self.model, "stream": False, "format": "json",
                "options": {"temperature": 0, "num_predict": max_tokens, "num_ctx": 8192},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        req = urllib.request.Request(f"{self.host}/api/chat", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            d = json.loads(resp.read())
        return Reply(d["message"]["content"], d.get("prompt_eval_count", 0), d.get("eval_count", 0),
                     time.perf_counter() - t0, self.name)


# USD per million tokens, from Anthropic's model table (cached 2026-11-03). Batch API: 50% of these.
PRICES = {"claude-haiku-5-5": (0.10, 0.50), "claude-sonnet-5-5": (2.00, 10.00), "claude-opus-5-5": (4.00, 20.00)}

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["answered", "not_found"]},
        "answer": {"type": "string"},
        "citations": {"type": "array", "items": {
            "type": "object",
            "properties": {"passage": {"type": "integer"}, "quote": {"type": "string"}},
            "required": ["passage", "quote"], "additionalProperties": False}},
    },
    "required": ["status", "answer", "citations"],
    "additionalProperties": False,
}


def thinking_off(model: str) -> dict:
    """Grounded lookup needs no thinking, and thinking tokens are billed. Sonnet 5.5 rejects
    "disabled" and turns thinking off with "between_tools"; Haiku accepts "disabled" at effort <= high."""
    return {"type": "between_tools"} if model.startswith("claude-sonnet-5-5") else {"type": "disabled"}


def request_params(model: str, system: str, user: str, max_tokens: int = 600) -> dict:
    """The Messages API request, shared by real-time calls and the Batch API."""
    return {"model": model, "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": user}],
            "thinking": thinking_off(model),
            "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": ANSWER_SCHEMA}}}


def cost_usd(model: str, input_tokens: int, output_tokens: int, batch: bool = False) -> float:
    pin, pout = PRICES[model]
    return (input_tokens * pin + output_tokens * pout) / 1e6 * (0.5 if batch else 1.0)


class AnthropicClient:
    """Claude through the official SDK. Reads ANTHROPIC_API_KEY (or an `ant auth login` profile)."""

    def __init__(self, model: str, sdk_client=None):
        if model not in PRICES:
            raise ValueError(f"no price recorded for {model!r}")
        if sdk_client is None:
            import anthropic
            sdk_client = anthropic.Anthropic()
        self.model, self.sdk, self.name = model, sdk_client, f"anthropic:{model}"

    def generate(self, system: str, user: str, max_tokens: int = 600) -> Reply:
        t0 = time.perf_counter()
        msg = self.sdk.messages.create(**request_params(self.model, system, user, max_tokens))
        text = "" if msg.stop_reason == "refusal" else next((b.text for b in msg.content if b.type == "text"), "")
        u = msg.usage
        return Reply(text, u.input_tokens, u.output_tokens, time.perf_counter() - t0, self.name,
                     {"stop_reason": msg.stop_reason, "cost_usd": cost_usd(self.model, u.input_tokens, u.output_tokens)})


class FakeClient:
    """Returns the given replies in order; for tests."""

    def __init__(self, replies: list[str]):
        self.replies = list(replies)
        self.name = "fake"
        self.calls: list[tuple[str, str]] = []

    def generate(self, system: str, user: str, max_tokens: int = 600) -> Reply:
        self.calls.append((system, user))
        return Reply(self.replies.pop(0), 100, 20, 0.0, "fake")
