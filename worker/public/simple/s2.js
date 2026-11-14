// Design 2: one dot per passage (3,973). The two searches light their top 20, fusion keeps 8 (drawn as bars sized
// by recorded run T01's real fused scores), Claude's JSON reply types out, and the quote check stamps it.
// Which grid dots light up is illustrative; whether each kept passage came from keyword, vector or both is real.
window.DESIGN = {
  flow(root, api) {
    const { el, steps, showStep, MOTION, data } = api;
    const ex = data.examples.find((e) => e.id === "T01"), t = ex.trace;
    const N = 3973;
    // colours from the page variables, so a palette picked in the studio reaches the canvas too
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const GOLD = css("--ring-1"), ORANGE = css("--ring-2"), PINK = css("--ring-3"), DIM = css("--line"), OK = css("--ok"), TXT = css("--fg"), MUTED = css("--muted"), FILL = css("--soft"), BG = css("--bg");
    root.className = "funnel";
    const cv = el("canvas"), ctx = cv.getContext("2d");
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", "Animation of recorded run T01: 3,973 passages, keyword and vector search each light their top 20, fusion keeps 8, Claude answers in JSON, code checks the quote.");
    const cap = el("p", "", "fcap"), play = el("button", "Pause", "fplay"); play.type = "button";
    const top = el("div", undefined, "ftop"); top.append(cap, play);
    const row = el("div", undefined, "fsteps");
    const btns = steps.map(([title], i) => { const b = el("button", title, "fstep"); b.type = "button"; b.onclick = () => pick(i); row.append(b); return b; });
    root.append(cv, top, row);

    // the real run: the 8 kept passages by fused score, which list each came from, which were quoted
    const kept = [...t.passages].sort((a, b) => b.fused - a.fused);
    const maxF = kept[0].fused;
    const quoted = new Set(t.citations.filter((c) => c.ok).map((c) => Number(c.passage)));
    let reply = {}; try { reply = JSON.parse(t.raw); } catch { /* keep empty */ }
    // the model's real reply, laid out in four lines
    const q0 = (reply.citations || [])[0] || {};
    const jsonLines = [`{ "status": ${JSON.stringify(reply.status)},`, `  "answer": ${JSON.stringify(reply.answer)},`, `  "citations": [{ "passage": ${JSON.stringify(q0.passage)},`, `    "quote": ${JSON.stringify(q0.quote)} }] }`];
    const captions = [
      "Recorded run T01: the question goes in",
      "Keyword search lights its top 20 of 3,973 passages",
      "Vector search lights its top 20",
      "Fusion keeps the best 8, sized by fused score",
      "Claude Haiku 5.5 answers in JSON, quoting passage [" + [...quoted].join("], [") + "]",
      "Code finds every quote word for word: the answer is shown",
    ];

    // which dots light: seeded, so it looks the same every time
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
      // the field
      for (let i = 0; i < N; i++) {
        const j = keptIdx.get(i);
        if (j !== undefined && s >= 3) continue; // kept dots are drawn as they travel, below
        const litK = K.has(i) && s >= 1, litV = V.has(i) && s >= 2;
        let col = DIM, a = gridA, rr = r;
        if (litK || litV) {
          col = litK && litV ? ORANGE : litK ? GOLD : PINK;
          const fresh = (s === 1 && litK) || (s === 2 && litV && !(K.has(i)));
          if (fresh) { rr = r * (1 + 1.3 * e); a = Math.max(0.3, e); }
          else if (s < 3) rr = r * 2.3;
          if (s >= 3) a = gridA * 0.9;
        }
        ctx.globalAlpha = a; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], rr, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // the question, over the field
      if (s === 0) {
        ctx.font = "500 14px 'DM Sans', system-ui, sans-serif";
        const txt = fit(ex.question, W - 80), tw = ctx.measureText(txt).width, bw = tw + 30, bx = (W - bw) / 2, by = H / 2 - 20;
        ctx.globalAlpha = ease(p * 2.2);
        ctx.fillStyle = FILL; rrect(bx, by + (1 - ease(p * 2.2)) * 8, bw, 40, 20); ctx.fill();
        ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = TXT; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 15, by + 20 + (1 - ease(p * 2.2)) * 8);
        ctx.globalAlpha = 1;
      }
      // the 8 kept: dots fly in and become bars sized by fused score
      if (s >= 3) {
        const f = s === 3 ? e : 1;
        kept.forEach((pp, j) => {
          const b = bars[j], d = pos[keptDot[j]];
          const fromCol = pp.kw && pp.vec ? ORANGE : pp.kw ? GOLD : PINK;
          const x = lerp(d[0] - r * 1.8, b.x, f), y = lerp(d[1] - r * 1.8, b.y, f), w = lerp(r * 3.6, b.w, f), h = lerp(r * 3.6, b.h, f);
          const isQ = quoted.has(pp.n);
          const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, GOLD); g.addColorStop(1, fromCol === PINK ? PINK : ORANGE);
          ctx.fillStyle = g; ctx.globalAlpha = s >= 4 && !isQ ? 0.45 : 1;
          rrect(x, y, w, h, h / 2); ctx.fill();
          if (s === 5 && isQ) { ctx.strokeStyle = OK; ctx.lineWidth = 2; rrect(x - 2, y - 2, w + 4, h + 4, h / 2 + 2); ctx.globalAlpha = ease(p * 2); ctx.stroke(); }
          ctx.globalAlpha = f; ctx.fillStyle = MUTED; ctx.font = "500 10px 'JetBrains Mono', monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
          ctx.fillText("[" + pp.n + "]", b.x - 6, b.y + b.h / 2); ctx.textAlign = "left";
          ctx.globalAlpha = 1;
        });
      }
      // Claude's reply: a card that types out, joined to the passage it quotes
      if (s >= 4) {
        const a = s === 4 ? ease(p * 2.5) : 1, c = card;
        ctx.globalAlpha = a;
        ctx.fillStyle = FILL; rrect(c.x, c.y, c.w, c.h, 12); ctx.fill();
        ctx.strokeStyle = s === 5 ? OK : MUTED; ctx.lineWidth = s === 5 ? 2 : 1; ctx.stroke();
        // connectors from the quoted bars
        const lp = s === 4 ? ease((p - 0.15) * 2.2) : 1;
        kept.forEach((pp, j) => {
          if (!quoted.has(pp.n)) return;
          const b = bars[j], sx = b.x + b.w + 4, sy = b.y + b.h / 2, ex2 = c.x, ey = c.y + c.h / 2;
          ctx.strokeStyle = s === 5 ? OK : GOLD; ctx.lineWidth = 1.5; ctx.beginPath();
          const steps2 = 30;
          for (let k = 0; k <= steps2 * lp; k++) {
            const tt = k / steps2, mx = (sx + ex2) / 2;
            const x = (1 - tt) ** 3 * sx + 3 * (1 - tt) ** 2 * tt * mx + 3 * (1 - tt) * tt * tt * mx + tt ** 3 * ex2;
            const y = (1 - tt) ** 3 * sy + 3 * (1 - tt) ** 2 * tt * sy + 3 * (1 - tt) * tt * tt * ey + tt ** 3 * ey;
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        });
        // the JSON, typed
        const small = c.w < 230;
        ctx.font = `400 ${small ? 9.5 : 11.5}px 'JetBrains Mono', monospace`; ctx.fillStyle = TXT; ctx.textBaseline = "top";
        const total = jsonLines.join("").length; let budget = Math.floor(total * (s === 4 ? ease(p * 1.4) : 1));
        const lh = (c.h - 24) / jsonLines.length;
        jsonLines.forEach((ln, k) => {
          if (budget <= 0) return;
          const shown = fit(ln.slice(0, budget), c.w - 26); budget -= ln.length;
          ctx.fillStyle = k === 1 || k === 3 ? TXT : MUTED;
          ctx.fillText(shown, c.x + 13, c.y + 12 + k * lh);
        });
        ctx.globalAlpha = 1;
        // the check
        if (s === 5) {
          const k = ease(p * 2.2), cx = c.x + c.w - 4, cy = c.y + 4, rad = 14 * k;
          ctx.fillStyle = OK; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
          if (k > 0.6) { ctx.strokeStyle = BG; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx - 1.5, cy + 4.5); ctx.lineTo(cx + 6, cy - 4.5); ctx.stroke(); }
        }
      }
    }

    // playback
    const DUR = [2200, 1700, 1700, 2300, 2900, 2600];
    let s = 0, t0 = 0, playing = MOTION, visible = false, raf = 0;
    function setStage(k) { s = k; t0 = performance.now(); cap.textContent = captions[k]; btns.forEach((b, i) => b.classList.toggle("on", i === k)); }
    function frame(now) {
      raf = 0;
      if (!playing || !visible) return;
      let p = (now - t0) / DUR[s];
      if (p >= 1) { setStage((s + 1) % 6); p = 0; }
      draw(s, p);
      raf = requestAnimationFrame(frame);
    }
    const run = () => { if (!raf && playing && visible) raf = requestAnimationFrame(frame); };
    function pick(i) {
      playing = false; play.textContent = "Play";
      setStage(i); draw(i, 1);
      const open = btns[i].classList.contains("open");
      btns.forEach((b) => b.classList.remove("open"));
      if (open) { showStep(null); return; }
      btns[i].classList.add("open"); showStep(i);
    }
    play.onclick = () => {
      playing = !playing; play.textContent = playing ? "Pause" : "Play";
      if (playing) { t0 = performance.now(); run(); } else draw(s, 1);
    };
    if (!MOTION) { play.hidden = true; }
    layout(); setStage(MOTION ? 0 : 5); draw(s, 1);
    new ResizeObserver(() => { const w = root.clientWidth; if (w && w !== W) { layout(); draw(s, playing ? 0 : 1); } }).observe(root);
    new IntersectionObserver((es) => es.forEach((en) => { visible = en.isIntersecting; if (visible) { t0 = performance.now(); run(); } }), { threshold: 0.25 }).observe(root);
  },
};
