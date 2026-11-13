# cite-or-abstain - implementation plan

Working name. A question-answering system over IRS publications that must quote its source for
every claim or say the answer is not in the documents, measured by an eval set that fails the
build when quality drops, with a cheap live demo that switches itself off when its budget is spent.

Written 2026-11-12. Facts below were checked that day unless marked "estimate" or "verify".

## Why this project

From Mat's job-hunt runs (35 days, 3,186 unique postings, n=175 Forward Deployed / Applied AI
postings with text; keyword counts, so a rough signal):

| Asked for | Share of the 175 | Covered here by |
| --- | --- | --- |
| production / deploy | 95% | live demo, CI gate |
| RAG / retrieval | 87% | hybrid retrieval over real PDFs |
| evals | 82% | 150-question eval set, regression gate |
| observability | 74% | per-question traces, cost and latency per answer |
| guardrails / safety | 47% | verbatim citation check, abstention, injection handling |

None of the four existing public repos covers RAG, evals or observability.

## How it works

**Build once (offline, free).** Download the PDFs -> extract text and tables -> cut into passages
with stable ids (`p17-2025 / chapter / page`) -> index each passage two ways: keywords (SQLite FTS5)
and meaning (384-dim `bge-small-en-v1.5` embeddings).

**Each question (live).** Search both indexes (top 20 each) -> merge with reciprocal rank fusion ->
keep the best 5 -> send them and the question to the model with strict rules (answer only from the
passages, quote the exact sentence and passage id for every claim, or return `not_found`; passage
text is data, never instructions) -> code checks every quote appears word for word in the cited
passage, and rejects the answer if not -> show the answer with clickable citations, or "not covered".

**Proof.** About 150 questions with known answers in six types: lookup, number from a table, two
sections, year-specific, not in the documents (must abstain), attack (must not comply). Metrics:
retrieval recall@5, answer correctness, citation precision, abstention accuracy, p50/p95 latency,
cost per question.

## Documents (all HTTP 200 on 2026-11-12)

| Publication | Topic | Size | Last modified |
| --- | --- | --- | --- |
| p17 (tax year 2025) | Your Federal Income Tax | 3.1 MB | 2026-01-21 |
| p17 2024, p17 2023 (irs-prior) | same, prior years, for year-specific questions | 3.0 MB each | 2025-01-24, 2024-03-20 |
| p501 | dependents, standard deduction, filing information | 1.6 MB | 2026-02-05 |
| p587 | business use of your home | 1.5 MB | 2026-03-02 |
| p334 | tax guide for small business | 2.7 MB | 2026-02-12 |
| p463 | travel, gift and car expenses | 1.9 MB | 2026-03-02 |
| p970 | tax benefits for education | 1.9 MB | 2026-02-11 |
| p596 | earned income credit | 2.1 MB | 2025-12-18 |
| p590-A | IRA contributions | 1.8 MB | 2026-01-15 |
| p519 | U.S. tax guide for aliens | 2.1 MB | 2026-02-20 |

Left out: p4012 (VITA resource guide, 61 MB). US government works are public domain, so the PDFs
can be committed with SHA-256 checksums to pin the snapshot. The README carries a "not tax advice" line.

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Ingestion, evals, charts | Python 3.11, PyMuPDF (+ pdfplumber for tables), pytest | Python is in 77% of the 175 postings |
| Local model (free runs) | Ollama `qwen2.5:7b` / `llama3.1:8b` - both installed on the laptop (31.7 GB RAM, RTX 4070) | iterate without spending |
| Demo and comparison model | Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50 per M tokens) | cheapest current Claude |
| Comparison only | Claude Sonnet 5.5 ($2 / $10), Opus 5.5 optional ($4 / $20) | one Batch API run each (50% off) |
| Live API | Cloudflare Worker (TypeScript) | key stays server-side; `wrangler` deploy |
| Keyword index | Cloudflare D1 with FTS5 | supported by D1 (docs, 2026-11-12) |
| Vector index | Cloudflare Vectorize, 384 dims | free: 5M stored dims (~13,000 vectors), 30M queried dims/month |
| Query embeddings | Workers AI `@cf/baai/bge-small-en-v1.5` | 1,841 neurons per M tokens; 10,000 neurons/day free |

Workers Free limits that shape the design: 100,000 requests/day, **10 ms CPU per request** (waiting on
fetch does not count), 50 subrequests, 128 MB memory. So search runs inside D1 and Vectorize, not in
Worker memory.

## Milestones

Each milestone ends with its tests passing and its numbers written into `docs/results/`.

| # | Milestone | Done when | Cost |
| --- | --- | --- | --- |
| M0 | **Spike and decisions** - done 2026-11-13, see [results/m0.md](results/m0.md) | measured: page and passage counts (must stay under ~13,000 passages for free Vectorize); table extraction on 5 table-heavy pages; embedding parity between Workers AI and local `bge-small` on 100 passages (cosine > 0.99 means one model can serve both); chunk size chosen | free |
| M1 | **Ingest + keyword search + first 30 questions** - done 2026-11-13, see [results/m1.md](results/m1.md) | all PDFs extracted with checksums; FTS5 index; recall@5 measured on 30 questions | free |
| M2 | **Hybrid retrieval + comparison table** | keyword vs vector vs hybrid (vs reranked, if a reranker fits free) - recall@5 on the full set, with n | free |
| M3 | **Answering + citation guard + abstention** (local model) | strict JSON contract; verbatim quote check; all 150 questions written and graded; first full metrics on the local model | free |
| M4 | **Claude comparison** | 10-question measurement of real tokens first; then Batch runs on Haiku and Sonnet (Opus if Mat wants); cost-vs-accuracy chart | about $1 (Haiku + Sonnet, estimate; measured in the 10-question step) |
| M5 | **CI gate** | GitHub Actions: unit tests + retrieval eval + citation checks on recorded answers; a drop below the committed thresholds fails the build | free |
| M6 | **Live demo** | Worker + small page; budget guard (below); deployed and smoke-tested | per question only |
| M7 | **Write-up and release** | README (diagram, charts, results, failure analysis), one-page customer memo, v0.1.0, pinned first on the profile | free |

## Budget guard for the live demo

- **Per visitor:** 10 questions per day, counted in D1 by a hashed IP.
- **Global cap:** the Worker adds up real cost from each response's usage and stops at **$8**, leaving
  room for the eval runs.
- **Hard ceiling:** $10 prepaid Anthropic credit with auto-reload off. An out-of-credit error from the
  API shows the same message.
- **Per request:** question length capped, `max_tokens` fixed, 5 passages max.
- **Message when blocked:** "Too many requests right now. Ask Mat to add tokens to try it." with a link
  to his LinkedIn (no email on public pages).
- **Estimate:** about $0.0006 per question at ~4,000 tokens in and ~400 out on Haiku, so roughly 16,000
  questions per $10. Replaced by the measured figure after M4.

## Risks

| Risk | Plan |
| --- | --- |
| 10 ms CPU per request on Workers Free | keep search in D1 / Vectorize; measure CPU in M6; Workers Paid only if Mat agrees |
| Embeddings differ between local and Workers AI | M0 parity measurement decides; fall back to Workers AI for both |
| Tables extract badly | M0 measures 5 table pages; pdfplumber for tables if PyMuPDF falls short |
| An LLM judge flatters the model | grade deterministically first (exact numbers, quote checks, abstention); LLM judge only for free-text answers, checked against Mat's own grades on a sample |
| Abuse of the demo | the budget guard above |
| IRS revises a publication | the snapshot is pinned by checksum; refreshing it is a deliberate update |

## What Mat provides, and when

- **Before M4:** $10 prepaid credit in the Anthropic Console, auto-reload off, and an API key placed in
  `.env` (gitignored) or as a Cloudflare secret - never pasted into chat. This is a deliberate exception
  to the no-API-keys rule, for this project only.
- **Before M6:** Cloudflare access for `wrangler` (login on the laptop).
- **Now:** OK on the name `cite-or-abstain` and the documents above.
