// "How this answer was made": the trace viewer every layout shows under an answer. Search's 8 passages with
// their keyword and vector ranks and fused score, each openable and linked to its exact page in the IRS PDF;
// the model's raw JSON reply; the quote check, with each quote highlighted where it was found; the result.
// The same viewer for recorded examples (site-data.json) and live answers (/api/ask), in both layout families.
// Moved here from simple/report.js unchanged, so the one-column and the section-built layouts share one copy.
(function () {
  "use strict";
  const motion = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = String(text); if (cls) n.className = cls; return n; }
  const replayAnim = (n) => { n.classList.remove("anim"); void n.offsetWidth; n.classList.add("anim"); };

  /* ---------- a tooltip (the one-column layouts have #tip; elsewhere one is made) ---------- */
  let tip = null;
  function tipEl() {
    if (tip && tip.isConnected) return tip;
    tip = document.getElementById("tip");
    if (!tip) { tip = el("div", undefined, "tip tr-tip"); tip.hidden = true; document.body.append(tip); }
    return tip;
  }
  function bindTip(node, text) {
    node.tabIndex = 0;
    node.setAttribute("aria-label", text);
    const show = (x, y) => { const t = tipEl(); t.textContent = text; t.hidden = false; const w = t.offsetWidth; t.style.left = Math.min(x + 12, innerWidth - w - 8) + "px"; t.style.top = (y + 14) + "px"; };
    node.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
    node.addEventListener("pointerleave", () => { tipEl().hidden = true; });
    node.addEventListener("focus", () => { const r = node.getBoundingClientRect(); show(r.left, r.bottom - 10); });
    node.addEventListener("blur", () => { tipEl().hidden = true; });
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

  /* ---------- the answer as a user sees it: the question, the answer, each verified quote with its source ---------- */
  function answerNodes(d, recorded) {
    const t = d.trace, out = [];
    if (recorded) out.push(el("p", "Question: " + d.question, "answer"));
    if (d.status === "answered") {
      out.push(el("p", d.answer, "answer"));
      for (const c of t.citations.filter((c) => c.ok)) {
        const p = t.passages[Number(c.passage) - 1];
        const q = el("blockquote", "“" + c.quote + "”");
        if (p) { const a = el("a", p.source); a.href = p.url; a.target = "_blank"; a.rel = "noopener"; q.append(a); }
        out.push(q);
      }
    } else {
      out.push(el("p", d.status === "not_found"
        ? "Not covered: the model said the publications do not answer this, so nothing is shown."
        : "Held back: the model wrote an answer, but its quotes did not check out, so nothing is shown.", "answer"));
    }
    return out;
  }

  /* ---------- how it was made ---------- */
  function traceBlock(d, recorded) {
    const t = d.trace, locate = window.locate;
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
    return { wrap, fills };
  }

  // motion: the answer first, then each step of the trace in turn; the fused-score bars grow in step 1
  function animate(box, wrap, fills) {
    let i = 0;
    for (const c of box.children) c.style.setProperty("--i", i++);
    for (const c of wrap.children) c.style.setProperty("--i", i++);
    const s1Delay = (i - 4) * 260;
    for (const f of fills) {
      if (!motion()) { f.style.width = f.dataset.w; continue; }
      f.style.width = "0%"; f.style.transitionDelay = s1Delay + 350 + "ms";
      requestAnimationFrame(() => requestAnimationFrame(() => { f.style.width = f.dataset.w; }));
    }
    replayAnim(box);
  }

  /** The answer and how it was made (the one-column layouts). */
  function render(box, d, recorded) {
    box.replaceChildren(...answerNodes(d, recorded));
    if (!d.trace) return;
    const { wrap, fills } = traceBlock(d, recorded);
    box.append(wrap);
    animate(box, wrap, fills);
  }

  /** Only how it was made, under an answer a layout has already shown in its own style (the section-built layouts). */
  function renderTrace(box, d, recorded) {
    box.replaceChildren();
    if (!d.trace) return;
    const { wrap, fills } = traceBlock(d, recorded);
    box.append(wrap);
    animate(box, wrap, fills);
  }

  window.TRACE = { el, bindTip, plain, highlighted, render, renderTrace };
})();
