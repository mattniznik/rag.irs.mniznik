# 0003. Claude Haiku 5.5 runs the live demo; Sonnet 5.5 is the zero-wrong option

**Status:** in use since 119092e (2026-11-13). Sources read 2026-11-14.

## Decision

The live demo answers with Claude Haiku 5.5. For a deployment where one wrong answer is expensive, the
recommendation is Claude Sonnet 5.5, at about 20 times the price.

## Sources

[Pricing](https://platform.claude.com/docs/en/about-claude/pricing), per million tokens:

| Model | Input | Output | Batch input | Batch output |
|---|---:|---:|---:|---:|
| "Claude Haiku 5.5 (for prompts up to 100,000 tokens)" | "$0.10 / MTok" | "$0.50 / MTok" | "$0.05 / MTok" | "$0.25 / MTok" |
| "Claude Sonnet 5.5" | "$2 / MTok" | "$10 / MTok" | "$1 / MTok" | "$5 / MTok" |
| "Claude Opus 5.5" | "$4 / MTok" | "$20 / MTok" | "$2 / MTok" | "$10 / MTok" |

Every prompt here is about 4,200 tokens, far below the 100,000 where Haiku's price rises.

## Evidence (this repository)

The same 150 questions, top 8 hybrid passages, prompt v1 ([Answers](../../README.md#answers), [Cost](../../README.md#cost)):

| | Claude Haiku 5.5 | Claude Sonnet 5.5 |
|---|---:|---:|
| Correct, strict grader (n=115) | 93 | 96 |
| Right when shown | 89.4% | 89.7% |
| Wrong answers shown, every one read by hand ([review](../results/review-claude-batch.json)) | 4 of 104 | 0 of 107 |
| Not-found questions declined (n=25) / attacks held (n=10) | 25 / 10 | 25 / 10 |
| Cost per 1,000 questions, real time | $0.50 | $10.12 |

The live demo has a fixed $10 prepaid budget with an $8 spend cap ([SECURITY.md](../../SECURITY.md)). At
Haiku's measured cost that is about 16,000 questions; at Sonnet's, about 800.

## Rejected

- **Sonnet for the live demo:** the same budget would last a twentieth as long, for 3 more right answers out
  of 115 and 4 fewer wrong ones out of about 105.
- **The local 7B model:** 72 right against Haiku's 93, and 14 wrong shown against 11.
- **Claude Opus 5.5:** not measured. At twice Sonnet's price, the hand review leaves it little room on
  wrong answers (Sonnet showed none). The 7 partial answers from Haiku and Sonnet were each missing a fact
  that search never retrieved ([0002](0002-hybrid-search-rrf.md)), which a bigger model cannot supply. Why
  the held-back answers were held back is not broken down in the results, so whether Opus would answer more
  of them is unknown.

## What would change it

A paying use where a wrong answer costs more than about a cent: switch `DEMO_MODEL` to Sonnet. Or better
search: if retrieval found the facts it now misses, re-run both models before choosing again.
