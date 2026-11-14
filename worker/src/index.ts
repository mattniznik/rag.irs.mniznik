// The live demo: hybrid retrieval (D1 FTS5 + Vectorize), one Claude Haiku call, citation
// check, and a budget guard that switches the demo off with a fixed message when money runs low.
import Anthropic from "@anthropic-ai/sdk";
import {
  ANSWER_SCHEMA, DEMO_MODEL, DOC_TITLES, DOC_URLS, FUSE_DEPTH, PRICE_PER_MTOK, QUERY_INSTRUCTION, RRF_K, SYSTEM,
} from "./generated";
import { toQuery } from "./text";
import { fuse, type Ranked } from "./fuse";
import { citationChecks, parse, verify, type Passage } from "./verify";
import { askPoint, MAX_BODY, parseEvent, type Point, type Server } from "./events";

export interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORS: VectorizeIndex;
  ASSETS: Fetcher;
  EVENTS: AnalyticsEngineDataset;
  ANTHROPIC_API_KEY: string;
  IP_SALT: string;
  DAILY_PER_IP: string;
  BUDGET_USD: string;
  CONTACT_URL: string;
}

export const BUSY = "Too many requests right now. Ask Mat to add tokens to try it.";
const K = 8; // hybrid top 8, no reranker: the configuration the Claude eval runs measured (README, Answers)
const MAX_QUESTION = 300;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/ask" && req.method === "POST") return ask(req, env);
    if (url.pathname === "/api/event" && req.method === "POST") return event(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function busy(env: Env): Response {
  return json({ status: "busy", message: BUSY, contact: env.CONTACT_URL }, 429);
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- usage events (src/events.ts decides what is kept) ----------

/** The usage table's key: a salted hash of the IP that changes every day (no raw IPs are stored). */
async function dailyHash(req: Request, env: Env): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return sha256(`${env.IP_SALT}:${day}:${req.headers.get("CF-Connecting-IP") ?? "unknown"}`);
}

/** What the Worker knows about a request: Cloudflare's IP lookup (request.cf: country, region, city,
 *  coordinates, the network owner), the User-Agent header, and the day's visitor key (the first 16 hex
 *  characters of the usage hash). src/events.ts checks each, rounds the coordinates and parses the agent. */
function serverOf(req: Request, hash: string): Server {
  const cf = (req.cf ?? {}) as { country?: unknown; region?: unknown; city?: unknown; latitude?: unknown; longitude?: unknown; asOrganization?: unknown };
  return {
    country: String(cf.country ?? ""), region: cf.region, city: cf.city, lat: cf.latitude, lon: cf.longitude, org: cf.asOrganization,
    ua: req.headers.get("User-Agent") ?? "", visitor: hash.slice(0, 16),
  };
}

/** One data point into Analytics Engine. It honours Global Privacy Control and never fails the request. */
function record(env: Env, req: Request, p: Point | null): void {
  if (!p || req.headers.get("Sec-GPC") === "1") return;
  try { env.EVENTS?.writeDataPoint(p); } catch { /* analytics never breaks the page */ }
}

/** POST /api/event: an event from shared/track.js. Always 204, kept or not, so it tells a sender nothing. */
async function event(req: Request, env: Env): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return done;
  const raw = await req.text();
  record(env, req, parseEvent(raw, serverOf(req, await dailyHash(req, env))));
  return done;
}

async function ask(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; ctx?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return json({ error: "Ask a question." }, 400);
  if (question.length > MAX_QUESTION) return json({ error: `Keep the question under ${MAX_QUESTION} characters.` }, 400);

  // Each outcome below is recorded once as a usage event: what happened, the time, the cost, the question and
  // the page's context (layout, link code, visitor id).
  const start = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = await dailyHash(req, env);
  const server = serverOf(req, ipHash);
  const done = (res: Response, status: string, cost = 0) => {
    record(env, req, askPoint({ status, ms: Date.now() - start, cost, question, ctx: body.ctx }, server));
    return res;
  };

  // Budget first: once the spend counter reaches BUDGET_USD the demo stops for everyone.
  const spent = (await env.DB.prepare("SELECT usd FROM spend WHERE id = 1").first<number>("usd")) ?? 0;
  if (spent >= Number(env.BUDGET_USD)) return done(busy(env), "busy");

  // Then the per-visitor daily limit, keyed by a salted hash of the IP (no raw IPs are stored).
  const count = await env.DB.prepare(
    "INSERT INTO usage (day, ip_hash, count) VALUES (?, ?, 1) " +
      "ON CONFLICT(day, ip_hash) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(day, ipHash).first<number>("count");
  if ((count ?? 0) > Number(env.DAILY_PER_IP)) return done(busy(env), "limit");

  const t0 = Date.now();
  const { passages, ranks } = await retrieve(env, question);
  const tSearch = Date.now();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: DEMO_MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage(question, passages) }],
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (e) {
    // An empty prepaid balance is the hard ceiling: show the same message as the spend counter.
    if (e instanceof Anthropic.APIError && (e.status === 402 || /credit|balance/i.test(e.message))) return done(busy(env), "busy");
    return done(json({ error: "The model is unavailable right now. Try again in a minute." }, 503), "error");
  }
  const tModel = Date.now();
  const cost = (msg.usage.input_tokens * PRICE_PER_MTOK.input + msg.usage.output_tokens * PRICE_PER_MTOK.output) / 1e6;
  await env.DB.prepare("UPDATE spend SET usd = usd + ? WHERE id = 1").bind(cost).run();

  const text = msg.stop_reason === "refusal" ? "" : (msg.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ?? "";
  const reply = parse(text);
  const v = verify(reply, passages);
  const byId = new Map(passages.map((p) => [p.id, p]));
  // Everything the page needs to show how this answer was made; the same shape as the recorded
  // examples scripts/export_site.py writes into public/site-data.json.
  const trace = {
    model: DEMO_MODEL,
    passages: passages.map((p, i) => ({
      n: i + 1, source: `${title(p.doc)} (${p.year}), page ${p.page}`, url: `${DOC_URLS[p.doc]}#page=${p.page}`,
      section: p.section, text: p.text, kw: ranks[i].kw, vec: ranks[i].vec, fused: Number(ranks[i].fused.toFixed(5)),
    })),
    raw: text,
    stop_reason: msg.stop_reason,
    citations: citationChecks(reply, v.problems),
    problems: v.problems.filter((p) => !p.startsWith("citation ")),
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cost_usd: Number(cost.toFixed(6)) },
    ms: { search: tSearch - t0, model: tModel - tSearch },
  };
  return done(json({
    trace,
    status: v.status,
    answer: v.status === "answered" ? v.answer : "",
    citations: v.status === "answered"
      ? v.citations.map((c) => {
          const p = byId.get(c.passage_id)!;
          return { quote: c.quote, source: `${title(p.doc)} (${p.year}), page ${p.page}`, url: `${DOC_URLS[p.doc]}#page=${p.page}` };
        })
      : [],
    ms: Date.now() - t0,
  }), v.status === "unverified" ? "held_back" : v.status, cost);
}

function title(doc: string): string {
  return DOC_TITLES[doc.slice(0, doc.lastIndexOf("-"))] ?? doc;
}

/** Same message as answer.user_message in Python: passages numbered [1]..[n]. */
export function userMessage(question: string, passages: Passage[]): string {
  const blocks = passages.map((p, i) => {
    const head = `[${i + 1}] (${title(p.doc)}, ${p.year}, page ${p.page}${p.section ? `, section: ${p.section}` : ""})`;
    return `${head}\n${p.text}`;
  });
  return `Question: ${question}\n\nPassages:\n\n${blocks.join("\n\n")}`;
}

/** Hybrid retrieval as in retrieval.Retriever.hybrid: keyword top 20 + vector top 20, reciprocal
 *  rank fusion, keep the best K. Map order and a stable sort break ties the way Python does. */
async function retrieve(env: Env, question: string): Promise<{ passages: Passage[]; ranks: Ranked[] }> {
  const emb = (await env.AI.run("@cf/baai/bge-small-en-v1.5", {
    text: [QUERY_INSTRUCTION + question],
    pooling: "cls",
  } as never)) as unknown as { data: number[][] };
  const vec = await env.VECTORS.query(emb.data[0], { topK: FUSE_DEPTH });
  const fts = toQuery(question);
  const kw = fts
    ? (await env.DB.prepare(
        "SELECT p.id FROM passages_fts JOIN passages p ON p.rowid = passages_fts.rowid " +
          "WHERE passages_fts MATCH ? ORDER BY bm25(passages_fts, 2.0, 1.0) LIMIT ?",
      ).bind(fts, FUSE_DEPTH).all<{ id: string }>()).results
    : [];
  const top = fuse(kw.map((r) => r.id), vec.matches.map((m) => m.id), K, RRF_K);
  if (!top.length) return { passages: [], ranks: [] };
  const ids = top.map((r) => r.id);
  const rows = (await env.DB.prepare(
    `SELECT id, doc, year, page, section, kind, text FROM passages WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all<Passage>()).results;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kept = top.filter((r) => byId.has(r.id));
  return { passages: kept.map((r) => byId.get(r.id)!), ranks: kept };
}
