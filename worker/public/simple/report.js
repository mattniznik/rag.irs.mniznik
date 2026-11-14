// The page logic of the three simple layouts (simple/). The content is the same in every layout; a layout only
// changes the look and replaces the "How it works" picture through window.DESIGN.flow(root, api).
// Off the live site the ask box cannot call Claude, so it replays a recorded run when the question matches one.
(function () {
  "use strict";
  const DATA = window.RAG, locate = window.locate, DESIGN = window.DESIGN || {};
  const LIVE = window.RAG_LIVE === true; // set by studio/loader.js: true on rag.irs.mniznik.com, where /api/ask answers
  const MOTION = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (MOTION) document.documentElement.classList.add("motion");

  const $ = (id) => document.getElementById(id);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = String(text); if (cls) n.className = cls; return n; }
  const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
  const replayAnim = (n) => { n.classList.remove("anim"); void n.offsetWidth; n.classList.add("anim"); };

  /* ---------- tooltip shared by charts ---------- */
  const tip = $("tip");
  function bindTip(node, text) {
    node.tabIndex = 0;
    node.setAttribute("aria-label", text);
    const show = (x, y) => { tip.textContent = text; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.min(x + 12, innerWidth - w - 8) + "px"; tip.style.top = (y + 14) + "px"; };
    node.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
    node.addEventListener("pointerleave", () => { tip.hidden = true; });
    node.addEventListener("focus", () => { const r = node.getBoundingClientRect(); show(r.left, r.bottom - 10); });
    node.addEventListener("blur", () => { tip.hidden = true; });
  }

  /* ---------- check problems in plain words, with passage numbers instead of internal ids ---------- */
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

  /* ---------- text with highlighted spans ---------- */
  function highlighted(text, spans) {
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
      if (s < at) continue;
      frag.append(text.slice(at, s));
      frag.append(el("mark", text.slice(s, e)));
      at = e;
    }
    frag.append(text.slice(at));
    return frag;
  }

  /* ---------- the trace viewer: live answers and recorded examples ---------- */
  function renderTrace(box, d, recorded) {
    box.replaceChildren();
    const t = d.trace;
    if (recorded) box.append(el("p", "Question: " + d.question, "answer"));
    if (d.status === "answered") {
      box.append(el("p", d.answer, "answer"));
      for (const c of t.citations.filter((c) => c.ok)) {
        const p = t.passages[Number(c.passage) - 1];
        const q = el("blockquote", "“" + c.quote + "”");
        if (p) { const a = el("a", p.source); a.href = p.url; a.target = "_blank"; a.rel = "noopener"; q.append(a); }
        box.append(q);
      }
    } else {
      box.append(el("p", d.status === "not_found"
        ? "Not covered: the model said the publications do not answer this, so nothing is shown."
        : "Held back: the model wrote an answer, but its quotes did not check out, so nothing is shown.", "answer"));
    }
    if (!t) return;

    const wrap = el("div", undefined, "trace");
    wrap.append(el("header", "How this answer was made" + (recorded ? ` (recorded: ${d.recorded})` : "")));

    const spans = new Map();
    const quoteHome = (c) => {
      const named = t.passages[Number(c.passage) - 1];
      const here = named ? locate(named.text, c.quote) : null;
      if (here) return { p: named, span: here };
      for (const p of t.passages) { const s = locate(p.text, c.quote); if (s) return { p, span: s, elsewhere: true }; }
      return null;
    };
    const homes = t.citations.map(quoteHome);
    homes.forEach((h, i) => { if (h && t.citations[i].ok) { const a = spans.get(h.p.n) ?? []; a.push(h.span); spans.set(h.p.n, a); } });
    const quotedN = new Set([...spans.keys()]);

    // step 1: search
    const s1 = el("div", undefined, "step");
    const h1 = el("h3"); h1.append(el("span", "1", "num"), el("span", `Search picked 8 of 3,973 passages${t.ms ? ` in ${t.ms.search} ms` : ""}`));
    s1.append(h1, el("p", "Keyword search (BM25) and vector search each return their top 20; reciprocal rank fusion merges the two lists and keeps the best 8. The bar is the fused score. Open a passage to read it.", "note"));
    const maxF = Math.max(...t.passages.map((p) => p.fused));
    const fills = [];
    for (const p of t.passages) {
      const det = el("details", undefined, "prow");
      const sum = el("summary");
      const src = el("span", p.source, "src");
      if (quotedN.has(p.n)) src.append(el("span", "quoted", "tag"));
      sum.append(el("b", `[${p.n}]`), src,
        el("span", `keyword ${p.kw ? "#" + p.kw : "-"} · vector ${p.vec ? "#" + p.vec : "-"}`, "ranks"),
        el("span", p.section || "(no section heading)", "sec"));
      const bar = el("span", undefined, "fbar"); const fill = el("i"); fill.dataset.w = (100 * p.fused / maxF).toFixed(1) + "%"; bar.append(fill); sum.append(bar);
      fills.push(fill);
      bindTip(bar, `Passage [${p.n}]: fused score ${p.fused.toFixed(4)} = sum of 1 / (60 + rank) over the lists it is in`);
      det.append(sum);
      const body = el("div", undefined, "ptext"); body.append(highlighted(p.text, spans.get(p.n) ?? []));
      const link = el("a", "Open this page in the IRS PDF"); link.href = p.url; link.target = "_blank"; link.rel = "noopener";
      body.append(el("br"), link);
      det.append(body);
      s1.append(det);
    }
    wrap.append(s1);

    // step 2: the model
    const s2 = el("div", undefined, "step");
    const h2 = el("h3"); h2.append(el("span", "2", "num"), el("span", "The model replied"));
    const u = t.usage;
    const costNote = u.batch ? ` ($${u.cost_usd.toFixed(5)} at batch price)` : ` ($${u.cost_usd.toFixed(5)})`;
    s2.append(h2, el("p", `Claude Haiku 5.5 got the question and the 8 numbered passages, and had to reply in JSON: an answer plus quotes, each naming its passage. ${u.input.toLocaleString()} tokens in, ${u.output} out${costNote}${t.ms ? `, ${(t.ms.model / 1000).toFixed(1)} s` : ""}.`, "note"));
    let pretty = t.raw;
    try { pretty = JSON.stringify(JSON.parse(t.raw), null, 2); } catch { /* show as written */ }
    s2.append(el("pre", pretty || "(empty reply)"));
    wrap.append(s2);

    // step 3: quote check
    const s3 = el("div", undefined, "step");
    const h3 = el("h3"); h3.append(el("span", "3", "num"), el("span", "Code checked every quote"));
    s3.append(h3);
    if (!t.citations.length) {
      s3.append(el("p", t.problems.length ? "Nothing to check: " + t.problems.map((p) => plain(p)).join("; ") + "." : "Nothing to check: the model said the passages do not answer the question.", "note"));
    }
    t.citations.forEach((c, i) => {
      const box3 = el("div", undefined, "check");
      const head = el("div");
      head.append(el("span", c.ok ? "✓ Matched" : "✗ Rejected", "badge " + (c.ok ? "ok" : "bad")), ` · named passage [${c.passage ?? "?"}]`);
      box3.append(head, el("div", "“" + c.quote + "”"));
      const h = homes[i];
      if (c.ok && h) {
        const ctx = el("div", undefined, "note");
        let a = Math.max(0, h.span[0] - 80), b = Math.min(h.p.text.length, h.span[1] + 80);
        if (a > 0) { const sp = h.p.text.indexOf(" ", a); if (sp >= 0 && sp < h.span[0]) a = sp + 1; }
        if (b < h.p.text.length) { const sp = h.p.text.lastIndexOf(" ", b); if (sp > h.span[1]) b = sp; }
        ctx.append("In passage [" + h.p.n + "]: " + (a > 0 ? "…" : ""), highlighted(h.p.text.slice(a, b), [[h.span[0] - a, h.span[1] - a]]), b < h.p.text.length ? "…" : "");
        box3.append(ctx);
      } else if (!c.ok) {
        box3.append(el("div", "Why: " + plain(c.problem, c) + ".", "note"));
        if (h && h.elsewhere) box3.append(el("div", `This exact text is in passage [${h.p.n}]. The model named the wrong passage, and a quote that names the wrong source is not shown.`, "note"));
      }
      s3.append(box3);
    });
    wrap.append(s3);

    // step 4: result
    const s4 = el("div", undefined, "step");
    const h4 = el("h3"); h4.append(el("span", "4", "num"), el("span", "Result"));
    const why = d.status === "answered" ? "Shown: every quote matched the passage it names."
      : d.status === "not_found" ? "Not found: shown as “not covered”. Nothing invented."
      : "Held back: " + ([...t.citations.filter((c) => !c.ok).map((c) => plain(c.problem, c)), ...t.problems.map((p) => plain(p))].join("; ") || "the reply did not pass the check") + ".";
    s4.append(h4, el("p", why, "verdict"));
    wrap.append(s4);
    box.append(wrap);

    // motion: the answer first, then each step of the trace in turn; the fused-score bars grow in step 1
    let i = 0;
    for (const c of box.children) c.style.setProperty("--i", i++);
    for (const c of wrap.children) c.style.setProperty("--i", i++);
    const s1Delay = (i - 4) * 260;
    for (const f of fills) {
      if (!MOTION) { f.style.width = f.dataset.w; continue; }
      f.style.width = "0%"; f.style.transitionDelay = s1Delay + 350 + "ms";
      requestAnimationFrame(() => requestAnimationFrame(() => { f.style.width = f.dataset.w; }));
    }
    replayAnim(box);
  }

  /* ---------- while an answer is on its way ---------- */
  function loading(out) {
    const box = el("div", undefined, "loading");
    const names = ["Searching 3,973 passages", "Claude Haiku 5.5 is answering", "Checking every quote"];
    const parts = names.map((n, i) => { const s = el("span", n, "ls"); if (i) box.append(el("span", "→", "arrow")); box.append(s); return s; });
    out.replaceChildren(box);
    let k = 0; parts[0].classList.add("on");
    const at = [500, 1700];
    const timers = at.map((ms, i) => setTimeout(() => { parts[i].classList.replace("on", "done"); parts[i + 1].classList.add("on"); k = i + 1; }, ms));
    return () => timers.forEach(clearTimeout);
  }

  /* ---------- live questions ---------- */
  const live = [
    "What is the 2025 standard deduction for a single person?",
    "How many days do I need to be in the US for the substantial presence test?",
    "What was the standard deduction for married filing jointly in 2023?",
    "When is the Delaware franchise tax report due?",
  ];
  for (const q of live) {
    const b = el("button", q, "chip"); b.type = "button";
    b.onclick = () => { $("q").value = q; $("ask").requestSubmit(); };
    $("live-examples").append(b);
  }
  // preview only: the recorded run whose question shares at least half its words with this one
  function recordedFor(q) {
    const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9$]+/g) || []);
    const a = words(q); let best = null, score = 0;
    for (const ex of DATA.examples) {
      const b = words(ex.question); const both = [...a].filter((x) => b.has(x)).length;
      const s = both / (a.size + b.size - both);
      if (s > score) { score = s; best = ex; }
    }
    return score >= 0.5 ? best : null;
  }
  // the turning ring around the question box (styles in base.css): it marks where to type, and spins fast while an answer loads
  const ring = el("div", undefined, "askring"); $("q").before(ring); ring.append($("q"));
  $("ask").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = $("q").value.trim(); if (!q) return;
    const go = $("go"), out = $("result");
    go.disabled = true; go.textContent = "Looking…"; ring.classList.add("fast");
    out.hidden = false;
    const stop = loading(out);
    try {
      if (!LIVE) {
        await new Promise((r) => setTimeout(r, MOTION ? 2400 : 0));
        stop();
        const ex = recordedFor(q);
        if (ex) {
          renderTrace(out, ex, true);
          out.prepend(el("p", `Design preview: this replays recorded run ${ex.id}. On rag.irs.mniznik.com the question goes to Claude live.`, "preview-note"));
        } else {
          out.replaceChildren(el("p", "This design preview cannot call Claude. On rag.irs.mniznik.com this question gets a live answer.", "answer"),
            el("p", "The recorded examples below still show every step.", "note"));
        }
      } else {
        const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
        const d = await res.json();
        stop();
        if (d.status === "busy") {
          out.replaceChildren();
          const p = el("p", d.message + " ", "answer"); const a = el("a", "Contact Mat"); a.href = d.contact; p.append(a);
          out.append(p, el("p", "The recorded examples below still show every step.", "note"));
        } else if (d.trace) {
          renderTrace(out, { ...d, question: q }, false);
        } else {
          out.replaceChildren(el("p", d.error || "Something went wrong. Try again.", "answer"));
        }
      }
    } catch { stop(); out.replaceChildren(el("p", "Something went wrong. Try again.", "answer")); }
    go.disabled = false; go.textContent = "Ask"; ring.classList.remove("fast");
  });

  /* ---------- pipeline: the steps and their explanations ---------- */
  const steps = [
    ["Your question", "up to 300 characters", "The question goes to two searches at once. This page does not store it; the only thing kept is a salted hash of your IP address for the day, to enforce 10 questions per visitor."],
    ["Keyword search", "SQLite FTS5, BM25", "A full-text index over 3,973 passages from the 11 publications, ranked with BM25, with section headings weighted double. It catches exact terms: “Form 8829”, “$15,750”, “substantial presence test”. Returns its top 20."],
    ["Vector search", "bge-small, 384 numbers", "Every passage, and your question, is turned into 384 numbers by the bge-small-en-v1.5 embedding model; Cloudflare Vectorize returns the 20 passages whose numbers point the same way. It catches paraphrases: “home office” finds “business use of your home”."],
    ["Fuse, keep 8", "reciprocal rank fusion", "Each passage scores 1 / (60 + its rank) in each list it appears in, and the 8 best go to the model. No score calibration needed. In the 115-question evaluation, fusing found 78% of the facts an answer needs in the top 5, against 69% for keyword or vector search alone."],
    ["Claude Haiku 5.5", "answer + quotes as JSON", "The model sees only the question and the 8 passages, numbered [1] to [8] with publication, tax year, page and section. It must reply in a fixed JSON shape: an answer, and quotes copied word for word, each naming its passage. Thinking off, low effort: about $0.0005 a question."],
    ["Quote check", "code, not the model", "Code decides what you see. There must be at least one quote; every quote must be 3 to 100 words and appear word for word in the passage it names, ignoring quote style, dashes, spacing, case and table layout. If anything fails, the answer is held back. The result links each quote to its page in the IRS PDF."],
  ];
  function showStep(i) {
    const ex = $("explain");
    if (i === null || i === undefined) { ex.hidden = true; return; }
    ex.replaceChildren(el("h3", steps[i][0]), el("p", steps[i][2]));
    ex.hidden = false;
    replayAnim(ex);
  }
  // the live page's diagram: six buttons, keyword and vector stacked in one column
  function defaultFlow(root) {
    steps.forEach(([title, small], i) => {
      const b = el("button", undefined, "node"); b.type = "button"; b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", "explain");
      b.dataset.step = i;
      b.append(el("b", title), el("span", small));
      b.onclick = () => {
        const open = b.getAttribute("aria-expanded") === "true";
        root.querySelectorAll(".node").forEach((n) => n.setAttribute("aria-expanded", "false"));
        if (open) { showStep(null); return; }
        b.setAttribute("aria-expanded", "true");
        showStep(i);
      };
      if (i === 1 || i === 2) {
        let split = root.querySelector(".split");
        if (!split) { split = el("div", undefined, "node split"); root.append(split); }
        split.append(b);
      } else {
        root.append(b);
      }
    });
  }
  const api = { steps, showStep, defaultFlow, el, highlighted, plain, pct, locate, data: DATA, MOTION, renderTrace };
  (DESIGN.flow || defaultFlow)($("flow"), api);

  /* ---------- data: recorded examples and results ---------- */
  const data = DATA;
  const groups = new Map();
  for (const ex of data.examples) { if (!groups.has(ex.group)) groups.set(ex.group, []); groups.get(ex.group).push(ex); }
  for (const [g, list] of groups) {
    const row = el("div", undefined, "chips");
    row.append(el("span", g + ":", "note"));
    for (const ex of list) {
      const b = el("button", ex.label, "chip"); b.type = "button"; b.setAttribute("aria-pressed", "false");
      b.onclick = () => {
        document.querySelectorAll("#replay-chips .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        $("replay-result").hidden = false;
        renderTrace($("replay-result"), ex, true);
      };
      row.append(b);
    }
    $("replay-chips").append(row);
  }

  const R = data.results;
  $("results-sub").textContent = `Measured on ${data.eval.questions} hand-written questions: ${data.eval.answerable} with an answer in the publications, 25 whose answer is not there, 10 prompt-injection attacks. Graded by code, strictly, with no model judging another model.`;
  // Two views of the same runs. "Read by hand" (the default) is what a person reading the answers finds: the
  // strict grader's "wrong" split into right-in-other-words, partial (right, but missing a fact search never
  // found) and real errors. Only the two Claude runs were read by hand, so only they appear there.
  // "Graded by code" is the strict score for every run.
  // Cost: real-time price per 1,000 questions; a "check off" row is the same model replayed without the quote
  // check (code, no API call), so it costs the same as the run above it.
  const reviewFor = (label) => /Sonnet/.test(label) ? R.review["claude-sonnet-5-5"] : /Haiku 5\.5/.test(label) ? R.review["claude-haiku-5-5"] : null;
  const costText = (c) => (c !== undefined ? `$${c.toFixed(2)} per 1,000 questions` : "no API cost, runs on a laptop");
  { let last; for (const r of R.runs) { if (!r.variant) last = r.usd_per_1000_realtime; r.cost = r.variant ? last : r.usd_per_1000_realtime; } }
  const VIEWS = {
    hand: {
      name: "Read by hand",
      parts: [["right", "Right", "--c-correct"], ["partial", "Partial", "--c-partial"], ["held", "Held back", "--c-held"], ["wrong", "Wrong", "--c-wrong"]],
      rows: R.runs.filter((r) => !r.variant && reviewFor(r.label)).map((r) => {
        const v = reviewFor(r.label);
        return { ...r, right: r.correct + v.key_too_strict, partial: v.partial_retrieval_miss, held: r.abstained, wrong: v.real_error, shown: r.n - r.abstained };
      }),
      label: (r) => `${r.wrong} wrong in ${r.shown} answers shown · `,
      note: "Every answer the code grader marked wrong was read by a person. Right in other words counts as right; right but missing a fact that search never found counts as partial. Answers the grader marked right were not re-read. The two Claude runs were read this way.",
      table: [["Right", "right"], ["Partial", "partial"], ["Held back", "held"], ["Wrong", "wrong"]],
    },
    strict: {
      name: "Graded by code",
      parts: [["correct", "Correct", "--c-correct"], ["abstained", "Held back", "--c-held"], ["wrong", "Wrong", "--c-wrong"]],
      rows: R.runs,
      label: (r) => `${pct(r.precision_when_shown)} of shown answers right · `,
      note: "The strict score: an answer counts as correct only if it contains every fact on the answer key in an accepted wording. Anything else that is shown counts as wrong, even when a person would call it right.",
      table: [["Correct", "correct"], ["Held back", "abstained"], ["Wrong", "wrong"]],
    },
  };
  const tog = el("div", undefined, "viewtog"); tog.setAttribute("role", "group"); tog.setAttribute("aria-label", "How the answers were judged");
  const vnote = el("p", "", "note vnote");
  $("legend").before(tog, vnote);
  const togBtns = Object.entries(VIEWS).map(([key, v]) => { const b = el("button", v.name); b.type = "button"; b.dataset.view = key; b.onclick = () => drawOutcomes(key); tog.append(b); return b; });
  function drawOutcomes(key) {
    const V = VIEWS[key], box = $("outcomes");
    togBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === key)));
    vnote.textContent = V.note;
    $("legend").replaceChildren(...V.parts.map(([, name, v]) => { const s = el("span"); const i = el("i"); i.style.background = `var(${v})`; s.append(i, name); return s; }));
    const wasIn = box.classList.contains("in");
    box.classList.remove("in"); box.replaceChildren();
    V.rows.forEach((r, ri) => {
      const row = el("div", undefined, "crow"); row.style.setProperty("--i", ri);
      const lab = el("div", undefined, "lab");
      const right = el("span", V.label(r)); right.append(el("b", costText(r.cost), "cost"));
      lab.append(el("b", r.label), right);
      const stack = el("div", undefined, "stack");
      for (const [k, name, v] of V.parts) {
        if (!r[k]) continue;
        const seg = el("div", r[k], "seg" + (k === "partial" ? " dark-text" : "")); seg.style.flex = `${r[k]} 0 0`; seg.style.background = `var(${v})`;
        bindTip(seg, `${r.label}: ${name} ${r[k]} of ${r.n} (${pct(r[k] / r.n)})`);
        stack.append(seg);
      }
      row.append(lab, stack);
      box.append(row);
    });
    requestAnimationFrame(() => box.querySelectorAll(".seg").forEach((s) => { if (s.scrollWidth > s.clientWidth) s.textContent = ""; }));
    if (wasIn) requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("in")));
    const t = el("table"); const hd = el("tr");
    for (const h of ["Run", ...V.table.map(([h]) => h), "Cost per 1,000"]) hd.append(el("th", h, h === "Run" ? "" : "n"));
    t.append(hd);
    for (const r of V.rows) {
      const tr = el("tr"); tr.append(el("td", r.label));
      for (const [, k] of V.table) tr.append(el("td", r[k], "n"));
      tr.append(el("td", r.cost !== undefined ? "$" + r.cost.toFixed(2) : "$0, local", "n"));
      t.append(tr);
    }
    $("outcomes-table").replaceChildren(t);
  }
  drawOutcomes("hand");
  const son = R.review["claude-sonnet-5-5"], hai = R.review["claude-haiku-5-5"];
  for (const f of [
    `Every answer the grader called wrong was read by hand. Sonnet: ${son.key_too_strict} were right in other words, ${son.partial_retrieval_miss} were honest partial answers, ${son.real_error} real errors. Haiku: ${hai.real_error} real errors.`,
    "The quote check matters less as the model gets stronger: on Sonnet it never fired; on the local 7B model it stopped 9 wrong answers and also hid 11 right ones.",
    "Search is now the limit: the 8 passages held 84% of the facts the answers needed, and every honest partial answer was missing a fact search never found.",
    "Not-found questions and attacks: both Claude models held all 25 and all 10.",
  ]) $("findings").append(el("li", f));

  const m5 = Math.max(...R.methods.map((m) => m["evidence@5"]));
  $("search-sub").textContent = `Share of the facts an answer needs that appear in the top 5 passages, ${R.methods[0].n} questions.`;
  R.methods.forEach((m, mi) => {
    const row = el("div", undefined, "hbar"); row.style.setProperty("--i", mi);
    const track = el("div", undefined, "track");
    const fill = el("div", undefined, "fill"); fill.dataset.w = (100 * m["evidence@5"] / m5 * 0.82).toFixed(1) + "%";
    fill.style.width = MOTION ? "0%" : fill.dataset.w;
    bindTip(fill, `${m.label}: ${pct(m["evidence@5"])} in the top 5, ${pct(m["evidence@10"])} in the top 10, median ${Math.round(m.median_ms).toLocaleString()} ms on a laptop`);
    track.append(fill, el("span", pct(m["evidence@5"], 0)));
    row.append(el("span", m.label), track);
    $("search").append(row);
  });
  {
    const t = el("table"); const hd = el("tr");
    for (const h of ["Search", "Top 5", "Top 10", "Median ms"]) hd.append(el("th", h, h === "Search" ? "" : "n"));
    t.append(hd);
    for (const m of R.methods) { const tr = el("tr"); tr.append(el("td", m.label), el("td", pct(m["evidence@5"]), "n"), el("td", pct(m["evidence@10"]), "n"), el("td", Math.round(m.median_ms).toLocaleString(), "n")); t.append(tr); }
    $("search-table").append(t);
  }
  document.querySelectorAll(".tablebtn").forEach((b) => b.onclick = () => {
    const t = $(b.dataset.table); t.hidden = !t.hidden; b.textContent = t.hidden ? "Show as a table" : "Hide the table";
  });

  // charts grow the first time they scroll into view
  const charts = [$("outcomes"), $("search")];
  charts.forEach((c) => c.classList.add("chart"));
  const grow = (c) => { c.classList.add("in"); c.querySelectorAll(".fill").forEach((f) => { f.style.width = f.dataset.w; }); };
  if (!MOTION || !("IntersectionObserver" in window)) charts.forEach(grow);
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { grow(e.target); io.unobserve(e.target); } }), { threshold: 0.35 });
    charts.forEach((c) => io.observe(c));
  }
})();
