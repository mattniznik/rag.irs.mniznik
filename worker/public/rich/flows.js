// Two "How it works" animations for the section-built layouts (simple/s2.js and s3.js are their one-column twins):
//   field  - one dot per passage (3,973) narrowing to one checked answer
//   player - one recorded run stepped through the six steps
// Colours come from the page's palette variables, so they follow the visitor's Studio choice.
// Each returns a stop function; sections.js calls it before the page re-renders.
(function () {
  "use strict";
  // the six steps and their explanations, as on the simple layouts
  const STEPS6 = [
    ["Your question", "up to 300 characters", "The question goes to two searches at once. This page does not store it; the only thing kept is a salted hash of your IP address for the day, to enforce 10 questions per visitor."],
    ["Keyword search", "SQLite FTS5, BM25", "A full-text index over 3,973 passages from the 11 publications, ranked with BM25, with section headings weighted double. It catches exact terms: “Form 8829”, “$15,750”, “substantial presence test”. Returns its top 20."],
    ["Vector search", "bge-small, 384 numbers", "Every passage, and your question, is turned into 384 numbers by the bge-small-en-v1.5 embedding model; Cloudflare Vectorize returns the 20 passages whose numbers point the same way. It catches paraphrases: “home office” finds “business use of your home”."],
    ["Fuse, keep 8", "reciprocal rank fusion", "Each passage scores 1 / (60 + its rank) in each list it appears in, and the 8 best go to the model. No score calibration needed. In the 115-question evaluation, fusing found 78% of the facts an answer needs in the top 5, against 69% for keyword or vector search alone."],
    ["Claude Haiku 5.5", "answer + quotes as JSON", "The model sees only the question and the 8 passages, numbered [1] to [8] with publication, tax year, page and section. It must reply in a fixed JSON shape: an answer, and quotes copied word for word, each naming its passage. Thinking off, low effort: about $0.0005 a question."],
    ["Quote check", "code, not the model", "Code decides what you see. There must be at least one quote; every quote must be 3 to 100 words and appear word for word in the passage it names, ignoring quote style, dashes, spacing, case and table layout. If anything fails, the answer is held back. The result links each quote to its page in the IRS PDF."],
  ];
  function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = String(text); if (cls) n.className = cls; return n; }
  function highlighted(text, spans) {
    const frag = document.createDocumentFragment(); let at = 0;
    for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) { if (s < at) continue; frag.append(text.slice(at, s), el("mark", text.slice(s, e))); at = e; }
    frag.append(text.slice(at)); return frag;
  }
  function plain(problem, c) {
    const n = c && c.passage ? "[" + c.passage + "]" : "it names"; let m;
    if (/^quote is not in passage /.test(problem)) return `the quote is not word for word in passage ${n}`;
    if (/^passage .* was not given$/.test(problem)) return `passage ${n} was not one of the 8 the model was given`;
    if ((m = /^quote has (\d+) words$/.exec(problem))) return `the quote has ${m[1]} words; 3 to 100 are allowed`;
    return problem;
  }
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();

  /* ---------- dot field ---------- */
  function field(root, api) {
    const { data, MOTION, showStep } = api;
    const ex = data.examples.find((e) => e.id === "T01"), t = ex.trace, N = data.corpus.passages;
    const light = document.body.classList.contains("light");
    const C = { a1: cssVar("a1"), a2: cssVar("a2"), a3: cssVar("a3"), dim: cssVar("line"), tx: cssVar("tx"), mu: cssVar("mu"), card: cssVar("card2"), bg: cssVar("bg"), ok: light ? "#1f8a4c" : "#3fbf7f" };
    root.classList.add("funnel");
    const cv = el("canvas"), ctx = cv.getContext("2d");
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", `Animation of recorded run T01: ${N.toLocaleString()} passages, keyword and vector search each light their top 20, fusion keeps 8, Claude answers in JSON, code checks the quote.`);
    const cap = el("p", "", "fcap"), play = el("button", "Pause", "fplay"); play.type = "button";
    const top = el("div", undefined, "ftop"); top.append(cap, play);
    const row = el("div", undefined, "fsteps");
    const btns = STEPS6.map(([title], i) => { const b = el("button", title, "fstep"); b.type = "button"; b.onclick = () => pick(i); row.append(b); return b; });
    root.replaceChildren(cv, top, row);

    // the real run: the 8 kept passages by fused score, which list each came from, which were quoted
    const kept = [...t.passages].sort((a, b) => b.fused - a.fused), maxF = kept[0].fused;
    const quoted = new Set(t.citations.filter((c) => c.ok).map((c) => Number(c.passage)));
    let reply = {}; try { reply = JSON.parse(t.raw); } catch { /* keep empty */ }
    const q0 = (reply.citations || [])[0] || {};
    const jsonLines = [`{ "status": ${JSON.stringify(reply.status)},`, `  "answer": ${JSON.stringify(reply.answer)},`, `  "citations": [{ "passage": ${JSON.stringify(q0.passage)},`, `    "quote": ${JSON.stringify(q0.quote)} }] }`];
    const captions = [
      "Recorded run T01: the question goes in",
      `Keyword search lights its top 20 of ${N.toLocaleString()} passages`,
      "Vector search lights its top 20",
      "Fusion keeps the best 8, sized by fused score",
      "Claude Haiku 5.5 answers in JSON, quoting passage [" + [...quoted].join("], [") + "]",
      "Code finds every quote word for word: the answer is shown",
    ];
    // which dots light up is illustrative and seeded; which list each kept passage came from is real
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const used = new Set(), pickDot = () => { let i; do { i = Math.floor(rnd() * N); } while (used.has(i)); used.add(i); return i; };
    const K = new Set(), V = new Set(), keptDot = [];
    for (const p of kept) { const d = pickDot(); keptDot.push(d); if (p.kw) K.add(d); if (p.vec) V.add(d); }
    while (K.size < 20) { const d = pickDot(); K.add(d); if (V.size < 20 && rnd() < 0.3) V.add(d); }
    while (V.size < 20) V.add(pickDot());
    const keptIdx = new Map(keptDot.map((d, j) => [d, j]));

    let W = 0, H = 0, pitch = 0, pos = [], bars = [], card = null;
    function layout() {
      W = root.clientWidth; const narrow = W < 560, pad = 12;
      pitch = Math.max(4, Math.floor(Math.sqrt(((W - 2 * pad) * (narrow ? 240 : 220)) / N)));
      const cols = Math.floor((W - 2 * pad) / pitch), rows = Math.ceil(N / cols);
      H = rows * pitch + 2 * pad;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ox = (W - cols * pitch) / 2 + pitch / 2;
      pos = Array.from({ length: N }, (_, i) => [ox + (i % cols) * pitch, pad + pitch / 2 + Math.floor(i / cols) * pitch]);
      const bh = Math.min(13, Math.floor((H - 48) / 8) - 6), gap = 6, x0 = narrow ? 30 : 46, maxW = W * (narrow ? 0.40 : 0.36);
      const y0 = (H - (8 * bh + 7 * gap)) / 2;
      bars = kept.map((p, j) => ({ x: x0, y: y0 + j * (bh + gap), w: Math.max(10, maxW * p.fused / maxF), h: bh, n: p.n }));
      const cx = W * (narrow ? 0.54 : 0.5), cw = Math.min(W - cx - 14, 400), ch = Math.min(H - 30, 128);
      card = { x: cx, y: (H - ch) / 2, w: cw, h: ch };
    }
    const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const lerp = (a, b, e) => a + (b - a) * e;
    function rrect(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
    function fit(s, w) { if (ctx.measureText(s).width <= w) return s; while (s.length > 1 && ctx.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; }
    function draw(s, p) {
      ctx.clearRect(0, 0, W, H);
      const e = ease(p * 1.6), r = Math.max(1.3, pitch * 0.3);
      const gridA = s < 3 ? 1 : s === 3 ? 1 - 0.85 * e : 0.15;
      for (let i = 0; i < N; i++) {
        if (keptIdx.has(i) && s >= 3) continue;
        const litK = K.has(i) && s >= 1, litV = V.has(i) && s >= 2;
        let col = C.dim, a = gridA, rr = r;
        if (litK || litV) {
          col = litK && litV ? C.a2 : litK ? C.a1 : C.a3;
          const fresh = (s === 1 && litK) || (s === 2 && litV && !K.has(i));
          if (fresh) { rr = r * (1 + 1.3 * e); a = Math.max(0.3, e); } else if (s < 3) rr = r * 2.3;
          if (s >= 3) a = gridA * 0.9;
        }
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], rr, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (s === 0) {
        ctx.font = "500 14px 'DM Sans', system-ui, sans-serif";
        const k = ease(p * 2.2), txt = fit(ex.question, W - 80), bw = ctx.measureText(txt).width + 30, bx = (W - bw) / 2, by = H / 2 - 20 + (1 - k) * 8;
        ctx.globalAlpha = k; ctx.fillStyle = C.bg; rrect(bx, by, bw, 40, 20); ctx.fill();
        ctx.strokeStyle = C.a1; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = C.tx; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 15, by + 20); ctx.globalAlpha = 1;
      }
      if (s >= 3) {
        const f = s === 3 ? e : 1;
        kept.forEach((pp, j) => {
          const b = bars[j], d = pos[keptDot[j]], isQ = quoted.has(pp.n);
          const x = lerp(d[0] - r * 1.8, b.x, f), y = lerp(d[1] - r * 1.8, b.y, f), w = lerp(r * 3.6, b.w, f), h = lerp(r * 3.6, b.h, f);
          const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, C.a1); g.addColorStop(1, pp.kw ? C.a2 : C.a3);
          ctx.fillStyle = g; ctx.globalAlpha = s >= 4 && !isQ ? 0.45 : 1; rrect(x, y, w, h, h / 2); ctx.fill();
          if (s === 5 && isQ) { ctx.strokeStyle = C.ok; ctx.lineWidth = 2; ctx.globalAlpha = ease(p * 2); rrect(x - 2, y - 2, w + 4, h + 4, h / 2 + 2); ctx.stroke(); }
          ctx.globalAlpha = f; ctx.fillStyle = C.mu; ctx.font = "500 10px 'JetBrains Mono', monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
          ctx.fillText("[" + pp.n + "]", b.x - 6, b.y + b.h / 2); ctx.textAlign = "left"; ctx.globalAlpha = 1;
        });
      }
      if (s >= 4) {
        const a = s === 4 ? ease(p * 2.5) : 1, c = card;
        ctx.globalAlpha = a; ctx.fillStyle = C.bg; rrect(c.x, c.y, c.w, c.h, 12); ctx.fill();
        ctx.strokeStyle = s === 5 ? C.ok : C.mu; ctx.lineWidth = s === 5 ? 2 : 1; ctx.stroke();
        const lp = s === 4 ? ease((p - 0.15) * 2.2) : 1;
        kept.forEach((pp, j) => {
          if (!quoted.has(pp.n)) return;
          const b = bars[j], sx = b.x + b.w + 4, sy = b.y + b.h / 2, ex2 = c.x, ey = c.y + c.h / 2, mx = (sx + ex2) / 2;
          ctx.strokeStyle = s === 5 ? C.ok : C.a1; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let k = 0; k <= 30 * lp; k++) {
            const tt = k / 30;
            const x = (1 - tt) ** 3 * sx + 3 * (1 - tt) ** 2 * tt * mx + 3 * (1 - tt) * tt * tt * mx + tt ** 3 * ex2;
            const y = (1 - tt) ** 3 * sy + 3 * (1 - tt) ** 2 * tt * sy + 3 * (1 - tt) * tt * tt * ey + tt ** 3 * ey;
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        });
        ctx.font = `400 ${c.w < 230 ? 9.5 : 11.5}px 'JetBrains Mono', monospace`; ctx.textBaseline = "top";
        const total = jsonLines.join("").length; let budget = Math.floor(total * (s === 4 ? ease(p * 1.4) : 1));
        const lh = (c.h - 24) / jsonLines.length;
        jsonLines.forEach((ln, k) => {
          if (budget <= 0) return;
          const shown = fit(ln.slice(0, budget), c.w - 26); budget -= ln.length;
          ctx.fillStyle = k === 1 || k === 3 ? C.tx : C.mu; ctx.fillText(shown, c.x + 13, c.y + 12 + k * lh);
        });
        ctx.globalAlpha = 1;
        if (s === 5) {
          const k = ease(p * 2.2), cx = c.x + c.w - 4, cy = c.y + 4;
          ctx.fillStyle = C.ok; ctx.beginPath(); ctx.arc(cx, cy, 14 * k, 0, 7); ctx.fill();
          if (k > 0.6) { ctx.strokeStyle = C.bg; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx - 1.5, cy + 4.5); ctx.lineTo(cx + 6, cy - 4.5); ctx.stroke(); }
        }
      }
    }
    const DUR = [2200, 1700, 1700, 2300, 2900, 2600];
    let s = 0, t0 = 0, playing = MOTION, visible = false, raf = 0, dead = false;
    function setStage(k) { s = k; t0 = performance.now(); cap.textContent = captions[k]; btns.forEach((b, i) => b.classList.toggle("on", i === k)); }
    function frame(now) {
      raf = 0;
      if (dead || !root.isConnected) return stop();
      if (!playing || !visible) return;
      let p = (now - t0) / DUR[s];
      if (p >= 1) { setStage((s + 1) % 6); p = 0; }
      draw(s, p); raf = requestAnimationFrame(frame);
    }
    const run = () => { if (!raf && playing && visible) raf = requestAnimationFrame(frame); };
    function pick(i) {
      playing = false; play.textContent = "Play"; setStage(i); draw(i, 1);
      const open = btns[i].classList.contains("open");
      btns.forEach((b) => b.classList.remove("open"));
      if (open) { showStep(null); return; }
      btns[i].classList.add("open"); showStep(i);
    }
    play.onclick = () => { playing = !playing; play.textContent = playing ? "Pause" : "Play"; if (playing) { t0 = performance.now(); run(); } else draw(s, 1); };
    if (!MOTION) play.hidden = true;
    layout(); setStage(MOTION ? 0 : 5); draw(s, 1);
    const ro = new ResizeObserver(() => { const w = root.clientWidth; if (w && w !== W) { layout(); draw(s, playing ? 0 : 1); } }); ro.observe(root);
    const io = new IntersectionObserver((es) => es.forEach((en) => { visible = en.isIntersecting; if (visible) { t0 = performance.now(); run(); } }), { threshold: 0.25 }); io.observe(root);
    function stop() { dead = true; if (raf) cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); }
    return stop;
  }

  /* ---------- step-through player ---------- */
  function player(root, api) {
    const { data, MOTION, showStep, locate } = api;
    const runs = [["T01", "A verified answer"], ["T05", "A held-back answer"]].map(([id, label]) => ({ ex: data.examples.find((e) => e.id === id), label }));
    let ex = runs[0].ex, k = 0, timer = null, typing = null, playing = false, played = false, measuring = false;
    root.classList.add("player");
    const rail = el("div", undefined, "prail"), prog = el("i", undefined, "pprog"); rail.append(prog);
    const rb = STEPS6.map(([title], i) => { const b = el("button", undefined, "pstep"); b.type = "button"; b.append(el("span", String(i + 1), "pn"), el("span", title, "pt")); b.onclick = () => { stop(); go(i); }; rail.append(b); return b; });
    const stage = el("div", undefined, "pstage"); stage.setAttribute("aria-live", "polite");
    const ctl = el("div", undefined, "pctl"), playB = el("button", "Play", "pbtn"), togs = el("div", undefined, "ptogs"); playB.type = "button";
    const tb = runs.map((r, i) => {
      const b = el("button", `${r.label} (${r.ex.id})`, "ptog"); b.type = "button"; b.setAttribute("aria-pressed", String(i === 0));
      b.onclick = () => { ex = r.ex; tb.forEach((x) => x.setAttribute("aria-pressed", String(x === b))); stop(); measure(); go(0); if (MOTION) start(); };
      togs.append(b); return b;
    });
    ctl.append(togs, playB); root.replaceChildren(rail, stage, ctl);
    if (!MOTION) playB.hidden = true;

    const T = () => ex.trace;
    const quotedN = () => new Set(T().citations.filter((c) => c.ok).map((c) => Number(c.passage)));
    const put = (...nodes) => { stage.replaceChildren(...nodes); let i = 0; stage.querySelectorAll(".in").forEach((n) => n.style.setProperty("--i", i++)); };
    const srcCell = (p) => { const s = el("span", p.source, "rs"); if (p.section) s.append(el("span", " · " + p.section, "rsec")); s.title = p.source + (p.section ? " · " + p.section : ""); return s; };
    const type = (node, text, ms) => {
      clearInterval(typing);
      if (!MOTION || measuring) { node.textContent = text; return; }
      const caret = el("span", undefined, "caret"); let n = 0; const per = Math.max(1, Math.ceil(text.length / (ms / 16)));
      node.replaceChildren(caret);
      typing = setInterval(() => { n = Math.min(text.length, n + per); node.replaceChildren(text.slice(0, n), caret); if (n >= text.length) clearInterval(typing); }, 16);
    };
    function rankRows(key, label) {
      const t = T(), list = t.passages.filter((p) => p[key]).sort((a, b) => a[key] - b[key]), q = quotedN(), rows = el("div", undefined, "rows");
      for (const p of list) { const r = el("div", undefined, "rrow in" + (q.has(p.n) ? " q" : "")); r.append(el("span", "#" + p[key], "rk"), el("span", `[${p.n}]`, "rn"), srcCell(p)); rows.append(r); }
      const missing = t.passages.length - list.length;
      return [el("p", label, "lbl in"), rows, el("p", `Ranks in this search's top 20, for the 8 passages that were kept${missing ? `; ${missing} of them came only from the other search` : ""}.`, "pfoot in")];
    }
    const render = [
      () => { const qn = el("p", "", "qtext"); put(el("p", "Recorded run " + ex.id + " · the question", "lbl"), qn, el("p", "Up to 300 characters. Sent to both searches at once.", "pfoot")); type(qn, ex.question, 1300); },
      () => put(...rankRows("kw", `Keyword search · BM25 over ${data.corpus.passages.toLocaleString()} passages`)),
      () => put(...rankRows("vec", "Vector search · bge-small, 384 numbers")),
      () => {
        const t = T(), q = quotedN(), rows = el("div", undefined, "rows"), maxF = Math.max(...t.passages.map((p) => p.fused)), fills = [];
        for (const p of [...t.passages].sort((a, b) => b.fused - a.fused)) {
          const r = el("div", undefined, "rrow in" + (q.has(p.n) ? " q" : ""));
          const bar = el("span", undefined, "rbar"), f = el("i"); bar.append(f); fills.push([f, (100 * p.fused / maxF).toFixed(1) + "%"]);
          const parts = [p.kw && `1/(60+${p.kw})`, p.vec && `1/(60+${p.vec})`].filter(Boolean).join(" + ");
          r.append(el("span", p.fused.toFixed(4), "rk"), el("span", `[${p.n}]`, "rn"), srcCell(p), el("span", parts, "rmath"), bar);
          rows.append(r);
        }
        put(el("p", "Fuse, keep 8 · reciprocal rank fusion", "lbl in"), rows);
        requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(([f, w], i) => { f.style.transitionDelay = 200 + i * 140 + "ms"; f.style.width = w; })));
      },
      () => {
        const t = T(), u = t.usage; let pretty = t.raw;
        try { pretty = JSON.stringify(JSON.parse(t.raw), null, 2); } catch { /* as written */ }
        const pre = el("pre", "", "pjson");
        put(el("p", `Claude Haiku 5.5 · ${u.input.toLocaleString()} tokens in, ${u.output} out`, "lbl"), pre, el("p", "It sees only the question and the 8 numbered passages, and must reply in this JSON shape.", "pfoot"));
        type(pre, pretty, 1800);
      },
      () => {
        const t = T(), nodes = [el("p", "Quote check · code, not the model", "lbl in")];
        if (!t.citations.length) nodes.push(el("p", "Nothing to check: the model said the passages do not answer the question.", "pquote in"));
        t.citations.forEach((c, i) => {
          nodes.push(el("p", "“" + c.quote + "”", "pquote in"));
          const named = t.passages[Number(c.passage) - 1];
          const st = el("span", c.ok ? `✓ Matched in passage [${c.passage}]` : `✗ Not in passage [${c.passage}]`, "stamp " + (c.ok ? "ok" : "bad"));
          st.style.setProperty("--d", 700 + i * 500 + "ms"); nodes.push(st);
          const span = named ? locate(named.text, c.quote) : null;
          if (c.ok && span) {
            let a = Math.max(0, span[0] - 70), b = Math.min(named.text.length, span[1] + 70);
            if (a > 0) { const sp = named.text.indexOf(" ", a); if (sp >= 0 && sp < span[0]) a = sp + 1; }
            if (b < named.text.length) { const sp = named.text.lastIndexOf(" ", b); if (sp > span[1]) b = sp; }
            const ctxN = el("p", undefined, "pctx in");
            ctxN.append(`In passage [${named.n}], ${named.source}: ` + (a > 0 ? "…" : ""), highlighted(named.text.slice(a, b), [[span[0] - a, span[1] - a]]), b < named.text.length ? "…" : "");
            nodes.push(ctxN);
          } else if (!c.ok) {
            let other = null; for (const p of t.passages) { if (locate(p.text, c.quote)) { other = p; break; } }
            nodes.push(el("p", "Why: " + plain(c.problem, c) + "." + (other ? ` The exact text is in passage [${other.n}]: the model named the wrong source, so the answer is not shown.` : ""), "pctx in"));
          }
        });
        const end = el("p", undefined, "pend in");
        if (ex.status === "answered") end.append(el("b", "Shown: "), ex.answer); else end.append(el("b", "Held back: "), "nothing is shown. A wrong source is treated like no source.");
        nodes.push(end); put(...nodes);
      },
    ];
    const DUR = [3000, 3200, 3200, 3800, 3800, 4800];
    function go(i) {
      k = i; clearInterval(typing);
      rb.forEach((b, j) => { b.classList.toggle("on", j === i); b.classList.toggle("past", j < i); });
      prog.style.width = `calc((100% - 24px) * ${i} / 6)`;
      render[i](); showStep(i);
    }
    function next() { if (k < 5) { go(k + 1); timer = setTimeout(next, DUR[k]); } else { playing = false; playB.textContent = "Play again"; } }
    function start() { clearTimeout(timer); playing = true; playB.textContent = "Pause"; if (k >= 5) go(0); timer = setTimeout(next, DUR[k]); }
    function stop() { clearTimeout(timer); playing = false; playB.textContent = "Play"; }
    playB.onclick = () => (playing ? stop() : start());
    // the stage keeps its tallest step's height, so the page does not jump while it plays
    function measure() { measuring = true; stage.style.minHeight = ""; let m = 0; for (const r of render) { r(); m = Math.max(m, stage.offsetHeight); } measuring = false; stage.style.minHeight = m + "px"; }
    let lastW = 0;
    const ro = new ResizeObserver(() => { if (root.clientWidth !== lastW) { lastW = root.clientWidth; requestAnimationFrame(() => { if (root.isConnected) { measure(); render[k](); } }); } }); ro.observe(root);
    measure(); go(0);
    // web fonts can land after the first measure and change the text height: measure again once they have
    if (document.fonts) document.fonts.ready.then(() => { if (root.isConnected) { measure(); render[k](); } });
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && !played) { played = true; io.disconnect(); go(0); start(); } }), { threshold: 0.45 });
    if (MOTION) io.observe(root);
    return () => { stop(); clearInterval(typing); ro.disconnect(); io.disconnect(); };
  }

  window.FLOWS = { STEPS6, field, player };
})();
