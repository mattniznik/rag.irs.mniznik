# 0002. Keyword and vector search, fused by reciprocal rank; no reranker on the live site

**Status:** search compared in bb86e2c, the Worker on hybrid top 8 since 119092e (2026-11-13). Sources read
2026-11-14.

## Decision

Two searches run on every question and each returns its top 20 ([retrieval.py](../../src/cite_or_abstain/retrieval.py),
[worker/src/index.ts](../../worker/src/index.ts)):

- **Keyword:** SQLite FTS5 ranked by BM25, `bm25(passages_fts, 2.0, 1.0)`, so the section heading (the
  first column) counts double.
- **Vector:** bge-small-en-v1.5 embeddings (384 numbers per passage), with the model's own query
  instruction in front of the question.

Reciprocal rank fusion with k = 60 merges the two lists, and the best 8 go to the model. The cross-encoder
reranker is measured in the evaluation but not used live.

## Sources

- [Cormack, Clarke and Büttcher, SIGIR 2009](http://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf):
  "RRFscore(d ∈ D) = Σ_{r∈R} 1/(k + r(d))", "where k = 60 was fixed during a pilot investigation and not
  altered during subsequent validation", and "k = 60 was near-optimal, but that the choice was not
  critical". Fusing ranks needs no calibration between BM25 scores and cosine similarities.
- [bge-small-en-v1.5 model card](https://huggingface.co/BAAI/bge-small-en-v1.5): dimension 384; "If you
  need to search the relevant passages to a query, we suggest to add the instruction to the query", the
  instruction being "Represent this sentence for searching relevant passages: ". The model's pooling config
  sets `"pooling_mode_cls_token": true`, which is how the vectors are built.
- [SQLite FTS5](https://sqlite.org/fts5.html): "by passing extra real value arguments to the bm25() SQL
  function, each column of the table may be assigned a different weight".
- [Cloudflare Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/): "Maximum
  dimensions per vector | 1536 dimensions"; [pricing](https://developers.cloudflare.com/vectorize/platform/pricing/),
  Workers Free: "5 million stored vector dimensions" and "30 million queried vector dimensions / month",
  counted as in its example "`(10000 + 100) * 384`" (stored vectors plus queries, times dimensions).
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/):
  "@cf/baai/bge-small-en-v1.5 | $0.020 per M input tokens | 1841 neurons per M input tokens" and
  "@cf/baai/bge-reranker-base | $0.003 per M input tokens | 283 neurons per M input tokens", within
  "10,000 Neurons per day at no charge".

## Evidence (this repository)

[Search](../../README.md#search), n=115 answerable questions, timings on a laptop:

| Search | evidence@5 | evidence@10 | median ms |
|---|---:|---:|---:|
| Keyword (BM25) | 69.1% | 80.9% | 19 |
| Vector (bge-small, with the instruction) | 68.7% | 77.0% | 45 |
| Hybrid (RRF) | 78.3% | 87.4% | 81 |
| Hybrid, then the cross-encoder reranker | 86.5% | 90.4% | 3,821 |

Fusing finds 9 points more of the facts in the top 5 than either search alone. The top 8 hybrid passages
hold 83.9% of the facts the answers need. On the free tier, the index uses 3,973 × 384 = 1.53 million
stored dimensions of the 5 million, and leaves room for about 74,000 queries a month
((30,000,000 / 384) − 3,973; derived from the formula above, not measured).

## Rejected

- **One search alone:** 9 points less evidence in the top 5.
- **The reranker on the live site, for now.** It finds 8 more points of evidence, and Workers AI hosts the
  same model cheaply, so cost is not the reason. With the local 7B model it gave fewer right answers (66
  against 72, one run each), and it has not been tried with Claude. Until it is, the live configuration
  is the one the Claude runs measured.

## What would change it

A Claude batch run with the reranker (about $0.04 on Haiku, [0005](0005-batch-api-for-evals.md)). If it
gets more right answers, switch the Worker to Workers AI's `bge-reranker-base`. Search is now the limit:
every partial answer was missing a fact search never retrieved ([0003](0003-haiku-live-sonnet-for-zero-wrong.md)).
