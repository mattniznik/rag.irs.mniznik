// Design 3: a player that walks one recorded run through the six steps - the question, its keyword ranks, its
// vector ranks, the fused 8, Claude's JSON reply, the quote check - with the explanation of each step under it.
// It plays once when it scrolls into view; clicking a step stops it there. Every value shown is from the run.
window.DESIGN = {
  flow(root, api) {
    const { el, steps, showStep, MOTION, data, locate, highlighted, plain } = api;
    const runs = [["T01", "A verified answer"], ["T05", "A held-back answer"]].map(([id, label]) => ({ ex: data.examples.find((e) => e.id === id), label }));
    let ex = runs[0].ex, k = 0, timer = null, typing = null, playing = false, played = false;
    root.className = "player";

    const rail = el("div", undefined, "prail"); const prog = el("i", undefined, "pprog"); rail.append(prog);
    const rb = steps.map(([title], i) => {
      const b = el("button", undefined, "pstep"); b.type = "button";
      b.append(el("span", String(i + 1), "pn"), el("span", title, "pt"));
      b.onclick = () => { stop(); go(i); };
      rail.append(b); return b;
    });
    const stage = el("div", undefined, "pstage"); stage.setAttribute("aria-live", "polite");
    const ctl = el("div", undefined, "pctl");
    const playB = el("button", "Play", "pbtn"); playB.type = "button";
    const togs = el("div", undefined, "ptogs");
    const tb = runs.map((r, i) => {
      const b = el("button", `${r.label} (${r.ex.id})`, "ptog"); b.type = "button"; b.setAttribute("aria-pressed", String(i === 0));
      b.onclick = () => { ex = r.ex; tb.forEach((x) => x.setAttribute("aria-pressed", String(x === b))); stop(); go(0); if (MOTION) start(); };
      togs.append(b); return b;
    });
    ctl.append(togs, playB);
    root.append(rail, stage, ctl);
    if (!MOTION) playB.hidden = true;

    const T = () => ex.trace;
    const quotedN = () => new Set(T().citations.filter((c) => c.ok).map((c) => Number(c.passage)));
    const put = (...nodes) => { stage.replaceChildren(...nodes); let i = 0; stage.querySelectorAll(".in").forEach((n) => n.style.setProperty("--i", i++)); };
    const srcCell = (p) => { const s = el("span", p.source, "rs"); if (p.section) s.append(el("span", " · " + p.section, "rsec")); s.title = p.source + (p.section ? " · " + p.section : ""); return s; };
    let measuring = false;
    const type = (node, text, ms, done) => {
      clearInterval(typing);
      if (!MOTION || measuring) { node.textContent = text; done && done(); return; }
      const caret = el("span", undefined, "caret"); let n = 0; const per = Math.max(1, Math.ceil(text.length / (ms / 16)));
      node.replaceChildren(caret);
      typing = setInterval(() => { n = Math.min(text.length, n + per); node.replaceChildren(text.slice(0, n), caret); if (n >= text.length) { clearInterval(typing); done && done(); } }, 16);
    };
    function rankRows(key, label) {
      const t = T(), list = t.passages.filter((p) => p[key]).sort((a, b) => a[key] - b[key]);
      const q = quotedN(), rows = el("div", undefined, "rows");
      for (const p of list) {
        const r = el("div", undefined, "rrow in" + (q.has(p.n) ? " q" : ""));
        r.append(el("span", "#" + p[key], "rk"), el("span", `[${p.n}]`, "rn"), srcCell(p));
        rows.append(r);
      }
      const missing = t.passages.length - list.length;
      return [el("p", label, "lbl in"), rows, el("p", `Ranks in this search's top 20, for the 8 passages that were kept${missing ? `; ${missing} of them came only from the other search` : ""}.`, "foot in")];
    }
    const render = [
      () => { const qn = el("p", "", "qtext"); put(el("p", "Recorded run " + ex.id + " · the question", "lbl"), qn, el("p", "Up to 300 characters. Sent to both searches at once.", "foot")); type(qn, ex.question, 1300); },
      () => put(...rankRows("kw", "Keyword search · BM25 over 3,973 passages")),
      () => put(...rankRows("vec", "Vector search · bge-small, 384 numbers")),
      () => {
        const t = T(), q = quotedN(), rows = el("div", undefined, "rows"), maxF = Math.max(...t.passages.map((p) => p.fused)), fills = [];
        for (const p of [...t.passages].sort((a, b) => b.fused - a.fused)) {
          const r = el("div", undefined, "rrow in" + (q.has(p.n) ? " q" : ""));
          const bar = el("span", undefined, "rbar"), f = el("i"); bar.append(f); fills.push([f, (100 * p.fused / maxF).toFixed(1) + "%"]);
          const parts = [p.kw && `1/(60+${p.kw})`, p.vec && `1/(60+${p.vec})`].filter(Boolean).join(" + ");
          r.append(el("span", p.fused.toFixed(4), "rk"), el("span", `[${p.n}]`, "rn"), srcCell(p), el("span", `${parts}`, "rmath"), bar);
          rows.append(r);
        }
        put(el("p", "Fuse, keep 8 · reciprocal rank fusion", "lbl in"), rows);
        requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach(([f, w], i) => { f.style.transitionDelay = 200 + i * 140 + "ms"; f.style.width = w; })));
      },
      () => {
        const t = T(), u = t.usage; let pretty = t.raw;
        try { pretty = JSON.stringify(JSON.parse(t.raw), null, 2); } catch { /* as written */ }
        const pre = el("pre", "", "pjson");
        put(el("p", `Claude Haiku 5.5 · ${u.input.toLocaleString()} tokens in, ${u.output} out`, "lbl"), pre, el("p", "It sees only the question and the 8 numbered passages, and must reply in this JSON shape.", "foot"));
        type(pre, pretty, 1800);
      },
      () => {
        const t = T(), nodes = [el("p", "Quote check · code, not the model", "lbl in")];
        if (!t.citations.length) nodes.push(el("p", "Nothing to check: the model said the passages do not answer the question.", "pquote in"));
        t.citations.forEach((c, i) => {
          nodes.push(el("p", "“" + c.quote + "”", "pquote in"));
          const named = t.passages[Number(c.passage) - 1];
          const s = el("span", c.ok ? `✓ Matched in passage [${c.passage}]` : `✗ Not in passage [${c.passage}]`, "stamp " + (c.ok ? "ok" : "bad"));
          s.style.setProperty("--d", 700 + i * 500 + "ms");
          nodes.push(s);
          const span = named ? locate(named.text, c.quote) : null;
          if (c.ok && span) {
            let a = Math.max(0, span[0] - 70), b = Math.min(named.text.length, span[1] + 70);
            if (a > 0) { const sp = named.text.indexOf(" ", a); if (sp >= 0 && sp < span[0]) a = sp + 1; }
            if (b < named.text.length) { const sp = named.text.lastIndexOf(" ", b); if (sp > span[1]) b = sp; }
            const ctx = el("p", undefined, "pctx in");
            ctx.append(`In passage [${named.n}], ${named.source}: ` + (a > 0 ? "…" : ""), highlighted(named.text.slice(a, b), [[span[0] - a, span[1] - a]]), b < named.text.length ? "…" : "");
            nodes.push(ctx);
          } else if (!c.ok) {
            let other = null; for (const p of t.passages) { if (locate(p.text, c.quote)) { other = p; break; } }
            nodes.push(el("p", "Why: " + plain(c.problem, c) + "." + (other ? ` The exact text is in passage [${other.n}]: the model named the wrong source, so the answer is not shown.` : ""), "pctx in"));
          }
        });
        const end = el("p", undefined, "pend in");
        if (ex.status === "answered") { end.append(el("b", "Shown: "), ex.answer); } else { end.append(el("b", "Held back: "), "nothing is shown. A wrong source is treated like no source."); }
        nodes.push(end);
        put(...nodes);
      },
    ];
    const DUR = [3000, 3200, 3200, 3800, 3800, 4800];
    function go(i) {
      k = i; clearInterval(typing);
      rb.forEach((b, j) => { b.classList.toggle("on", j === i); b.classList.toggle("past", j < i); });
      prog.style.width = `calc((100% - 24px) * ${i} / 6)`;
      render[i]();
      showStep(i);
    }
    function next() { if (k < 5) { go(k + 1); timer = setTimeout(next, DUR[k]); } else { playing = false; playB.textContent = "Play again"; } }
    function start() { clearTimeout(timer); playing = true; playB.textContent = "Pause"; if (k >= 5) go(0); timer = setTimeout(next, DUR[k]); }
    function stop() { clearTimeout(timer); playing = false; playB.textContent = "Play"; }
    playB.onclick = () => (playing ? stop() : start());
    // the stage keeps the height of its tallest step, so the page below does not jump while it plays
    function measure() {
      measuring = true; stage.style.minHeight = "";
      let m = 0; for (const r of render) { r(); m = Math.max(m, stage.offsetHeight); }
      measuring = false; stage.style.minHeight = m + "px";
    }
    tb.forEach((b) => b.addEventListener("click", () => { measure(); go(0); }));
    let lastW = 0;
    // measure in the next frame: resizing the stage inside the observer's own callback loops it
    new ResizeObserver(() => { if (root.clientWidth !== lastW) { lastW = root.clientWidth; requestAnimationFrame(() => { measure(); render[k](); }); } }).observe(root);
    measure();
    go(0);
    // web fonts can land after the first measure and change the text height: measure again once they have
    if (document.fonts) document.fonts.ready.then(() => { measure(); render[k](); });
    // plays once, the first time it scrolls into view
    if (MOTION) new IntersectionObserver((es, io) => es.forEach((e) => { if (e.isIntersecting && !played) { played = true; io.disconnect(); go(0); start(); } }), { threshold: 0.45 }).observe(root);
  },
};
