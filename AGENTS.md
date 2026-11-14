# AGENTS.md

How work is done in this repository, for coding agents and for people. Claude Code reads this file because
the repository has no `CLAUDE.md` ("By default, Claude reads `AGENTS.md` only when you have no `CLAUDE.md`",
[Claude Code memory docs](https://code.claude.com/docs/en/memory), v2.1.277 or later). It stays short on
purpose: Claude Code loads such a file "into every session, which means every line in it takes a little of
Claude's attention on *every* task" ([best practices](https://code.claude.com/docs/en/best-practices)).

## Map

- `src/cite_or_abstain/` - ingestion, search, the answer and its quote check, grading (Python).
- `scripts/` - index and vector builds, evaluation runs, exports to the Worker.
- `eval/` - the 150 questions, the quote-check cases both languages must agree on, recorded runs, CI floors.
- `worker/` - the live demo: `src/` the Cloudflare Worker, `public/` the page, `test/` unit tests,
  `e2e/` browser tests.
- `docs/decisions/` - why things are the way they are, each with its sources and measurements.

## Checks (all run in CI, none calls a model)

```bash
ruff check src scripts tests && mypy && pytest -q && python scripts/ci_check.py
cd worker && npx tsc --noEmit && npm test && npm run e2e
```

## Rules

1. **Verify before you claim.** A clean compile, a green run or a tool's "success" is a claim. Check the
   effect: the file on disk, the page in a browser, the live response. Give yourself "something it can run
   that comes back pass or fail" ([best practices](https://code.claude.com/docs/en/best-practices)).
   Example: d01dc8a compared every deployed file with the repository byte for byte and asked the live site
   two real questions.
2. **Test first, and watch it fail.** "Write a failing test that reproduces it, then fix it" (same page).
   The test must fail on the old code for the reason you expect. Examples: d01dc8a (the choice tests failed
   before `studio/choice.js` existed), 570d965 (the browser tests fail on the page from before the Studio),
   1dea5f3 (a deliberately broken assertion turns the CI job red).
3. **Say whether a number was measured or inferred.** Every number carries its n; an explanation without a
   measurement says it is inferred. Example: the [Results](README.md#results) (a sign test, p = 0.30, so a
   drop is "not distinguishable from scatter").
4. **Ground a decision in the provider's documentation, then measure it.** Before relying on how an API or
   platform behaves, read the provider's page and quote the line, with the date read, in
   [docs/decisions/](docs/decisions/). Example: [0001](docs/decisions/0001-quote-check-in-code.md) checks
   Anthropic's Citations feature before ruling it out.
5. **Never weaken a check to make it pass.** No deleting or loosening an assertion, no pasting the computed
   value in as the expected one, no lowering a floor in `eval/thresholds.json` without a measured reason.
   Example: 4b8c03d moved the floors up to the measured values.
6. **Keep the evaluation honest.** The answer key was frozen after the full Claude runs; disagreements go
   into the hand review ([docs/results/review-claude-batch.json](docs/results/review-claude-batch.json)),
   not into the key. A prompt change runs the full evaluation before it ships: bb86e2c measured prompt v2,
   found no gain, and kept v1.
7. **Smallest change that solves it.** Extend what exists before adding a layer; add nothing without a use
   today.
8. **Commit messages carry the reasoning:** the symptom, the root cause (file, line or setting), why this
   fix over the obvious alternative, the evidence (numbers before and after), and what is still unverified.
   Examples: b23d460, 570d965.
9. **Check what a push publishes.** The repository is public. Before every push, scan the added lines for
   key-shaped strings, personal data and infrastructure details such as account ids. Keys live only in
   Worker secrets and a git-ignored `.env` ([SECURITY.md](SECURITY.md)).
10. **Ask a person before anything that spends money, deploys or cannot be undone:** model runs beyond a
    smoke test, `wrangler deploy`, a change to the spend cap or the limits, a force-push.
