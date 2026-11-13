# Deploying the live demo (Cloudflare Workers)

The Worker runs hybrid retrieval (D1 FTS5 + Vectorize, top 8, the configuration the eval measured), makes
one Claude Haiku call, verifies every citation, and stops itself with "Too many requests right now. Ask Mat to add
tokens to try it." when the spend counter reaches `BUDGET_USD` or the Anthropic credit runs out.

## One-time setup

```bash
# 1. Build everything the Worker needs from the pinned corpus
python scripts/build_index.py
python scripts/build_vectors.py
python scripts/export_cloud.py          # worker/build/d1.sql, worker/build/vectors.ndjson, worker/src/generated.ts
python scripts/export_site.py           # worker/public/site-data.json: recorded examples and results for the page

cd worker
npm install
npx wrangler login

# 2. Database: passages, FTS5 index, usage and spend tables
npx wrangler d1 create cite-or-abstain   # copy the database_id into wrangler.jsonc
npx wrangler d1 execute cite-or-abstain --remote --file build/d1.sql

# 3. Vector index: 384 dims, cosine (bge-small-en-v1.5, CLS pooling)
npx wrangler vectorize create cite-or-abstain --dimensions=384 --metric=cosine
npx wrangler vectorize insert cite-or-abstain --file build/vectors.ndjson

# 4. Secrets (prompted, never written to a file)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put IP_SALT          # any long random string

# 5. Ship
npm test && npm run typecheck
npx wrangler deploy
```

## Address

The Worker is served only at the custom domain in `wrangler.jsonc` (`routes`, `custom_domain: true`).
Cloudflare creates the DNS record and an Advanced Certificate for it on deploy, which covers a
multi-level name such as `rag.irs.mniznik.com` that Universal SSL does not. The hostname must not
already carry a CNAME. `workers_dev` and `preview_urls` are set to false so no `*.workers.dev`
address serves the demo. A new custom domain answers with a TLS error (curl exit 35) until its
certificate is issued: 140 seconds on the first deploy, 2026-11-13.

## Budget

- Anthropic: $10 prepaid credit with auto-reload off is the hard ceiling.
- `BUDGET_USD` (wrangler.jsonc, default 8): the Worker adds up each answer's cost from the usage the API
  returns and stops at this value, leaving room for eval runs.
- `DAILY_PER_IP` (default 10): questions per visitor per day, counted by a salted hash of the IP.
- Reset or raise the counter after adding credit:
  `npx wrangler d1 execute cite-or-abstain --remote --command "UPDATE spend SET usd = 0 WHERE id = 1"`

## Free-tier limits that shape the design (Cloudflare docs, read 2026-11-13)

- Workers Free: 100,000 requests/day, 10 ms CPU per request (waiting on fetch does not count), 50 subrequests.
  One question makes about 7 subrequests: embed, vector query, FTS query, passage fetch, Claude, two D1 writes.
- Vectorize free: 5M stored dimensions (~13,000 vectors at 384 dims; this index holds 3,973) and 30M queried
  dimensions per month, counted as (queries + stored vectors) x dimensions.
- Workers AI free: 10,000 neurons/day. bge-small: 1,841 neurons per M tokens. (The reranker, 283 per M, is
  not used: with the local model it found more evidence but fewer right answers, and it has not been
  tried with Claude.)
