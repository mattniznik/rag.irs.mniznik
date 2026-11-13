import json
import os
from types import SimpleNamespace

import pytest

from cite_or_abstain import models


class StubMessages:
    def __init__(self, text, stop_reason="end_turn", usage=(2000, 80)):
        self.text, self.stop_reason, self.usage, self.sent = text, stop_reason, usage, None

    def create(self, **params):
        self.sent = params
        return SimpleNamespace(stop_reason=self.stop_reason,
                               content=[SimpleNamespace(type="text", text=self.text)],
                               usage=SimpleNamespace(input_tokens=self.usage[0], output_tokens=self.usage[1]))


def client_with(stub, model="claude-haiku-5-5"):
    return models.AnthropicClient(model, sdk_client=SimpleNamespace(messages=stub))


def test_request_turns_thinking_off_the_way_each_model_accepts():
    assert models.request_params("claude-haiku-5-5", "s", "u")["thinking"] == {"type": "disabled"}
    assert models.request_params("claude-sonnet-5-5", "s", "u")["thinking"] == {"type": "between_tools"}


def test_request_asks_for_low_effort_and_the_answer_schema_and_no_sampling_params():
    p = models.request_params("claude-haiku-5-5", "s", "u")
    assert p["output_config"]["effort"] == "low"
    assert p["output_config"]["format"]["schema"]["required"] == ["status", "answer", "citations"]
    assert "temperature" not in p and "top_p" not in p


def test_reply_carries_tokens_and_cost():
    stub = StubMessages(json.dumps({"status": "not_found", "answer": "", "citations": []}))
    r = client_with(stub).generate("sys", "user")
    assert (r.input_tokens, r.output_tokens) == (2000, 80)
    assert r.extra["cost_usd"] == pytest.approx((2000 * 0.10 + 80 * 0.50) / 1e6)
    assert stub.sent["model"] == "claude-haiku-5-5"


def test_refusal_returns_empty_text_so_nothing_is_shown():
    r = client_with(StubMessages("partial", stop_reason="refusal")).generate("s", "u")
    assert r.text == "" and r.extra["stop_reason"] == "refusal"


def test_batch_cost_is_half():
    assert models.cost_usd("claude-sonnet-5-5", 1_000_000, 0, batch=True) == pytest.approx(1.0)


def test_unknown_model_is_refused_rather_than_priced_at_zero():
    with pytest.raises(ValueError):
        models.AnthropicClient("claude-unknown", sdk_client=object())


def test_env_file_fills_missing_keys_but_never_overrides_and_skips_blanks(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text('# a comment\nCOA_TEST_KEY="sk-test-123"\nCOA_TEST_SET=from-file\nCOA_TEST_EMPTY=\n', encoding="utf-8")
    for k in ("COA_TEST_KEY", "COA_TEST_EMPTY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("COA_TEST_SET", "from-environment")
    models.load_env_file(env)
    assert os.environ["COA_TEST_KEY"] == "sk-test-123"
    assert os.environ["COA_TEST_SET"] == "from-environment"
    assert "COA_TEST_EMPTY" not in os.environ
    models.load_env_file(tmp_path / "missing.env")  # no file: nothing happens
