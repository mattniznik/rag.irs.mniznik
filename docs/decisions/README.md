# Decision records

Why each part of cite-or-abstain is built the way it is. Each record states the decision, quotes the
provider documentation it rests on (with the date read), gives the measurement from this repository, and
names the options rejected and what would change the decision. Numbers carry their sample size; anything
not measured says so.

| | Decision | Rests on |
|---|---|---|
| [0001](0001-quote-check-in-code.md) | The quote check is code, not the model | Anthropic: reducing hallucinations, Citations, structured outputs |
| [0002](0002-hybrid-search-rrf.md) | Keyword and vector search fused by reciprocal rank; no reranker live | The RRF paper, the bge-small model card, SQLite FTS5, Cloudflare Vectorize and Workers AI |
| [0003](0003-haiku-live-sonnet-for-zero-wrong.md) | Haiku 5.5 runs the demo; Sonnet 5.5 is the zero-wrong option | Anthropic pricing; the hand review of every wrong answer |
| [0004](0004-structured-output-thinking-off.md) | A fixed JSON reply, thinking off, low effort | Anthropic: structured outputs, effort |
| [0005](0005-batch-api-for-evals.md) | Evaluation runs go through the Message Batches API | Anthropic: batch processing, pricing |
| [0006](0006-cloudflare-not-aws.md) | Cloudflare rather than AWS, and what the AWS version would take | Cloudflare limits and pricing; AWS Lambda, S3 Vectors, OpenSearch Serverless, Bedrock |
| [0007](0007-one-page-studio.md) | One page, seven layouts, a Studio pick kept in the browser | Cloudflare static assets; WAI-ARIA dialog pattern; WCAG 2.2; MDN |

How these are written: [AGENTS.md](../../AGENTS.md), rule 4.
