// A stand-in for the Worker, for the browser tests: serves public/ as static files the way Workers static
// assets do (/x serves x.html), and answers POST /api/ask in the live shape from src/index.ts
// ({trace, status, answer, citations, ms}) without calling any model:
//   a question containing "busy"  -> the 429 busy reply (the budget or the daily limit)
//   a question containing "error" -> a 503 error
//   anything else                 -> the recorded run whose question shares the most words, as a live answer
// usage: node e2e/serve.mjs [port]      (PUBLIC_DIR=... serves another copy of the page)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.PUBLIC_DIR || fileURLToPath(new URL("../public/", import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const data = JSON.parse(await readFile(join(ROOT, "site-data.json"), "utf8"));

function liveAnswer(question) {
  const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9$]+/g) || []);
  const a = words(question);
  let best = data.examples[0], score = -1;
  for (const ex of data.examples) {
    const b = words(ex.question), both = [...a].filter((x) => b.has(x)).length, s = both / (a.size + b.size - both);
    if (s > score) { score = s; best = ex; }
  }
  const t = best.trace;
  return {
    trace: { ...t, usage: { input: t.usage.input, output: t.usage.output, cost_usd: 0.00045 }, ms: { search: 482, model: 1300 } },
    status: best.status, answer: best.status === "answered" ? best.answer : "", citations: [], ms: 1790,
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/ask" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const question = String(JSON.parse(body || "{}").question || "").trim();
    await new Promise((r) => setTimeout(r, 300));
    res.setHeader("content-type", "application/json");
    if (/busy/i.test(question)) { res.statusCode = 429; return res.end(JSON.stringify({ status: "busy", message: "Too many requests right now. Ask Mat to add tokens to try it.", contact: "https://www.linkedin.com/in/matniznik" })); }
    if (/error/i.test(question)) { res.statusCode = 503; return res.end(JSON.stringify({ error: "The model is unavailable right now. Try again in a minute." })); }
    return res.end(JSON.stringify(liveAnswer(question)));
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  if (!path || /[/\\]$/.test(path)) path += "index.html";
  try {
    if (!extname(path)) { try { await readFile(join(ROOT, path)); } catch { path += ".html"; } }
    const buf = await readFile(join(ROOT, path));
    res.setHeader("content-type", TYPES[extname(path)] || "application/octet-stream");
    res.end(buf);
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(PORT, "127.0.0.1", () => console.log(`stand-in Worker on http://127.0.0.1:${PORT}`));
