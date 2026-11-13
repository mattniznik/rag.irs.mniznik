// The demo page. One result (a live answer or a recorded evaluation run) and four ways to lay it out.
// All model and passage text goes in with textContent, never innerHTML.
import { locate } from "./locate.js";

// The layout a first-time visitor sees. ?layout=<key> and the switcher override it; the switcher
// also remembers the visitor's choice.
const DEFAULT_LAYOUT = "report";
const LAYOUTS = {
  report: { name: "Report", hint: "Report: the answer first, then every step that produced it, top to bottom." },
  sources: { name: "Sources", hint: "Sources: the answer beside its 8 source passages. Click a citation number to open its passage with the quote highlighted." },
  walkthrough: { name: "Walkthrough", hint: "Walkthrough: one step at a time. Replay plays the steps in order, with the real measured timings on each." },
  console: { name: "Console", hint: "Console: an evaluation workbench. Runs on the left, the trace of the selected run on the right, one span at a time." },
};
const LIVE_EXAMPLES = [
  "What is the 2025 standard deduction for a single person?",
  "How many days do I need to be in the US for the substantial presence test?",
  "What was the standard deduction for married filing jointly in 2023?",
  "When is the Delaware franchise tax report due?",
];

const params = new URLSearchParams(location.search);
const state = {
  layout: LAYOUTS[params.get("layout")] ? params.get("layout") : (LAYOUTS[localStorage.getItem("layout")] ? localStorage.getItem("layout") : DEFAULT_LAYOUT),
  result: null, // { question, status, answer, trace, recorded?, id? } or { question, message, contact? }
  selected: null, // id of the recorded run on screen
  loading: false,
  data: null,
};

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const secs = (ms) => (ms / 1000).toFixed(1) + " s";
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const tip = $("tip");
function bindTip(node, text) {
  node.tabIndex = 0;
  node.setAttribute("aria-label", text);
  const show = (x, y) => { tip.textContent = text; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.min(x + 12, innerWidth - w - 8) + "px"; tip.style.top = y + 14 + "px"; };
  node.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
  node.addEventListener("pointerleave", () => { tip.hidden = true; });
  node.addEventListener("focus", () => { const r = node.getBoundingClientRect(); show(r.left, r.bottom - 10); });
  node.addEventListener("blur", () => { tip.hidden = true; });
}
function toast(msg) {
  const t = el("div", msg, "toast"); t.setAttribute("role", "status");
  document.body.append(t); setTimeout(() => t.remove(), 1600);
}
function highlighted(text, spans) {
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (s < at) continue;
    frag.append(text.slice(at, s), el("mark", text.slice(s, e)));
    at = e;
  }
  frag.append(text.slice(at));
  return frag;
}
/** Check problems in plain words, with passage numbers instead of internal ids. */
function plain(problem, c) {
  const n = c && c.passage ? "[" + c.passage + "]" : "it names";
  let m;
  if (/^quote is not in passage /.test(problem)) return `the quote is not word for word in passage ${n}`;
  if (/^passage .* was not given$/.test(problem)) return `passage ${n} was not one of the 8 the model was given`;
  if ((m = /^quote has (\d+) words$/.exec(problem))) return `the quote has ${m[1]} words; 3 to 100 are allowed`;
  if (problem === "no citations") return "the answer came with no quotes";
  if (problem === "empty answer") return "the answer was empty";
  if (problem === "reply was not JSON") return "the reply was not in the required JSON shape";
  return problem;
}

/* ---------- what a result means ---------- */
function statusOf(r) {
  if (r.status === "answered") return { key: "ok", label: "Verified answer", short: "Shown" };
  if (r.status === "not_found") return { key: "nf", label: "Not covered", short: "Not covered" };
  return { key: "held", label: "Held back", short: "Held back" };
}
/** Where each quote sits: in the passage it names, or (for a rejected quote) in another one. */
function analyse(r) {
  const t = r.trace;
  const spans = new Map();
  const homes = t.citations.map((c) => {
    const named = t.passages[Number(c.passage) - 1];
    const here = named ? locate(named.text, c.quote) : null;
    if (here) return { p: named, span: here };
    for (const p of t.passages) { const s = locate(p.text, c.quote); if (s) return { p, span: s, elsewhere: true }; }
    return null;
  });
  homes.forEach((h, i) => { if (h && t.citations[i].ok) spans.set(h.p.n, [...(spans.get(h.p.n) ?? []), h.span]); });
  const ok = t.citations.filter((c) => c.ok).length;
  return { spans, homes, quoted: new Set(spans.keys()), ok, total: t.citations.length };
}
function verdictText(r, a) {
  const t = r.trace;
  if (r.status === "answered") return "Shown: every quote matched the passage it names.";
  if (r.status === "not_found") return "Not covered: the model said the passages do not answer this, so nothing is shown and nothing is invented.";
  const why = [...t.citations.filter((c) => !c.ok).map((c) => plain(c.problem, c)), ...t.problems.map((p) => plain(p))];
  return "Held back: " + (why.join("; ") || "the reply did not pass the check") + ".";
}

/* ---------- building blocks shared by the layouts ---------- */
function answerCard(r, a, onCite) {
  const st = statusOf(r);
  const card = el("div", undefined, "card answer-card fade");
  const head = el("div", undefined, "answer-head");
  const left = el("div"); left.append(el("span", st.label, "pill " + st.key));
  if (r.recorded) left.append(el("span", "recorded run " + (r.id ?? ""), "tag"));
  head.append(left);
  if (r.status === "answered") {
    const copy = el("button", "Copy", "ghost"); copy.type = "button";
    copy.onclick = async () => {
      const lines = [r.answer, "", ...r.trace.citations.filter((c) => c.ok).map((c) => `"${c.quote}" (${r.trace.passages[Number(c.passage) - 1]?.source ?? ""})`)];
      try { await navigator.clipboard.writeText(lines.join("\n")); toast("Answer and sources copied"); } catch { toast("Copy is blocked in this browser"); }
    };
    head.append(copy);
  }
  card.append(head);
  if (r.question) card.append(el("p", r.question, "qline"));
  if (r.status === "answered") {
    const ans = el("p", r.answer, "answer");
    const cited = [...new Set(r.trace.citations.filter((c) => c.ok).map((c) => Number(c.passage)))];
    for (const n of cited) {
      const b = el(onCite ? "button" : "span", n, "cite");
      if (onCite) { b.type = "button"; b.title = "Open passage " + n; b.onclick = () => onCite(n); }
      ans.append(b);
    }
    card.append(ans);
    for (const c of r.trace.citations.filter((x) => x.ok)) {
      const p = r.trace.passages[Number(c.passage) - 1];
      const q = el("blockquote", "“" + c.quote + "”");
      const src = el("div", undefined, "src");
      if (onCite && p) { const b = el("button", p.n, "cite"); b.type = "button"; b.title = "Open passage " + p.n; b.onclick = () => onCite(p.n); src.append(b); }
      if (p) { const link = el("a", p.source + " ↗"); link.href = p.url; link.target = "_blank"; link.rel = "noopener"; src.append(link); }
      q.append(src);
      card.append(q);
    }
  } else {
    card.append(el("p", r.status === "not_found"
      ? "Not covered. The publications I have do not answer this, so I will not guess."
      : "Held back. The model wrote an answer, but a quote did not check out word for word, so nothing is shown.", "answer"));
  }
  return card;
}

function searchView(r, a, selected) {
  const t = r.trace;
  const wrap = el("div");
  wrap.append(el("p", "Keyword search (BM25) and vector search each return their top 20; reciprocal rank fusion merges the two lists and keeps the best 8. The bar is the fused score.", "note"));
  const maxF = Math.max(...t.passages.map((p) => p.fused));
  for (const p of t.passages) {
    const det = el("details", undefined, "prow" + (selected === p.n ? " sel" : ""));
    det.dataset.n = p.n;
    if (selected === p.n) det.open = true;
    const sum = el("summary");
    const src = el("span", p.source, "psrc");
    if (a.quoted.has(p.n)) src.append(el("span", "quoted", "tag"));
    const bar = el("span", undefined, "fbar"); const fill = el("i"); fill.style.width = (100 * p.fused / maxF).toFixed(1) + "%"; bar.append(fill);
    bindTip(bar, `Passage [${p.n}]: fused score ${p.fused.toFixed(4)}, the sum of 1 / (60 + rank) over the lists it is in`);
    sum.append(el("b", `[${p.n}]`), src, el("span", `keyword ${p.kw ? "#" + p.kw : "-"} · vector ${p.vec ? "#" + p.vec : "-"}`, "ranks"),
      el("span", p.section || "(no section heading)", "sec"), bar);
    det.append(sum);
    const body = el("div", undefined, "ptext");
    body.append(highlighted(p.text, a.spans.get(p.n) ?? []));
    const link = el("a", "Open this page in the IRS PDF ↗"); link.href = p.url; link.target = "_blank"; link.rel = "noopener";
    body.append(el("br"), link);
    det.append(body);
    wrap.append(det);
  }
  return wrap;
}

function modelView(r) {
  const t = r.trace, u = t.usage;
  const wrap = el("div");
  const cost = `$${u.cost_usd.toFixed(5)}${u.batch ? " at batch price" : ""}`;
  wrap.append(el("p", `Claude Haiku 5.5 got the question and the 8 numbered passages, and had to reply in JSON: an answer plus quotes, each naming its passage. ${u.input.toLocaleString()} tokens in, ${u.output} out, ${cost}${t.ms ? ", " + secs(t.ms.model) : ""}.`, "note"));
  let pretty = t.raw;
  try { pretty = JSON.stringify(JSON.parse(t.raw), null, 2); } catch { /* show it as written */ }
  wrap.append(el("pre", pretty || "(empty reply)"));
  return wrap;
}

function checkView(r, a) {
  const t = r.trace;
  const wrap = el("div");
  wrap.append(el("p", "Code, not the model, decides what is shown: every quote must appear word for word in the passage it names (quote style, dashes, spacing, case and table layout aside).", "note"));
  if (!t.citations.length) {
    wrap.append(el("p", t.problems.length ? "Nothing to check: " + t.problems.map((p) => plain(p)).join("; ") + "." : "Nothing to check: the model said the passages do not answer the question.", "verdict"));
  }
  t.citations.forEach((c, i) => {
    const box = el("div", undefined, "check");
    const head = el("div");
    head.append(el("span", c.ok ? "✓ Matched" : "✗ Rejected", "badge " + (c.ok ? "ok" : "bad")), ` · named passage [${c.passage ?? "?"}]`);
    box.append(head, el("div", "“" + c.quote + "”"));
    const h = a.homes[i];
    if (c.ok && h) {
      const ctx = el("div", undefined, "note");
      let s = Math.max(0, h.span[0] - 80), e = Math.min(h.p.text.length, h.span[1] + 80);
      if (s > 0) { const sp = h.p.text.indexOf(" ", s); if (sp >= 0 && sp < h.span[0]) s = sp + 1; }
      if (e < h.p.text.length) { const sp = h.p.text.lastIndexOf(" ", e); if (sp > h.span[1]) e = sp; }
      ctx.append(`In passage [${h.p.n}]: ` + (s > 0 ? "…" : ""), highlighted(h.p.text.slice(s, e), [[h.span[0] - s, h.span[1] - s]]), e < h.p.text.length ? "…" : "");
      box.append(ctx);
    } else if (!c.ok) {
      box.append(el("div", "Why: " + plain(c.problem, c) + ".", "note"));
      if (h && h.elsewhere) box.append(el("div", `This exact text is in passage [${h.p.n}]. The model named the wrong passage, and a quote that names the wrong source is not shown.`, "note"));
    }
    wrap.append(box);
  });
  return wrap;
}

function resultView(r, a) { return el("p", verdictText(r, a), "verdict"); }

/** The four steps as a compact list: dot, what happened, timing. */
function timeline(r, a, liveStep) {
  const ul = el("ul", undefined, "timeline");
  const add = (dot, title, detail, time) => {
    const li = el("li"); const d = el("span", undefined, "dot " + dot);
    const mid = el("div"); mid.append(el("div", title)); if (detail) mid.append(el("div", detail, "d"));
    li.append(d, mid, el("span", time ?? "", "t")); ul.append(li);
  };
  if (liveStep !== undefined) {
    const steps = ["Searching 3,973 passages", "Claude Haiku 5.5 is reading the 8 best", "Checking every quote word for word", "Deciding what to show"];
    steps.forEach((s, i) => add(i < liveStep ? "done" : i === liveStep ? "live" : "", s, i === liveStep ? "working…" : ""));
    return ul;
  }
  const t = r.trace, u = t.usage;
  add("done", "Search picked 8 of 3,973 passages", "keyword and vector search, fused", t.ms ? t.ms.search + " ms" : "");
  add("done", "Claude Haiku 5.5 replied", `${u.input.toLocaleString()} tokens in, ${u.output} out`, t.ms ? secs(t.ms.model) : "");
  if (!a.total) add("done", "Quote check: nothing to check", r.status === "not_found" ? "the model said not covered" : t.problems.map((p) => plain(p)).join("; "));
  else add(a.ok === a.total ? "done" : "fail", `Quote check: ${a.ok} of ${a.total} matched`, a.ok === a.total ? "word for word, in the passage each one names" : "a rejected quote holds the whole answer back");
  add(r.status === "unverified" ? "fail" : "done", statusOf(r).label, verdictText(r, a));
  return ul;
}

/* ---------- layout 1: Report ---------- */
function renderReport(box, r) {
  const a = analyse(r);
  const trace = el("div", undefined, "card trace fade");
  trace.append(el("header", "How this answer was made" + (r.recorded ? ` (recorded: ${r.recorded})` : "")));
  const steps = [
    [`Search picked 8 of 3,973 passages${r.trace.ms ? " in " + r.trace.ms.search + " ms" : ""}`, searchView(r, a)],
    ["The model replied", modelView(r)],
    ["Code checked every quote", checkView(r, a)],
    ["Result", resultView(r, a)],
  ];
  steps.forEach(([title, body], i) => {
    const s = el("div", undefined, "step");
    const h = el("h3"); h.append(el("span", i + 1, "num"), el("span", title));
    s.append(h, body); trace.append(s);
  });
  box.replaceChildren(answerCard(r, a), trace);
}

/* ---------- layout 2: Sources ---------- */
function renderSources(box, r) {
  const a = analyse(r);
  let selected = [...a.quoted][0] ?? 1;
  const wrap = el("div", undefined, "split fade"); wrap.dataset.tab = "answer";
  const tabs = el("div", undefined, "tabs"); tabs.setAttribute("role", "tablist");
  const setTab = (k) => { wrap.dataset.tab = k; tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === k))); };
  for (const [k, label] of [["answer", "Answer"], ["sources", "Sources (8)"], ["steps", "Steps"]]) {
    const b = el("button", label); b.type = "button"; b.dataset.k = k; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === "answer")); b.onclick = () => setTab(k); tabs.append(b);
  }
  const side = el("aside", undefined, "card side p-sources");
  const sideHead = el("header"); sideHead.append(el("h3", "Sources"), el("span", "8 of 3,973 passages", "note"));
  const list = el("div");
  side.append(sideHead, list);
  const select = (n) => {
    selected = n;
    list.replaceChildren(searchView(r, a, n));
    box.querySelectorAll("button.cite").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.textContent) === n)));
    if (matchMedia("(max-width: 820px)").matches) setTab("sources");
    const row = list.querySelector(`.prow[data-n="${n}"]`);
    if (row) side.scrollTo({ top: row.offsetTop - side.offsetTop - 50, behavior: reduced ? "auto" : "smooth" });
  };
  const leftCol = el("div");
  const steps = el("div", undefined, "card answer-card p-steps"); steps.style.marginTop = "14px";
  steps.append(el("h3", "What happened"), timeline(r, a));
  leftCol.append(el("div", undefined, "p-answer"), steps);
  leftCol.firstChild.append(answerCard(r, a, select));
  wrap.append(tabs, leftCol, side);
  box.replaceChildren(wrap);
  list.replaceChildren(searchView(r, a, selected));
  box.querySelectorAll("button.cite").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.textContent) === selected)));
}

/* ---------- layout 3: Walkthrough ---------- */
function renderWalkthrough(box, r, autoplay) {
  const a = analyse(r);
  const t = r.trace;
  const steps = [
    ["Search", t.ms ? t.ms.search + " ms" : "8 passages", () => searchView(r, a)],
    ["Claude", t.ms ? secs(t.ms.model) : `${t.usage.output} tokens`, () => modelView(r)],
    ["Quote check", a.total ? `${a.ok}/${a.total} matched` : "nothing to check", () => checkView(r, a)],
    ["Result", statusOf(r).short, () => { const f = el("div"); f.append(answerCard(r, a), el("div", undefined, "")); f.lastChild.style.marginTop = "12px"; f.lastChild.append(resultView(r, a)); return f; }],
  ];
  let cur = autoplay && !reduced ? 0 : 3;
  let timer = null;
  const root = el("div", undefined, "fade");
  root.append(el("p", (r.recorded ? "Recorded run " + (r.id ?? "") + ": " : "") + r.question, "qline"));
  const ol = el("ol", undefined, "stepper");
  const panel = el("div", undefined, "card wt-panel");
  const nav = el("div", undefined, "wt-nav");
  const back = el("button", "← Back", "ghost"), next = el("button", "Next →", "ghost"), replay = el("button", "▶ Replay", "ghost"), count = el("span", "", "note");
  [back, next, replay].forEach((b) => { b.type = "button"; });
  const show = (i) => {
    cur = clamp(i, 0, 3);
    ol.replaceChildren();
    steps.forEach(([name, sub], k) => {
      const li = el("li", undefined, k < cur ? "done" : k === cur ? "cur" : "");
      const b = el("button"); b.type = "button"; b.onclick = () => { stop(); show(k); };
      b.append(el("span", k < cur ? "✓" : k + 1, "c"), el("span", name), el("span", sub, "note"));
      if (k === cur) b.setAttribute("aria-current", "step");
      li.append(b); ol.append(li);
    });
    const body = steps[cur][2](); body.classList.add("fade");
    panel.replaceChildren(el("h3", `${cur + 1}. ${steps[cur][0]}`), body);
    count.textContent = `Step ${cur + 1} of 4`;
    back.disabled = cur === 0; next.disabled = cur === 3;
  };
  const stop = () => { clearTimeout(timer); timer = null; replay.textContent = "▶ Replay"; };
  const play = () => {
    stop(); show(0); replay.textContent = "■ Stop";
    // each step stays on screen in proportion to how long it really took, within readable bounds
    const holds = [t.ms ? clamp(t.ms.search * 4, 900, 1800) : 1200, t.ms ? clamp(t.ms.model * 0.8, 1200, 2600) : 1800, 1400];
    const tick = (i) => { if (i > 3) return stop(); show(i); if (i < 3) timer = setTimeout(() => tick(i + 1), holds[i]); else stop(); };
    timer = setTimeout(() => tick(1), holds[0]);
  };
  back.onclick = () => { stop(); show(cur - 1); };
  next.onclick = () => { stop(); show(cur + 1); };
  replay.onclick = () => (timer ? stop() : play());
  root.tabIndex = -1;
  root.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { stop(); show(cur + 1); } if (e.key === "ArrowLeft") { stop(); show(cur - 1); } });
  const navL = el("div"); navL.style.display = "flex"; navL.style.gap = "8px"; navL.append(back, next, replay);
  nav.append(navL, count);
  root.append(ol, panel, nav);
  box.replaceChildren(root);
  show(cur);
  if (autoplay && !reduced) play();
}

/* ---------- layout 4: Console ---------- */
function renderConsole(box, r) {
  const a = analyse(r);
  const t = r.trace, u = t.usage;
  const card = el("div", undefined, "card console fade");
  const head = el("header");
  const top = el("div"); top.style.display = "flex"; top.style.gap = "8px"; top.style.flexWrap = "wrap"; top.style.alignItems = "center";
  top.append(el("span", statusOf(r).label, "pill " + statusOf(r).key), el("span", r.recorded ? "recorded run " + (r.id ?? "") : "live run", "tag"));
  const m = el("div", undefined, "metrics");
  const metric = (k, v) => { const s = el("span", k + " "); s.append(el("b", v)); m.append(s); };
  if (t.ms) { metric("search", t.ms.search + " ms"); metric("model", secs(t.ms.model)); }
  metric("tokens", `${u.input.toLocaleString()} in / ${u.output} out`);
  metric("cost", "$" + u.cost_usd.toFixed(5) + (u.batch ? " (batch)" : ""));
  metric("quotes", a.total ? `${a.ok}/${a.total} matched` : "none");
  head.append(top, el("div", r.question), m);
  const spans = [
    ["run", "ask", 0, t.ms ? secs(t.ms.search + t.ms.model) : "", () => answerCard(r, a)],
    ["retrieve", "retrieve", 1, t.ms ? t.ms.search + " ms" : "8 passages", () => searchView(r, a)],
    ["keyword", "keyword · BM25", 2, "top 20", () => rankTable(r, "kw", "keyword search")],
    ["vector", "vector · bge-small", 2, "top 20", () => rankTable(r, "vec", "vector search")],
    ["generate", "generate · haiku", 1, t.ms ? secs(t.ms.model) : `${u.output} tok`, () => modelView(r)],
    ["verify", "verify quotes", 1, a.total ? `${a.ok}/${a.total}` : "-", () => checkView(r, a)],
    ["result", "result", 1, statusOf(r).short, () => resultView(r, a)],
  ];
  const tree = el("ul", undefined, "tree");
  const detail = el("div", undefined, "span-detail");
  const pick = (key) => {
    tree.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === key)));
    const s = spans.find((x) => x[0] === key);
    detail.replaceChildren(el("h3", s[1]), s[4]());
  };
  for (const [key, label, lvl, time] of spans) {
    const li = el("li"); const b = el("button", undefined, "lvl" + lvl); b.type = "button"; b.dataset.k = key;
    b.append(el("span", label, "k"), el("span", time, "t")); b.onclick = () => pick(key);
    li.append(b); tree.append(li);
  }
  const wrap = el("div", undefined, "tree-wrap"); wrap.append(tree, detail);
  card.append(head, wrap);
  box.replaceChildren(card);
  pick(a.ok < a.total ? "verify" : "run");
}
function rankTable(r, key, name) {
  const rows = r.trace.passages.filter((p) => p[key]).sort((x, y) => x[key] - y[key]);
  const wrap = el("div");
  wrap.append(el("p", `Where the 8 passages that reached the model sat in ${name}'s top 20. A passage missing here was found only by the other search; fusion is what brought it in.`, "note"));
  const tb = el("table", undefined, "data"); const hd = el("tr");
  for (const h of ["Rank", "Passage", "Source"]) hd.append(el("th", h)); tb.append(hd);
  for (const p of rows) { const tr = el("tr"); tr.append(el("td", "#" + p[key]), el("td", `[${p.n}]`), el("td", p.source)); tb.append(tr); }
  wrap.append(tb);
  return wrap;
}

const RENDER = { report: renderReport, sources: renderSources, walkthrough: renderWalkthrough, console: renderConsole };

/* ---------- the stage: ask box, examples, result; arranged per layout ---------- */
function askForm() {
  const f = el("form", undefined, "ask"); f.id = "ask";
  const lab = el("label", "Your question", "sr"); lab.htmlFor = "q";
  const q = el("input"); q.id = "q"; q.maxLength = 300; q.autocomplete = "off"; q.required = true;
  q.placeholder = "e.g. What is the 2025 standard deduction for a single person?";
  const go = el("button", "Ask", "primary"); go.id = "go"; go.type = "submit";
  f.append(lab, q, go);
  f.addEventListener("submit", (e) => { e.preventDefault(); const v = q.value.trim(); if (v) ask(v); });
  return f;
}
function liveChips() {
  const row = el("div", undefined, "chips"); row.append(el("span", "Try:", "lab"));
  for (const qtext of LIVE_EXAMPLES) {
    const b = el("button", qtext, "chip"); b.type = "button";
    b.onclick = () => { $("q").value = qtext; ask(qtext); };
    row.append(b);
  }
  return row;
}
function recordedChips() {
  const wrap = el("div");
  const groups = new Map();
  for (const ex of state.data?.examples ?? []) { if (!groups.has(ex.group)) groups.set(ex.group, []); groups.get(ex.group).push(ex); }
  const first = el("div", undefined, "chips"); first.append(el("span", "Or replay a recorded run, free:", "lab")); wrap.append(first);
  for (const [g, list] of groups) {
    const row = el("div", undefined, "chips"); row.append(el("span", g + ":", "lab"));
    for (const ex of list) {
      const b = el("button", ex.label, "chip"); b.type = "button"; b.dataset.id = ex.id;
      b.setAttribute("aria-pressed", String(state.selected === ex.id));
      b.onclick = () => pickExample(ex.id);
      row.append(b);
    }
    wrap.append(row);
  }
  return wrap;
}
function runsTable() {
  const tb = el("table", undefined, "runs");
  for (const ex of state.data?.examples ?? []) {
    const tr = el("tr"); tr.tabIndex = 0; tr.dataset.id = ex.id; tr.setAttribute("aria-selected", String(state.selected === ex.id));
    const st = statusOf(ex);
    const mid = el("td", ex.label); tr.title = ex.question;
    const pill = el("td"); pill.append(el("span", st.short, "pill " + st.key));
    tr.append(el("td", ex.id, "rid"), mid, pill);
    tr.onclick = () => pickExample(ex.id);
    tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickExample(ex.id); } };
    tb.append(tr);
  }
  return tb;
}
function limitsNote() {
  const p = el("p", undefined, "hint");
  const k = el("span", undefined, "kbd-hint"); k.append(" Press ", el("kbd", "/"), " to type a question.");
  p.append("10 live questions per visitor per day, about $0.0005 each.", k);
  return p;
}
function buildStage() {
  const stage = $("stage");
  const result = el("div", undefined, "result"); result.id = "result"; result.setAttribute("aria-live", "polite");
  if (state.layout === "console") {
    const left = el("div", undefined, "card answer-card");
    left.append(askForm(), liveChips(), limitsNote());
    const h = el("h3", "Recorded runs"); h.style.marginTop = "18px";
    left.append(h, el("p", "From the evaluation, same model. Free to open.", "note"), runsTable());
    const bench = el("div", undefined, "bench"); bench.style.marginTop = "18px";
    bench.append(left, result);
    result.style.marginTop = "0";
    stage.replaceChildren(bench);
  } else {
    const top = el("div", undefined, "narrow"); top.style.marginTop = "18px";
    top.append(askForm(), liveChips(), recordedChips(), limitsNote());
    if (state.layout !== "sources") result.classList.add("narrow");
    stage.replaceChildren(top, result);
  }
  renderResult(false);
}
function renderResult(autoplay) {
  const box = $("result"); if (!box) return;
  document.querySelectorAll("[data-id]").forEach((n) => n.setAttribute(n.tagName === "TR" ? "aria-selected" : "aria-pressed", String(n.dataset.id === state.selected)));
  const r = state.result;
  if (!r) {
    box.replaceChildren();
    if (state.layout === "console") box.append(el("div", "Pick a recorded run on the left, or ask a question.", "card placeholder"));
    return;
  }
  if (r.message) {
    const card = el("div", undefined, "card answer-card fade");
    const p = el("p", r.message + " ", "answer");
    if (r.contact) { const a = el("a", "Contact Mat"); a.href = r.contact; p.append(a); }
    card.append(p, el("p", "The recorded runs still show every step, at no cost.", "note"));
    box.replaceChildren(card);
    return;
  }
  if (state.layout === "walkthrough") renderWalkthrough(box, r, autoplay);
  else RENDER[state.layout](box, r);
}
function showLoading(q) {
  const box = $("result"); if (!box) return;
  const card = el("div", undefined, "card answer-card fade");
  card.append(el("p", q, "qline"), timeline(null, null, 0));
  box.replaceChildren(card);
  let i = 0;
  const step = () => { if (!state.loading || i >= 2) return; i += 1; card.replaceChild(timeline(null, null, i), card.lastChild); setTimeout(step, 900); };
  setTimeout(step, 400);
}

async function ask(q) {
  if (state.loading) return;
  state.loading = true; state.selected = null;
  const go = $("go"); if (go) { go.disabled = true; go.textContent = "Looking…"; }
  setUrl({ example: null });
  showLoading(q);
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
    const d = await res.json();
    if (d.status === "busy") state.result = { question: q, message: d.message, contact: d.contact };
    else if (d.trace) state.result = { ...d, question: q };
    else state.result = { question: q, message: d.error || "Something went wrong. Try again." };
  } catch {
    state.result = { question: q, message: "Something went wrong. Try again." };
  }
  state.loading = false;
  const go2 = $("go"); if (go2) { go2.disabled = false; go2.textContent = "Ask"; }
  renderResult(true);
}
function pickExample(id) {
  const ex = state.data.examples.find((x) => x.id === id); if (!ex) return;
  state.result = { ...ex };
  state.selected = id;
  setUrl({ example: id });
  renderResult(true);
  // the console shows runs and trace side by side; once it stacks on a narrow screen, scroll like the others
  if (state.layout !== "console" || matchMedia("(max-width: 900px)").matches) $("result").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

/* ---------- layout switcher ---------- */
function setUrl(change) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(change)) { if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
  history.replaceState(null, "", u);
}
function buildSwitch() {
  const sw = $("switch"); sw.replaceChildren();
  for (const [key, l] of Object.entries(LAYOUTS)) {
    const b = el("button", l.name); b.type = "button"; b.title = l.hint;
    b.setAttribute("aria-pressed", String(state.layout === key));
    b.onclick = () => {
      if (state.layout === key) return;
      state.layout = key; localStorage.setItem("layout", key); setUrl({ layout: key });
      sw.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      $("layout-hint").textContent = l.hint;
      const q = $("q")?.value ?? "";
      buildStage();
      if ($("q")) $("q").value = q;
    };
    sw.append(b);
  }
  $("layout-hint").textContent = LAYOUTS[state.layout].hint;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "")) { e.preventDefault(); $("q")?.focus(); }
});

/* ---------- How it works ---------- */
const PIPELINE = [
  ["Your question", "up to 300 characters", "The question goes to two searches at once. This page does not store it; the only thing kept is a salted hash of your IP address for the day, to enforce 10 questions per visitor."],
  ["Keyword search", "SQLite FTS5, BM25", "A full-text index over 3,973 passages from the 11 publications, ranked with BM25, with section headings weighted double. It catches exact terms: “Form 8829”, “$15,750”, “substantial presence test”. Returns its top 20."],
  ["Vector search", "bge-small, 384 numbers", "Every passage, and your question, is turned into 384 numbers by the bge-small-en-v1.5 embedding model; Cloudflare Vectorize returns the 20 passages whose numbers point the same way. It catches paraphrases: “home office” finds “business use of your home”."],
  ["Fuse, keep 8", "reciprocal rank fusion", "Each passage scores 1 / (60 + its rank) in each list it appears in, and the 8 best go to the model. No score calibration needed. In the 115-question evaluation, fusing found 78% of the facts an answer needs in the top 5, against 69% for keyword or vector search alone."],
  ["Claude Haiku 5.5", "answer + quotes as JSON", "The model sees only the question and the 8 passages, numbered [1] to [8] with publication, tax year, page and section. It must reply in a fixed JSON shape: an answer, and quotes copied word for word, each naming its passage. Thinking off, low effort: about $0.0005 a question."],
  ["Quote check", "code, not the model", "Code decides what you see. There must be at least one quote; every quote must be 3 to 100 words and appear word for word in the passage it names, ignoring quote style, dashes, spacing, case and table layout. If anything fails, the answer is held back. The result links each quote to its page in the IRS PDF."],
];
function buildPipeline() {
  const flow = $("flow");
  let split = null;
  PIPELINE.forEach(([title, small, text], i) => {
    const b = el("button", undefined, "node"); b.type = "button"; b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", "explain");
    b.append(el("span", String(i < 2 ? i + 1 : i === 2 ? 2 : i).padStart(2, "0"), "n"), el("b", title), el("span", small));
    b.onclick = () => {
      const open = b.getAttribute("aria-expanded") === "true";
      flow.querySelectorAll(".node").forEach((n) => n.setAttribute("aria-expanded", "false"));
      if (open) { $("explain").hidden = true; return; }
      b.setAttribute("aria-expanded", "true");
      $("explain").replaceChildren(el("h3", title), el("p", text));
      $("explain").hidden = false;
    };
    if (i === 1 || i === 2) {
      if (!split) { split = el("div", undefined, "node split-n"); flow.append(split); }
      split.append(b);
    } else flow.append(b);
  });
}

/* ---------- How well it works ---------- */
function buildResults(data) {
  const R = data.results;
  const haiku = R.runs.find((r) => /this demo/.test(r.label));
  const sonnetReview = R.review["claude-sonnet-5-5"], haikuReview = R.review["claude-haiku-5-5"];
  $("results-sub").textContent = `Measured on ${data.eval.questions} hand-written questions: ${data.eval.answerable} with an answer in the publications, ${haiku.not_found_n} whose answer is not there, ${haiku.attacks_n} prompt-injection attacks. Graded by code, strictly, with no model judging another model.`;
  const tiles = [
    [pct(haiku.precision_when_shown), `of the answers this demo shows are right (Claude Haiku 5.5, ${haiku.correct + haiku.wrong} shown of ${haiku.n})`],
    [String(sonnetReview.real_error), "real errors from Claude Sonnet 5.5, after reading every answer graded wrong by hand"],
    [`${haiku.not_found_held} / ${haiku.not_found_n}`, "questions not in the publications, declined instead of guessed"],
    [`${haiku.attacks_held} / ${haiku.attacks_n}`, "prompt-injection attacks held"],
    ["$" + haiku.usd_per_1000_realtime.toFixed(2), "per 1,000 questions on Haiku, standard API prices"],
  ];
  for (const [v, l] of tiles) { const t = el("div", undefined, "card tile"); t.append(el("div", v, "v"), el("div", l, "l")); $("tiles").append(t); }

  const parts = [["correct", "Correct", "--c-correct"], ["abstained", "Held back", "--c-held"], ["wrong", "Wrong", "--c-wrong"]];
  for (const [, name, v] of parts) { const s = el("span"); const i = el("i"); i.style.background = `var(${v})`; s.append(i, name); $("legend").append(s); }
  for (const r of R.runs) {
    const row = el("div", undefined, "crow");
    const lab = el("div", undefined, "lab"); lab.append(el("b", r.label), el("span", `${pct(r.precision_when_shown)} of shown answers right`));
    const stack = el("div", undefined, "stack");
    for (const [k, name, v] of parts) {
      if (!r[k]) continue;
      const seg = el("div", r[k], "seg"); seg.style.flex = `${r[k]} 0 0`; seg.style.background = `var(${v})`;
      bindTip(seg, `${r.label}: ${name} ${r[k]} of ${r.n} (${pct(r[k] / r.n)})`);
      stack.append(seg);
    }
    row.append(lab, stack); $("outcomes").append(row);
  }
  requestAnimationFrame(() => document.querySelectorAll(".seg").forEach((s) => { if (s.scrollWidth > s.clientWidth) s.textContent = ""; }));
  const t1 = el("table", undefined, "data"); const h1 = el("tr");
  for (const h of ["Run", "Correct", "Held back", "Wrong", "Right when shown", "Cost per 1,000"]) h1.append(el("th", h, h === "Run" ? "" : "n"));
  t1.append(h1);
  for (const r of R.runs) {
    const tr = el("tr");
    tr.append(el("td", r.label), el("td", r.correct, "n"), el("td", r.abstained, "n"), el("td", r.wrong, "n"), el("td", pct(r.precision_when_shown), "n"),
      el("td", r.usd_per_1000_realtime !== undefined ? "$" + r.usd_per_1000_realtime.toFixed(2) : r.variant ? "-" : "$0, local", "n"));
    t1.append(tr);
  }
  $("outcomes-table").append(t1);
  const qwen = R.runs.find((r) => /qwen2\.5 7B, local/.test(r.label)), qwenOff = R.runs.find((r) => /qwen 7B, quote check off/.test(r.label));
  const sonnet = R.runs.find((r) => /Sonnet/.test(r.label));
  for (const f of [
    `Every answer the grader called wrong was read by hand. Sonnet: ${sonnetReview.key_too_strict} were right in other words, ${sonnetReview.partial_retrieval_miss} were honest partial answers, ${sonnetReview.real_error} real errors. Haiku: ${haikuReview.real_error} real errors.`,
    `The quote check matters less as the model gets stronger: on Sonnet it never fired; on the local 7B model it stopped ${qwenOff.wrong - qwen.wrong} wrong answers and also hid ${qwenOff.correct - qwen.correct} right ones.`,
    `Search is now the limit: the 8 passages held ${pct(sonnet.evidence_in_context, 0)} of the facts the answers needed, and every honest partial answer was missing a fact search never found.`,
  ]) $("findings").append(el("li", f));

  const m5 = Math.max(...R.methods.map((m) => m["evidence@5"]));
  $("search-sub").textContent = `Share of the facts an answer needs that appear in the top 5 passages, ${R.methods[0].n} questions.`;
  for (const m of R.methods) {
    const row = el("div", undefined, "hbar"); const track = el("div", undefined, "track");
    const fill = el("div", undefined, "fill"); fill.style.width = (100 * m["evidence@5"] / m5 * 0.82).toFixed(1) + "%";
    bindTip(fill, `${m.label}: ${pct(m["evidence@5"])} in the top 5, ${pct(m["evidence@10"])} in the top 10, median ${Math.round(m.median_ms).toLocaleString()} ms on a laptop`);
    track.append(fill, el("span", pct(m["evidence@5"], 0)));
    row.append(el("span", m.label), track); $("search").append(row);
  }
  const t2 = el("table", undefined, "data"); const h2 = el("tr");
  for (const h of ["Search", "Top 5", "Top 10", "Median ms"]) h2.append(el("th", h, h === "Search" ? "" : "n"));
  t2.append(h2);
  for (const m of R.methods) { const tr = el("tr"); tr.append(el("td", m.label), el("td", pct(m["evidence@5"]), "n"), el("td", pct(m["evidence@10"]), "n"), el("td", Math.round(m.median_ms).toLocaleString(), "n")); t2.append(tr); }
  $("search-table").append(t2);
  document.querySelectorAll("[data-table]").forEach((b) => (b.onclick = () => {
    const t = $(b.dataset.table); t.hidden = !t.hidden; b.textContent = t.hidden ? "Show as a table" : "Hide the table";
  }));
}

/* ---------- start ---------- */
buildSwitch();
buildPipeline();
buildStage();
state.data = await (await fetch("/site-data.json")).json();
buildResults(state.data);
buildStage();
const wanted = params.get("example");
if (wanted && state.data.examples.some((x) => x.id === wanted)) pickExample(wanted);
