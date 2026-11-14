# 0006. Cloudflare Workers, D1, Vectorize and Workers AI rather than AWS

**Status:** the Worker port since bb86e2c, served at rag.irs.mniznik.com since 7ff2869 (2026-11-13). Sources
read 2026-11-14; AWS prices are for US East (N. Virginia).

## Decision

The live demo is one Cloudflare Worker: D1 (SQLite) holds the passages and the FTS5 keyword index,
Vectorize holds the vectors, Workers AI embeds the question with the same bge-small model the evaluation
uses, and the Worker calls Claude through the Anthropic API. The page is served as static assets by the same
Worker. See [docs/DEPLOY.md](../DEPLOY.md).

## Why

The goal was a public demo that runs inside free tiers, with the same keyword engine and the same embedding
model as the offline evaluation, so the live results are the measured ones.

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): "Accounts on the Workers
  Free plan have a daily request limit of 100,000 requests"; Free: "CPU time per HTTP request | 10 ms",
  "Subrequests per invocation | 50". One question makes about 7 subrequests (embed, vector query, keyword
  query, passage fetch, Claude, two D1 writes).
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): "Maximum database size | 10 GB
  (Workers Paid) / 500 MB (Free)"; [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
  Workers Free: "Rows read | 5 million / day", "Rows written | 100,000 / day". D1 is SQLite, so the
  Worker runs the same FTS5 `bm25()` query as the evaluation.
- Vectorize and Workers AI free allowances, with the arithmetic: [0002](0002-hybrid-search-rrf.md).

## The AWS version, and why not now

An AWS build is possible and would not be expensive. This is what it would take:

- **Claude:** on Amazon Bedrock. The [Haiku 5.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)
  gives "Model ID "anthropic.claude-haiku-5-5"" and, from us-east-1, the inference profile
  "global.anthropic.claude-haiku-5-5". It notes in-Region inference in us-east-1 is not supported for it.
- **Compute:** [Lambda](https://aws.amazon.com/lambda/pricing/): "The free tier includes one million
  requests and 400,000 GB-seconds per month."
- **Vectors:** [Amazon S3 Vectors](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html),
  "purpose-built, cost-optimized vector storage for AI agents, inference, RAG, and semantic search", "now
  generally available" ([Dec 2025](https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-s3-vectors-generally-available/)).
  At "$0.06 per GB-Mo of Storage in Vectors" (AWS Price List, us-east-1), 3,973 vectors of 384 float32
  numbers (about 6 MB) cost well under a cent a month; queries are "$2.50/MM queries" plus small data
  charges ([S3 pricing](https://aws.amazon.com/s3/pricing/)).
- **Keyword search is the hard part.** S3 Vectors is vector storage only. The managed BM25 option,
  [OpenSearch Serverless](https://aws.amazon.com/opensearch-service/pricing/), bills "at least for a minimum of
  2 OCUs" for the first collection ("a dev-test option" halves that), at "$0.24 per OCU-hours" in us-east-1:
  2 × $0.24 × 730 hours ≈ $350 a month, or ≈ $175 in dev-test. Its newer collections have "no minimum OCU
  requirement" and scale to zero, which would remove that floor; they were not priced here.
- **Bedrock Knowledge Bases** would manage the pipeline, but it needs a vector store from its list
  ("Amazon OpenSearch Serverless", "Amazon S3 Vectors", "Amazon Aurora (RDS)", Pinecone and others,
  [setup](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html)), and it would
  replace the fusion and the quote check this project measures.

So the cheap AWS shape is Lambda + S3 Vectors + Claude on Bedrock, with keyword search either in SQLite
inside the Lambda package or in a scale-to-zero OpenSearch collection, and the bge-small embedding model
packaged or hosted by the project. Each of those is a change to measure again; on Cloudflare, every piece
already matched the evaluation.

## What would change it

A client already on AWS, or traffic beyond the free tiers (100,000 requests a day, about 74,000 vector
queries a month). The port would keep the Python search and quote check unchanged and re-run the 150
questions on the new stack before switching.
