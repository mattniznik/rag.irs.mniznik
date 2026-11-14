# 0005. Evaluation runs go through the Message Batches API

**Status:** in use since 119092e (2026-11-13). Sources read 2026-11-14.

## Decision

Full evaluation runs (150 questions) are sent as one batch ([scripts/run_claude_batch.py](../../scripts/run_claude_batch.py)):
`submit` writes the exact prompts and retrieved passages to disk, `collect` waits for the batch, then
verifies, grades and prices every answer from the same saved passages. Small smoke runs (3 to 10 questions)
use real-time calls ([scripts/run_answers.py](../../scripts/run_answers.py)).

## Sources

[Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing):

- "All usage is charged at 50 percent of the standard API prices."
- "The system processes each batch as fast as possible, with most batches completing within 1 hour. ...
  Batches expire if processing does not complete within 24 hours."

[Pricing](https://platform.claude.com/docs/en/about-claude/pricing): batch Haiku 5.5 "$0.05 / MTok" in and
"$0.25 / MTok" out; batch Sonnet 5.5 "$1 / MTok" and "$5 / MTok".

## Evidence (this repository)

- A full run cost $0.038 on Haiku and $0.759 on Sonnet (`cost_usd.total` in the
  [results files](../results/)), from the token counts the API returned.
- The batch price, doubled, matches what real-time calls cost: $0.48 per 1,000 questions on Haiku in a
  live smoke run (n=10) against $0.50 computed; $10.49 on Sonnet (n=3) against $10.12.
- Because `collect` grades against the passages saved at `submit`, a batch result can be re-verified and
  re-graded offline any time (`scripts/regrade.py`, `scripts/what_if.py`) without paying again. That is how
  every "measured and rejected" idea in [What failed](../../README.md#what-failed-and-what-fixed-it) was tested.

## Rejected

- **Real-time calls for full runs:** twice the price, with no benefit for an offline evaluation.

## Trade-off

Batch runs give no per-question latency ("latency not measured in batch mode" in the results files).
Latency comes from the live demo instead: the search and model times every live answer reports.

## What would change it

An evaluation that must finish within minutes (a CI gate that calls the model). Today CI calls no model: it
re-verifies and re-grades the recorded answers ([CI](../../README.md#ci)).
