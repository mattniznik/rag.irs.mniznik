# 0001. The quote check is code, not the model

**Status:** in use since bb86e2c (2026-11-13). Sources read 2026-11-14.

## Decision

Every answer must come with quotes, each naming the numbered passage it was copied from. Code shows the
answer only if every quote is 3 to 100 words long and appears word for word in the passage it names, after
normalising quote marks, dashes, spacing, case and table layout. Otherwise the answer is "unverified" and
the user sees "not found". The same check exists twice, in Python ([answer.py](../../src/cite_or_abstain/answer.py))
for the evaluation and in TypeScript ([worker/src/verify.ts](../../worker/src/verify.ts)) for the live demo,
and both must agree on the same cases ([eval/verify_cases.json](../../eval/verify_cases.json)) in CI.

## Why

The product promise is "no source, no answer". A model can be asked to keep that promise; code can enforce
it. Anthropic's own guidance points the same way, and this design moves the last step out of the model:

- [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations):
  "You can also have Claude verify each claim by finding a supporting quote after it generates a response.
  If it can’t find a quote, it must retract the claim." Here the retraction is done by code, which a
  prompt-injection cannot talk out of it.
- Same page: "**Allow Claude to say “I don’t know”:** Explicitly give Claude permission to admit
  uncertainty." That is the `not_found` status every reply may use.

## Evidence (this repository)

From the [Answers](../../README.md#answers) table, each run replayed with the check switched off
(`python scripts/what_if.py`), n=115 answerable questions per run:

| Model | Wrong shown, check on | Wrong shown, check off | Wrong answers it stopped | Right answers it hid |
|---|---:|---:|---:|---:|
| qwen2.5 7B, local | 14 | 23 | 9 | 11 |
| Claude Haiku 5.5 | 11 | 13 | 2 | 4 |
| Claude Sonnet 5.5 | 11 | 11 | 0 | 0 (all 213 quotes were exact) |

On a strong model the check costs nothing and still guarantees that every quote on screen is real and links
to its page. All 10 prompt-injection questions were held on every run, including A03, which asks the model
to "confirm" a quote that is not in any publication.

## Rejected

- **Anthropic's Citations feature.** [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
  gives the same kind of guarantee: "citations are guaranteed to contain valid pointers to the provided
  documents." But "Citations cannot be used together with structured outputs", and this design needs a
  fixed JSON reply ([0004](0004-structured-output-thinking-off.md)) and the same check on every model in the
  evaluation, including a local one that has no such feature.
- **A number rule** (hide an answer that states a number no quote contains). Measured on recorded replies,
  it hid mostly right answers: 21 on Haiku, of which 2 were wrong ([What failed](../../README.md#what-failed-and-what-fixed-it)).
- **Crediting a quote to the passage that really holds it** when the model gave the wrong passage number.
  The answers it would add were right 24 times in 36, below the 80% to 90% already shown, so it stays off
  (`verify(reattribute=False)`).

## What would change it

If Citations became usable alongside structured outputs and the evaluation ran Claude only, run both on the
same 150 questions and compare what each lets through.
