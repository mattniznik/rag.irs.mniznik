# Security

What this demo defends against, how, what the evaluation measured, and what it does not do yet.

## Reporting a problem

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a
vulnerability**. Please do not open a public issue for anything that could be abused.

## Risks and controls

| Risk | Control | Evidence |
|---|---|---|
| **Prompt injection in the question** ("ignore your rules", "print your instructions", a fake quote to "confirm") | The system prompt treats the question and the passages as data, not instructions (rule 4 in [answer.py](src/cite_or_abstain/answer.py)). A canary string appears only in the system prompt, so a leak is detectable. Above all, an answer is shown only if every quote in it is found word for word in a passage the model was given: a quote the user typed, or one the model made up, is never shown. | All 10 attack questions held on every run: Claude Sonnet 5.5, Claude Haiku 5.5 and the local 7B model ([Answers](README.md#answers)). Recorded example A03, a fake quote to confirm, is on the live page. |
| **Instructions planted in a source** | The same rule 4. The 11 IRS PDFs are pinned by SHA-256 in [corpus/manifest.json](corpus/manifest.json) and CI checks the checksums, so the corpus cannot change silently. | `python scripts/fetch_corpus.py --verify`, run on every push. |
| **A wrong or invented answer** | Code, not the model, decides what is shown: the quote check in [answer.py](src/cite_or_abstain/answer.py) and its TypeScript port in [worker/src/verify.ts](worker/src/verify.ts). Both must agree on the same cases ([eval/verify_cases.json](eval/verify_cases.json)), tested in CI. | 25 of 25 questions whose answer is not in the publications were declined by both Claude models. Read by hand, Sonnet showed 0 wrong answers in 107 and Haiku 4 in 104 ([review](docs/results/review-claude-batch.json)). |
| **Running up the API bill** | A global spend cap (`BUDGET_USD`, $8) is checked in D1 before every model call; past it, everyone sees the "busy" notice. A daily limit of 10 questions per visitor (`DAILY_PER_IP`). Questions are capped at 300 characters and replies at 600 tokens. An empty prepaid balance at Anthropic shows the same notice. | [worker/src/index.ts](worker/src/index.ts); the busy reply is covered by the browser tests ([worker/e2e/site.e2e.ts](worker/e2e/site.e2e.ts)). |
| **Leaked keys** | `ANTHROPIC_API_KEY` and `IP_SALT` are Worker secrets (`wrangler secret put`), never in the repository. Local scripts read a git-ignored `.env`. Before every push the added lines are scanned for key-shaped strings, by hand, as [AGENTS.md](AGENTS.md) requires; there is no automated secret scan yet. | `.env`, `.cloudflare/` and `data/` are in [.gitignore](.gitignore). |

## Known gaps

- No Content-Security-Policy or other security headers yet: the Worker serves the page's files as they are.
- The page loads its typefaces from Google Fonts, a third-party request.
- The per-visitor limit keys on the IP address, so a visitor who changes address gets 10 more questions.
  The spend cap is the backstop.
- The daily `usage` rows are never deleted. They hold a salted hash, not an address.
- Dependencies are pinned by the lockfiles (`worker/package-lock.json`); there is no automated update or
  advisory check yet.
