# 0004. A fixed JSON reply, with thinking off and low effort

**Status:** in use since bb86e2c (2026-11-13). Sources read 2026-11-14.

## Decision

Every request asks for a JSON reply that matches a schema: a status (`answered` or `not_found`), a short
answer, and citations of the form `{"passage": 2, "quote": "..."}`. Thinking is turned off and effort is
`low`. See `request_params` in [models.py](../../src/cite_or_abstain/models.py) and the Worker's call in
[worker/src/index.ts](../../worker/src/index.ts).

## Sources

[Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs):

- "The request carries the schema in `output_config.format` with `type: "json_schema"`."
- "Claude returns valid JSON that matches your schema in the response’s text content block."
- "Although structured outputs guarantee schema compliance in most cases, there are scenarios where the
  output might not match your schema:" (it lists refusals and `max_tokens` cut-offs). So the code still
  parses defensively and treats a reply that is not JSON as "unverified".
- "Prefilling is incompatible with JSON outputs." The older trick of starting the reply with `{` is out.

[Effort](https://platform.claude.com/docs/en/build-with-claude/effort):

- "Claude Haiku 5.5 supports all five effort levels, and `medium` is the default."
- "You can also send `thinking: {"type": "disabled"}` at `high` effort or below."
- For Claude Sonnet 5.5: "To have the model respond without thinking first, send
  `thinking: {"type": "between_tools"}`, not `"disabled"`." That is why `thinking_off()` in models.py
  differs by model.
- "`low` | Most efficient. Significant token savings with some capability reduction."

## Evidence (this repository)

In both Claude evaluation runs (n=150 each, [docs/results/](../results/)): 0 replies failed to parse as
JSON, and all 150 stopped with `end_turn`, none cut off by `max_tokens`. Mean output was 165 tokens (Haiku)
and 171 (Sonnet): an answer and a quote or two, nothing to think through at length. The task is a lookup in
8 passages the model is handed.

## Rejected

- **Free text parsed with patterns:** a missing bracket or an extra sentence becomes a parsing bug instead
  of a schema violation the API prevents.
- **Thinking on:** not measured here. The answers are short lookups, and `low` effort is the documented
  token-saving setting. Worth a run before adding multi-step questions (see below).
- **Anthropic's Citations feature instead of a `citations` field:** incompatible with structured outputs;
  see [0001](0001-quote-check-in-code.md).

## What would change it

Questions that need reasoning across passages: the partial answers came from two-part questions. Run the
150 with adaptive thinking at `medium` and compare accuracy against the extra output tokens.
