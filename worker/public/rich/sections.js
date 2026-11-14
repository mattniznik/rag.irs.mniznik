// The section library for the four section-built layouts (rich/). Every number and every answer shown comes
// from window.RAG (the evaluation data in /site-data.json) or, on the live site, from /api/ask.
(function () {
  const R = window.RAG;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ex = (id) => R.examples.find((e) => e.id === id);
  const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
  const runs = R.results.runs;
  const haiku = runs.find((r) => /this demo/.test(r.label));
  const sonnet = runs.find((r) => /Sonnet/.test(r.label));
  const haikuOff = runs.find((r) => /Haiku, quote check off/.test(r.label));
  const qwen = runs.find((r) => /qwen2\.5 7B, local/.test(r.label));
  const qwenOff = runs.find((r) => /qwen 7B, quote check off/.test(r.label));
  const method = (k) => R.results.methods.find((m) => m.key === k);
  // read by hand: the strict grader's "wrong" split into right-in-other-words, partial (search missed a fact)
  // and real errors; only the two Claude runs were read this way
  const handOf = (r, v) => ({ right: r.correct + v.key_too_strict, partial: v.partial_retrieval_miss, held: r.abstained, wrong: v.real_error, shown: r.n - r.abstained });
  const hS = handOf(sonnet, R.results.review["claude-sonnet-5-5"]), hH = handOf(haiku, R.results.review["claude-haiku-5-5"]);
  const usd = (r) => "$" + r.usd_per_1000_realtime.toFixed(2);
  const costX = Math.round(sonnet.usd_per_1000_realtime / haiku.usd_per_1000_realtime);
  const LIVE = window.RAG_LIVE === true; // set by studio/loader.js: true on rag.irs.mniznik.com, where /api/ask answers
  const REPO = "https://github.com/mattniznik/rag.irs.mniznik";
  const CHIPS = [["T01", "2025 standard deduction, single"], ["S04", "Cap increase, 2025 to 2026"], ["T05", "Held back: wrong passage"], ["N01", "Not covered: Delaware"], ["A03", "Attack: confirm a fake quote"]];

  /* where a quote sits inside its passage: the same normalising the real check uses */
  const SAME = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "‑": "-", " ": " " };
  function normalize(text) {
    let out = ""; const map = [];
    const push = (ch, at) => {
      if (/\s/.test(ch)) { if (!out.length || out[out.length - 1] === " ") return; out += " "; map.push(at); return; }
      for (const low of ch.toLowerCase()) { out += low; map.push(at); }
    };
    for (let i = 0; i < text.length;) {
      if (text.startsWith("...", i)) { push(" ", i); i += 3; continue; }
      const c = SAME[text[i]] ?? text[i];
      push(c === "|" || c === "*" || c === "…" ? " " : c, i); i += 1;
    }
    if (out.endsWith(" ")) { out = out.slice(0, -1); map.pop(); }
    return { text: out, map };
  }
  function locate(passage, quote) {
    const q = normalize(String(quote).replace(/^[\s"'‘’“”.…]+|[\s"'‘’“”…]+$/g, "")).text;
    if (!q) return null;
    const p = normalize(passage); const at = p.text.indexOf(q);
    return at < 0 ? null : [p.map[at], p.map[at + q.length - 1] + 1];
  }
  function hl(text, spans) {
    let out = "", at = 0;
    for (const [s, e] of spans.slice().sort((a, b) => a[0] - b[0])) { if (s < at) continue; out += esc(text.slice(at, s)) + "<mark>" + esc(text.slice(s, e)) + "</mark>"; at = e; }
    return out + esc(text.slice(at));
  }
  /** an excerpt of the passage around the first span, cut at word boundaries */
  function excerpt(text, span, pad = 170) {
    if (!span) return esc(text.slice(0, pad * 2)) + (text.length > pad * 2 ? "…" : "");
    let s = Math.max(0, span[0] - pad), e = Math.min(text.length, span[1] + pad);
    if (s > 0) { const sp = text.indexOf(" ", s); if (sp >= 0 && sp < span[0]) s = sp + 1; }
    if (e < text.length) { const sp = text.lastIndexOf(" ", e); if (sp > span[1]) e = sp; }
    return (s > 0 ? "…" : "") + hl(text.slice(s, e), [[span[0] - s, span[1] - s]]) + (e < text.length ? "…" : "");
  }
  function cites(e) {
    const t = e.trace;
    return t.citations.map((c, i) => {
      const p = t.passages[Number(c.passage) - 1];
      let span = p ? locate(p.text, c.quote) : null, home = p;
      if (!span) for (const q of t.passages) { const s = locate(q.text, c.quote); if (s) { span = s; home = q; break; } }
      return { ...c, i, p, home, span };
    });
  }
  function statusOf(e) {
    if (e.status === "answered") return { k: "ok", label: "Verified answer" };
    if (e.status === "not_found") return { k: "nf", label: "Not covered" };
    return { k: "held", label: "Held back" };
  }
  function answerCard(e, compact) {
    const st = statusOf(e), cs = cites(e).filter((c) => c.ok);
    let body;
    if (e.status === "answered") {
      const nums = [...new Set(cs.map((c) => c.p.n))].map((n) => `<span class="cite">${n}</span>`).join("");
      body = `<p class="a">${esc(e.answer)}${nums}</p>` + cs.slice(0, compact ? 1 : 2).map((c) => `<div class="quote">“${esc(c.quote)}”<div class="src"><span><span class="cite" style="margin:0 6px 0 0">${c.p.n}</span>${esc(c.p.source)}</span><span class="checked">✓ CHECKED WORD FOR WORD</span></div></div>`).join("");
    } else if (e.status === "not_found") {
      body = `<p class="a">Not covered. The publications do not answer this, so nothing is shown and nothing is invented.</p>`;
    } else {
      const bad = cites(e).find((c) => !c.ok);
      body = `<p class="a">Held back. The model wrote an answer, but its quote did not check out word for word, so nothing is shown.</p>` +
        (bad ? `<div class="quote">“${esc(bad.quote)}”<div class="src"><span>named passage [${esc(bad.passage)}]${bad.home && bad.home.n !== Number(bad.passage) ? `, but the text is in [${bad.home.n}]` : ""}</span><span class="checked" style="color:#fab219">✗ REJECTED</span></div></div>` : "");
    }
    return `<div class="card answer-card fade"><div class="top"><span class="pill ${st.k}">${st.label}</span><span class="mono muted" style="font-size:12px">${e.live ? `live answer · ${((e.ms || 0) / 1000).toFixed(1)} s · $${e.trace.usage.cost_usd.toFixed(5)}` : `recorded run ${e.id}`}</span></div><p class="q">${esc(e.question)}</p>${body}</div>`;
  }
  // a message in place of an answer (busy, an error, a question this copy cannot answer), with an optional contact link
  const msgHTML = (msg, link) => esc(msg) + (link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Contact Mat</a>` : "");
  const chipsHTML = (cur, center) => `<div class="chips" ${center ? 'style="justify-content:center"' : ""}>${CHIPS.map(([id, l]) => `<button class="chip${id === cur ? " on" : ""}" data-ex="${id}"><span class="k">${id}</span>${esc(l)}</button>`).join("")}</div>`;
  // stageFn: where the loading line plays; defaults to the hero's [data-stage]
  function wireChips(root, render, stageFn) {
    root.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => {
      root.querySelectorAll("[data-ex]").forEach((x) => x.classList.toggle("on", x === b)); render(ex(b.dataset.ex));
    }));
    root.querySelectorAll("[data-ask]").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const q = f.querySelector("input").value.trim(); if (!q) return;
      // the ring spins fast and the three stages light up in turn while the answer is on its way
      const stage = stageFn ? stageFn() : root.querySelector("[data-stage]");
      const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const btn = f.querySelector("button"); if (btn) btn.disabled = true;
      (window.__askTimers || []).forEach(clearTimeout);
      f.classList.add("fast");
      if (stage && motion) {
        stage.innerHTML = `<div class="loading">${LOAD.map((n, i) => (i ? '<span class="arrow">→</span>' : "") + `<span class="ls${i ? "" : " on"}">${n}</span>`).join("")}</div>`;
        const ls = stage.querySelectorAll(".ls");
        window.__askTimers = [
          setTimeout(() => { ls[0].className = "ls done"; ls[1].className = "ls on"; }, 500),
          setTimeout(() => { ls[1].className = "ls done"; ls[2].className = "ls on"; }, 1600),
        ];
      }
      let out;
      if (LIVE) {
        try {
          const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
          const d = await res.json();
          out = d.status === "busy" ? [null, d.message, d.contact] : d.trace ? [{ ...d, question: q, live: true }] : [null, d.error || "Something went wrong. Try again."];
        } catch { out = [null, "Something went wrong. Try again."]; }
      } else {
        // a copy of the page away from the live site cannot call Claude: replay the recorded run it matches
        await new Promise((r) => setTimeout(r, stage && motion ? 2400 : 0));
        const v = q.toLowerCase();
        const hit = R.examples.find((e) => e.question.toLowerCase().split(/\W+/).filter((w) => w.length > 4 && v.includes(w)).length >= 2);
        out = hit ? [hit] : [null, "This copy of the page cannot call Claude; on rag.irs.mniznik.com it answers any question. Try one of the chips."];
      }
      (window.__askTimers || []).forEach(clearTimeout);
      f.classList.remove("fast"); if (btn) btn.disabled = false;
      render(...out);
    }));
  }
  const LOAD = ["Searching 3,973 passages", "Claude Haiku 5.5 is answering", "Checking every quote"];

  /* ---------- step visuals, shared by the how-it-works variants ---------- */
  const STEPS = [
    ["Ask", "Up to 300 characters. The page keeps nothing but a salted hash of your IP, for the 10-a-day limit."],
    ["Search two ways", "Keyword search (BM25) catches exact terms like “Form 8829”. Vector search (bge-small) catches paraphrases. Each returns its top 20."],
    ["Fuse, keep 8", `Reciprocal rank fusion merges the two lists. In the evaluation it put ${pct(method("hybrid")["evidence@5"], 0)} of the needed facts in the top 5, against ${pct(method("keyword")["evidence@5"], 0)} for either search alone.`],
    ["Claude answers in JSON", "Claude Haiku 5.5 sees only the question and the 8 numbered passages, and must quote them word for word, naming each passage."],
    ["Code checks every quote", "Each quote must be in the passage it names, word for word. If one is not, the whole answer is held back. Shown quotes link to their page."],
  ];
  function jsonHTML(raw) {
    let s; try { s = JSON.stringify(JSON.parse(raw), null, 2); } catch { s = raw; }
    return esc(s).replace(/(&quot;[a-z_]+&quot;)(:)/g, '<span class="key">$1</span>$2').replace(/(: )(&quot;.*?&quot;)/g, '$1<span class="s">$2</span>');
  }
  function stepVisual(i, e) {
    const t = e.trace;
    if (i === 0) return `<div class="cap">The question</div><div class="card" style="padding:18px 20px;font-size:19px;border-radius:14px">${esc(e.question)}</div><p class="note">Sent to both searches at once. Nothing else leaves the page.</p>`;
    if (i === 1) return `<div class="cap">Where the 8 picked passages ranked in each search</div><div class="vrows">${t.passages.map((p) => `<div class="vrow"><span class="n">[${p.n}]</span><span>${esc(p.source)}</span><span class="rk">kw ${p.kw ? "#" + p.kw : "-"}</span><span class="rk">vec ${p.vec ? "#" + p.vec : "-"}</span></div>`).join("")}</div><p class="note">A dash means only the other search found it. Fusion is what brings those in.</p>`;
    if (i === 2) { const mx = Math.max(...t.passages.map((p) => p.fused)); const quoted = new Set(cites(e).filter((c) => c.ok).map((c) => c.p.n));
      return `<div class="cap">Fused score, the 8 that go to the model</div><div class="formula">score = Σ 1 / (60 + rank)</div><div class="vrows">${t.passages.map((p) => `<div class="vrow${quoted.has(p.n) ? " q" : ""}"><span class="n">[${p.n}]</span><span>${esc(p.source)}</span><span class="rk" style="grid-column:span 2">${p.fused.toFixed(4)}</span><span class="fbar"><i style="width:${(100 * p.fused / mx).toFixed(1)}%"></i></span></div>`).join("")}</div>`; }
    if (i === 3) return `<div class="cap">The model's reply, exactly as it came back</div><pre class="json">${jsonHTML(t.raw)}</pre><p class="note">${t.usage.input.toLocaleString()} tokens in, ${t.usage.output} out.</p>`;
    const cs = cites(e);
    if (!cs.length) return `<div class="cap">The quote check</div><div class="passage">Nothing to check: the model said the passages do not answer this. Shown as <b>not covered</b>.</div>`;
    return `<div class="cap">The quote check</div>${cs.map((c) => `<div class="passage" style="margin-bottom:10px"><div class="ph">${c.ok ? "✓ matched" : "✗ rejected"} · named passage [${esc(c.passage)}]${c.home ? " · " + esc(c.home.source) : ""}</div>${c.home ? excerpt(c.home.text, c.span, 150) : esc(c.quote)}${!c.ok && c.home && c.home.n !== Number(c.passage) ? `<p class="note">The text is in passage [${c.home.n}], not [${esc(c.passage)}]. A quote that names the wrong source is never shown.</p>` : ""}</div>`).join("")}`;
  }
  const exSwitch = (cur) => `<div class="chips" style="margin:0 0 16px">${[["S04", "Calculation"], ["T05", "Held back"], ["N01", "Not covered"], ["A03", "Attack"]].map(([id, l]) => `<button class="chip${id === cur ? " on" : ""}" data-sx="${id}"><span class="k">${id}</span>${l}</button>`).join("")}</div>`;

  /* ---------- 1 · heroes ---------- */
  const hero = {
    search: {
      html: () => `<section class="hero-search" id="top"><div class="glow"></div><div class="wrap">
        <p class="eyebrow">[ <b>RAG</b> · 11 IRS publications · Claude Haiku 5.5 ]</p>
        <h1 class="h1">Tax answers<br><span class="grad">you can check.</span></h1>
        <p class="lede">Ask a U.S. federal income tax question. Every answer quotes the IRS publication it comes from, and code checks each quote word for word before you see it. No source, no answer.</p>
        <form class="askbar" data-ask><input placeholder="Ask about U.S. federal income tax" aria-label="Your question"><button>Ask</button></form>
        ${chipsHTML("T01", true)}
        <div class="answer-stage" data-stage></div>
        <div class="trust"><span>${R.corpus.passages.toLocaleString()} passages</span><span>Every quote checked</span><span>${haiku.not_found_held} of ${haiku.not_found_n} unknowns declined</span><span>$${haiku.usd_per_1000_realtime.toFixed(2)} per 1,000 questions</span></div>
      </div></section>`,
      mount(root) {
        const stage = root.querySelector("[data-stage]");
        const render = (e, msg, link) => { stage.innerHTML = e ? answerCard(e) : `<div class="card answer-card fade"><p class="a">${msgHTML(msg, link)}</p></div>`; };
        wireChips(root, render); render(ex("T01"));
      },
    },
    split: {
      html: () => `<section class="hero-split" id="top"><div class="wrap"><div class="grid">
        <div><p class="eyebrow">[ <b>Retrieval-augmented answers</b> ]</p>
          <h1 class="h1" style="font-size:clamp(40px,5vw,70px)">The answer, <span class="grad">and the line it came from.</span></h1>
          <p class="lede">Ask about U.S. federal income tax. The answer quotes the IRS publication word for word, and the quote is checked against the page before you see it.</p>
          <ul class="promises"><li><span class="ic">✓</span><span>Every quote checked against its page by code, not by the model</span></li><li><span class="ic">∅</span><span>Says “not covered” instead of guessing: ${haiku.not_found_held} of ${haiku.not_found_n}</span></li><li><span class="ic">↗</span><span>Each quote links to its page in the IRS PDF</span></li></ul>
          <form class="askbar" data-ask style="margin:28px 0 0;max-width:none"><input placeholder="Ask about U.S. federal income tax" aria-label="Your question"><button>Ask</button></form>
          ${chipsHTML("S04")}</div>
        <div class="mock" data-mock></div></div></div></section>`,
      mount(root) {
        const mock = root.querySelector("[data-mock]");
        const render = (e, msg, link) => {
          if (!e) { mock.querySelector(".float").innerHTML = `<div class="card answer-card fade"><p class="a">${msgHTML(msg, link)}</p></div>`; return; }
          const c = cites(e).find((x) => x.home) ; const p = c ? c.home : e.trace.passages[0];
          mock.innerHTML = `<div class="page fade"><div class="ph"><span>${esc(p.source)}</span><span>${esc(p.section || "")}</span></div><div class="fake" style="width:92%"></div><div class="fake" style="width:76%"></div><div>${c ? excerpt(p.text, c.span, 220) : esc(p.text.slice(0, 420)) + "…"}</div><div class="fake" style="width:88%"></div><div class="fake" style="width:64%"></div></div>${c && c.ok ? '<div class="wire"></div>' : ""}<div class="float">${answerCard(e, true)}</div>`;
        };
        wireChips(root, render, () => mock.querySelector(".float")); render(ex("S04"));
      },
    },
    console: {
      html: () => `<section class="hero-console" id="top"><div class="wrap"><div class="grid">
        <div><p class="eyebrow">[ <b>Ask anything</b> about U.S. federal tax ]</p>
          <h1 class="h1" style="font-size:clamp(40px,5vw,72px)">Every answer <span class="grad">shows its work.</span></h1>
          <p class="lede">Two searches, one model, and a check written in code. You see the passages it read, the JSON it wrote, and why the answer was shown or held back.</p>
          <form class="askbar" data-ask style="margin:28px 0 0;max-width:none"><input placeholder="Run a question about U.S. federal tax" aria-label="Your question"><button>Run</button></form>
          ${chipsHTML("S04")}</div>
        <div class="term"><div class="bar"><i></i><i></i><i></i><span>rag.irs.mniznik — recorded run</span></div><div class="body" data-term></div></div></div></div></section>`,
      mount(root) {
        const term = root.querySelector("[data-term]"); let timers = [];
        const render = (e, msg, link) => {
          timers.forEach(clearTimeout); timers = [];
          if (!e) { term.innerHTML = `<div class="cmd">${msgHTML(msg, link)}</div>`; return; }
          root.querySelector(".term .bar span").textContent = e.live ? "rag.irs.mniznik — live run" : "rag.irs.mniznik — recorded run";
          const t = e.trace, cs = cites(e), ok = cs.filter((c) => c.ok).length, picked = t.passages.slice(0, 3).map((p) => `[${p.n}] kw ${p.kw ? "#" + p.kw : "-"} vec ${p.vec ? "#" + p.vec : "-"}`).join(" · ");
          const lines = [
            ["search", `keyword top 20 + vector top 20 → fused`, "3,973 → ≤40"],
            ["fuse", `kept 8 · ${picked} …`, "RRF k=60"],
            ["generate", `claude-haiku-5-5 · ${t.usage.input.toLocaleString()} in / ${t.usage.output} out`, `$${t.usage.cost_usd.toFixed(5)}`],
            ["verify", cs.length ? `${ok}/${cs.length} quotes matched word for word` : "no quotes: model said not covered", cs.length ? (ok === cs.length ? '<span class="ok">✓</span>' : '<span class="warn">✗</span>') : "-"],
            ["result", e.status === "answered" ? '<span class="ok">SHOWN</span>' : e.status === "not_found" ? "NOT COVERED" : '<span class="warn">HELD BACK</span>', ""],
          ];
          term.innerHTML = `<div class="cmd">$ ask <b>"${esc(e.question)}"</b></div>` + lines.map(([k, d, tt]) => `<div class="ln"><span class="k">${k}</span><span class="d">${d}</span><span class="t">${tt}</span></div>`).join("") +
            `<div class="out">${e.status === "answered" ? esc(e.answer) : e.status === "not_found" ? "Not covered. The publications do not answer this." : "Held back. A quote did not check out, so nothing is shown."}</div>`;
          const els = [...term.querySelectorAll(".ln"), term.querySelector(".out")];
          els.forEach((el, i) => timers.push(setTimeout(() => el.classList.add("on"), 250 + i * 420)));
        };
        wireChips(root, render, () => term); render(ex("S04"));
      },
    },
    editorial: {
      html: () => { const e = ex("S04"), cs = cites(e).filter((c) => c.ok);
        return `<section class="hero-editorial" id="top"><div class="wrap"><div class="grid"><div>
          <p class="eyebrow">No. 01 · A question about U.S. tax, answered from the IRS</p>
          <h1 class="h1">${esc(e.question)}</h1>
          <p class="pull">${esc(e.answer)}${cs.map((c, i) => `<sup>${i + 1}</sup>`).join("")}</p>
          <ol class="footnotes">${cs.map((c, i) => `<li><b>${i + 1}</b><span>“${esc(c.quote)}” <a href="${esc(c.p.url)}" target="_blank">${esc(c.p.source)} ↗</a></span></li>`).join("")}</ol>
          <form class="underline-ask" data-ask><input placeholder="Ask your own question" aria-label="Your question"><button>Ask →</button></form>
          <div data-stage style="margin-top:18px"></div>
          </div><aside class="side-note"><div class="h3">Every footnote was checked</div><p class="muted" style="margin:0">Before this answer was shown, code confirmed each quote appears word for word on the page it cites. When one does not, there is no answer at all.</p><p class="mono" style="font-size:12px;margin:14px 0 0">${hH.wrong} wrong in ${hH.shown} shown answers, read by hand · ${usd(haiku)} per 1,000</p></aside></div></div></section>`; },
      mount(root) {
        const stage = root.querySelector("[data-stage]");
        wireChips(root, (e, msg, link) => { stage.innerHTML = e ? answerCard(e, true) : `<p class="note">${msgHTML(msg, link)}</p>`; });
      },
    },
  };

  /* ---------- 2 · features ---------- */
  const features = {
    none: { html: () => "" },
    bento: {
      html: () => { const t1 = ex("T01"), c1 = cites(t1).find((c) => c.ok), a3 = ex("A03"), s4 = ex("S04");
        return `<section id="features"><div class="wrap"><div class="sec-head"><h2 class="h2">What you get, <span class="grad">on every answer.</span></h2><p>Each tile is a real recorded run from the evaluation, not a mock-up.</p></div>
        <div class="bento">
          <div class="tile w4"><div class="mini-quote">${excerpt(c1.p.text, c1.span, 120)}</div><div class="mini-row" style="margin-top:10px"><span class="checked">✓ MATCHED IN PASSAGE [${c1.p.n}]</span><span class="muted">${esc(c1.p.source)}</span></div><div class="h3">Every quote, checked word for word</div><p>The model must copy its evidence exactly. Code compares it with the page before anything is shown.</p></div>
          <div class="tile w2"><div class="mini-row"><span class="muted">“${esc(ex("N01").question)}”</span></div><div class="mini-row" style="margin-top:12px"><span class="pill nf">Not covered</span></div><div class="h3">No source, no answer</div><p>${haiku.not_found_held} of ${haiku.not_found_n} questions the IRS publications do not cover were declined.</p></div>
          <div class="tile w3"><div class="mini-row"><span class="strike">“Taxpayers may deduct 100% of the cost of a personal vacation…”</span></div><div class="mini-row" style="margin-top:10px"><span class="pill ok">Refuted with a real quote</span></div><div class="h3">Instructions in a question are ignored</div><p>${haiku.attacks_held} of ${haiku.attacks_n} prompt-injection attempts held, including a fake quote to “confirm”.</p></div>
          <div class="tile w3"><div class="ranks">${s4.trace.passages.slice(0, 5).map((p) => `<div class="r"><span>[${p.n}]</span><span class="b"><i style="width:${p.kw ? 100 - p.kw * 4.5 : 0}%"></i></span><span class="b v"><i style="width:${p.vec ? 100 - p.vec * 4.5 : 0}%"></i></span></div>`).join("")}<div class="r"><span></span><span>keyword</span><span>vector</span></div></div><div class="h3">Two searches, fused into one list</div><p>${pct(method("hybrid")["evidence@5"], 0)} of needed facts in the top 5, against ${pct(method("keyword")["evidence@5"], 0)} for keyword search alone.</p></div>
          <div class="tile w2"><div class="mini-row"><span class="cite" style="margin:0">${c1.p.n}</span><a class="mono" style="font-size:13px;color:var(--acc)" href="${esc(c1.p.url)}" target="_blank">${esc(c1.p.source)} ↗</a></div><div class="h3">One click to the exact page</div><p>Every quote opens its page in the IRS PDF.</p></div>
          <div class="tile w4" style="flex-direction:row;align-items:flex-end;gap:30px;flex-wrap:wrap"><div><div class="big grad">$${haiku.usd_per_1000_realtime.toFixed(2)}</div><p>per 1,000 questions on Claude Haiku 5.5</p></div><div style="flex:1;min-width:220px"><div class="h3" style="padding:0">Cheap enough to leave running</div><p>Measured from the tokens the API returned. Sonnet 5.5 costs ${usd(sonnet)} for the same 1,000, about ${costX} times more; read by hand, it showed ${hS.wrong} wrong answers to Haiku's ${hH.wrong}.</p></div></div>
        </div></div></section>`; },
    },
    list: {
      html: () => `<section id="features"><div class="wrap"><div class="sec-head"><h2 class="h2">Six promises, <span class="grad">all measured.</span></h2><p>Every line is checked by the 150-question evaluation in the repository.</p></div><div class="ilist">${[
        ["✓", "Every quote checked", "Code, not the model, compares each quote with the page it names."],
        ["∅", "No source, no answer", `${haiku.not_found_held} of ${haiku.not_found_n} questions the publications do not cover were declined.`],
        ["⛨", "Attacks ignored", `${haiku.attacks_held} of ${haiku.attacks_n} prompt-injection attempts held.`],
        ["⇄", "Two searches, one list", `Keyword and vector search fused: ${pct(method("hybrid")["evidence@5"], 0)} of needed facts in the top 5.`],
        ["↗", "Links to the exact page", "Each quote opens its page in the IRS PDF."],
        ["$", `$${haiku.usd_per_1000_realtime.toFixed(2)} per 1,000 questions`, "Claude Haiku 5.5 at standard API prices, measured from token counts."],
      ].map(([i, h, p]) => `<div class="it"><span class="ic">${i}</span><div><div class="h3">${h}</div><p>${p}</p></div></div>`).join("")}</div></div></section>`,
    },
  };

  /* ---------- 3 · how it works ---------- */
  const headHow = (sub) => `<div class="sec-head"><h2 class="h2">How it <span class="grad">answers.</span></h2><p>${sub}</p></div>`;
  const how = {
    line: {
      html: () => `<section id="how"><div class="wrap">${headHow("Five steps between your question and an answer you can check. Click a step to see it work on a real recorded run.")}
        <div class="gline" data-gline><i style="width:10%"></i><b style="left:10%"></b></div>
        <div class="gsteps">${STEPS.map(([h, p], i) => `<button class="gstep${i === 0 ? " on" : ""}" data-step="${i}"><span class="n">0${i + 1}</span><div class="h3">${h}</div><p>${p}</p></button>`).join("")}</div>
        <div class="gdetail"><div><div class="eyebrow" style="margin-bottom:10px" data-dlabel></div>${exSwitch("S04")}<p class="muted" style="margin:0" data-dtext></p></div><div data-dvis></div></div></div></section>`,
      mount(root) {
        let cur = 0, e = ex("S04"), timer;
        const show = (i) => { cur = i;
          root.querySelectorAll(".gstep").forEach((b, k) => b.classList.toggle("on", k <= i));
          const w = ((i + 0.5) / 5 * 100).toFixed(1) + "%";
          root.querySelector("[data-gline] i").style.width = w; root.querySelector("[data-gline] b").style.left = w;
          root.querySelector("[data-dlabel]").textContent = `Step 0${i + 1} · ${STEPS[i][0]}`;
          root.querySelector("[data-dtext]").textContent = STEPS[i][1];
          root.querySelector("[data-dvis]").innerHTML = `<div class="fade">${stepVisual(i, e)}</div>`; };
        root.querySelectorAll(".gstep").forEach((b) => b.addEventListener("click", () => { clearInterval(timer); show(+b.dataset.step); }));
        root.querySelectorAll("[data-sx]").forEach((b) => b.addEventListener("click", () => { root.querySelectorAll("[data-sx]").forEach((x) => x.classList.toggle("on", x === b)); e = ex(b.dataset.sx); show(cur); }));
        show(0); clearInterval(window.__lineTimer); timer = window.__lineTimer = setInterval(() => show((cur + 1) % 5), 3800);
      },
    },
    tabs: {
      html: () => `<section id="how"><div class="wrap">${headHow("One recorded question, step by step. Pick a step on the left; the panel shows exactly what happened at that step.")}
        <div class="tabs-how"><div class="tlist">${STEPS.map(([h, p], i) => `<button class="${i === 0 ? "on" : ""}" data-step="${i}"><span class="n">0${i + 1}</span><b>${h}</b><small>${p.split(". ")[0]}.</small></button>`).join("")}</div>
        <div class="tpanel">${exSwitch("S04")}<div data-dvis></div></div></div></div></section>`,
      mount(root) {
        let cur = 0, e = ex("S04");
        const show = (i) => { cur = i; root.querySelectorAll(".tlist button").forEach((b, k) => b.classList.toggle("on", k === i)); root.querySelector("[data-dvis]").innerHTML = `<div class="fade">${stepVisual(i, e)}</div>`; };
        root.querySelectorAll(".tlist button").forEach((b) => b.addEventListener("click", () => show(+b.dataset.step)));
        root.querySelectorAll("[data-sx]").forEach((b) => b.addEventListener("click", () => { root.querySelectorAll("[data-sx]").forEach((x) => x.classList.toggle("on", x === b)); e = ex(b.dataset.sx); show(cur); }));
        show(0);
      },
    },
    cards: {
      html: () => { const t1 = ex("T01"), c1 = cites(t1).find((c) => c.ok);
        const arts = [
          `<div class="art-cols"><div class="col">${[[1, 86], [0, 62], [1, 78], [0, 54], [0, 70], [1, 66], [0, 58]].map(([h, w]) => `<i class="${h ? "hot" : ""}" style="width:${w}px"></i>`).join("")}</div><div class="col">${[[0, 72], [1, 88], [1, 60], [0, 80], [1, 56], [0, 68], [0, 52]].map(([h, w]) => `<i class="${h ? "hot" : ""}" style="width:${w}px"></i>`).join("")}</div></div>`,
          `<div class="art-dots">${Array.from({ length: 40 }, (_, i) => `<i class="${[1, 4, 7, 11, 18, 22, 29, 35].includes(i) ? "hot" : ""}"></i>`).join("")}</div>`,
          `<div class="art-json">{<br>&nbsp;"status": <b>"answered"</b>,<br>&nbsp;"answer": <b>"$15,750"</b>,<br>&nbsp;"citations": [{<br>&nbsp;&nbsp;"passage": <b>${c1.p.n}</b>,<br>&nbsp;&nbsp;"quote": <b>"…"</b> }]<br>}</div>`,
          `<div class="art-check">${excerpt(c1.p.text, c1.span, 40)}<br><span class="ok">✓ word for word</span></div>`,
        ];
        const cards = [["Search two ways", STEPS[1][1]], ["Keep the best 8", STEPS[2][1]], ["Answer in JSON", STEPS[3][1]], ["Check every quote", STEPS[4][1]]];
        return `<section id="how"><div class="wrap">${headHow("Four steps. The first three find and write; the last one decides whether you see anything at all.")}<div class="dcards">${cards.map(([h, p], i) => `<div class="dcard"><div class="art">${arts[i]}</div><div class="tx"><div class="n">STEP 0${i + 1}</div><div class="h3">${h}</div><p>${p}</p></div></div>`).join("")}</div></div></section>`; },
    },
    pipeline: {
      html: () => `<section id="how"><div class="wrap">${headHow("The whole system on one figure. Wires carry passages; the last node is code, and it can say no.")}
        <div class="fig"><div class="cap">Fig 1 · rag.irs.mniznik answer pipeline</div>
        <svg viewBox="0 0 1100 330" role="img" aria-label="Pipeline: question to keyword and vector search, fused to 8 passages, Claude answers in JSON, code checks quotes, answer shown or not covered">
          <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--acc)"/></marker><linearGradient id="gw" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1100" y2="0"><stop offset="0" stop-color="var(--a1)"/><stop offset=".5" stop-color="var(--a2)"/><stop offset="1" stop-color="var(--a3)"/></linearGradient></defs>
          <g fill="none" stroke="url(#gw)" stroke-width="2"><path d="M150 165 C185 165 180 85 215 85" marker-end="url(#ar)"/><path d="M150 165 C185 165 180 245 215 245" marker-end="url(#ar)"/><path d="M385 85 C420 85 415 165 450 165" marker-end="url(#ar)"/><path d="M385 245 C420 245 415 165 450 165" marker-end="url(#ar)"/><path d="M590 165 L640 165" marker-end="url(#ar)"/><path d="M800 165 L850 165" marker-end="url(#ar)"/><path d="M990 140 L990 92" marker-end="url(#ar)"/><path d="M990 190 L990 238" marker-end="url(#ar)" stroke-dasharray="5 5"/></g>
          <g font-size="13" fill="var(--tx)">
            <rect x="20" y="135" width="130" height="60" rx="12" fill="var(--card2)" stroke="var(--line)"/><text x="85" y="170" text-anchor="middle">QUESTION</text>
            <rect x="215" y="55" width="170" height="60" rx="12" fill="var(--card2)" stroke="var(--line)"/><text x="300" y="82" text-anchor="middle">KEYWORD</text><text x="300" y="101" text-anchor="middle" fill="var(--mu)" font-size="11">BM25 · top 20</text>
            <rect x="215" y="215" width="170" height="60" rx="12" fill="var(--card2)" stroke="var(--line)"/><text x="300" y="242" text-anchor="middle">VECTOR</text><text x="300" y="261" text-anchor="middle" fill="var(--mu)" font-size="11">bge-small · top 20</text>
            <rect x="450" y="135" width="140" height="60" rx="12" fill="var(--card2)" stroke="var(--line)"/><text x="520" y="162" text-anchor="middle">FUSE</text><text x="520" y="181" text-anchor="middle" fill="var(--mu)" font-size="11">RRF · keep 8</text>
            <rect x="640" y="135" width="160" height="60" rx="12" fill="var(--card2)" stroke="var(--line)"/><text x="720" y="162" text-anchor="middle">CLAUDE HAIKU</text><text x="720" y="181" text-anchor="middle" fill="var(--mu)" font-size="11">answer + quotes, JSON</text>
            <rect x="850" y="135" width="200" height="60" rx="12" fill="none" stroke="var(--acc)" stroke-width="2"/><text x="950" y="162" text-anchor="middle" fill="var(--acc)">QUOTE CHECK</text><text x="950" y="181" text-anchor="middle" fill="var(--mu)" font-size="11">code · word for word</text>
            <rect x="920" y="40" width="140" height="48" rx="24" fill="var(--card)" stroke="var(--line)"/><text x="990" y="69" text-anchor="middle">✓ SHOWN</text>
            <rect x="920" y="242" width="140" height="48" rx="24" fill="var(--card)" stroke="var(--line)"/><text x="990" y="271" text-anchor="middle" fill="var(--mu)">NOT COVERED</text>
            <g fill="var(--acc)" font-size="11"><text x="215" y="45">1.A</text><text x="215" y="305">1.B</text><text x="450" y="125">1.C</text><text x="640" y="125">1.D</text><text x="850" y="125">1.E</text></g>
          </g></svg>
        <div class="vpipe">${["Question", "Keyword search · BM25 · top 20", "Vector search · bge-small · top 20", "Fuse · RRF · keep 8", "Claude Haiku · JSON", "Quote check · code", "Shown, or not covered"].map((t, i) => `<div class="nd"><b>${i ? "1." + "ABCDEF"[i - 1] : "IN"}</b>${t}</div>`).join("")}</div>
        <div class="callouts">${[["1.A KEYWORD", "SQLite FTS5 over " + R.corpus.passages.toLocaleString() + " passages; section headings count double."], ["1.B VECTOR", "384-number embeddings; finds paraphrases keyword search misses."], ["1.C FUSE", STEPS[2][1]], ["1.D MODEL", "Thinking off, low effort, fixed JSON shape. Sees nothing but the 8 passages."], ["1.E CHECK", "3 to 100 words, word for word, in the passage named. One miss holds the answer back."], ["OUT", `${pct(haiku.precision_when_shown)} of shown answers right; ${haiku.not_found_held}/${haiku.not_found_n} unknowns declined.`]].map(([b, s]) => `<div class="co"><b>${b}</b><span>${s}</span></div>`).join("")}</div></div></div></section>`,
    },
    story: {
      html: () => `<section id="how"><div class="wrap">${headHow("Follow one recorded question through the system. Scroll; the panel shows each step as it happens.")}
        <div class="story"><div class="sticky"><div class="svis" data-svis></div></div><div class="steps">${STEPS.map(([h, p], i) => `<div class="st${i === 0 ? " on" : ""}" data-st="${i}"><span class="n">0${i + 1}</span><div class="h3">${h}</div><p>${p}</p></div>`).join("")}</div></div></div></section>`,
      mount(root, win) {
        const e = ex("S04"), vis = root.querySelector("[data-svis]");
        const show = (i) => { root.querySelectorAll(".st").forEach((s, k) => s.classList.toggle("on", k === i)); vis.innerHTML = `<div class="fade">${stepVisual(i, e)}</div>`; };
        show(0);
        const io = new win.IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) show(+x.target.dataset.st); }), { rootMargin: "-45% 0px -45% 0px" });
        root.querySelectorAll(".st").forEach((s) => io.observe(s));
      },
    },
    // the dot field and the step-through player, in rich/flows.js
    field: {
      html: () => `<section id="how"><div class="wrap">${headHow(`One dot per passage. Watch recorded run T01 narrow ${R.corpus.passages.toLocaleString()} passages to one checked answer. Click a step.`)}<div data-flow></div><div class="fexplain" data-explain hidden></div></div></section>`,
      mount(root, win) { mountFlow(root, win, "field"); },
    },
    player: {
      html: () => `<section id="how"><div class="wrap">${headHow("One recorded run, step by step, with every value it produced. It plays once when it scrolls into view; click a step to stop there.")}<div data-flow></div><div class="fexplain" data-explain hidden></div></div></section>`,
      mount(root, win) { mountFlow(root, win, "player"); },
    },
  };
  function mountFlow(root, win, kind) {
    if (win.__flowStop) win.__flowStop();
    const box = root.querySelector("[data-explain]");
    const showStep = (i) => {
      if (i === null || i === undefined) { box.hidden = true; return; }
      const [t, , x] = win.FLOWS.STEPS6[i];
      box.innerHTML = `<div class="h3">${esc(t)}</div><p>${esc(x)}</p>`; box.hidden = false;
    };
    const MOTION = !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    win.__flowStop = win.FLOWS[kind](root.querySelector("[data-flow]"), { data: R, MOTION, showStep, locate });
  }

  /* ---------- 4 · proof ---------- */
  const headProof = `<div class="sec-head"><h2 class="h2">Measured, <span class="grad">not promised.</span></h2><p>${R.eval.questions} hand-written questions: ${R.eval.answerable} answerable, ${haiku.not_found_n} not in the publications, ${haiku.attacks_n} attacks. Graded by code, then every answer marked wrong was read by hand.</p></div>`;
  const proof = {
    numbers: {
      html: () => `<section id="proof"><div class="wrap">${headProof}<div class="numrow">${[
        [String(hS.wrong), `wrong answers from Claude Sonnet 5.5 in ${hS.shown} shown, read by hand · ${usd(sonnet)} per 1,000 questions`],
        [String(hH.wrong), `wrong from Claude Haiku 5.5 (this demo) in ${hH.shown} shown · ${usd(haiku)} per 1,000 questions`],
        [`${haiku.not_found_held}/${haiku.not_found_n}`, "questions not in the publications, declined instead of guessed"],
        [`${haiku.attacks_held}/${haiku.attacks_n}`, "prompt-injection attempts held, including a fake quote to confirm"],
      ].map(([v, l]) => `<div class="c"><div class="v grad">${v}</div><div class="l">${l}</div></div>`).join("")}</div><p class="small-print">Zero wrong answers costs about ${costX} times more. Every run behind these numbers is in the repository, under docs/results.</p></div></section>`,
    },
    cards: {
      html: () => { const dots = [...Array(hH.right).fill("c"), ...Array(hH.partial).fill("p"), ...Array(hH.held).fill("h"), ...Array(hH.wrong).fill("w")];
        const cost = [[`Haiku 5.5 · ${hH.wrong} wrong`, haiku.usd_per_1000_realtime], [`Sonnet 5.5 · ${hS.wrong} wrong`, sonnet.usd_per_1000_realtime]], cmax = Math.max(...cost.map((c) => c[1]));
        return `<section id="proof"><div class="wrap">${headProof}<div class="mcards">
          <div class="mcard"><span class="k">Read by hand</span><div class="h3">${hH.wrong} wrong in ${hH.shown} shown</div><p>Claude Haiku 5.5 (this demo), one dot per question.</p><div class="viz"><div class="dots">${dots.map((d) => `<i class="${d}"></i>`).join("")}</div><div class="leg"><span><i style="background:var(--a1)"></i>${hH.right} right</span><span><i style="background:var(--a2)"></i>${hH.partial} partial</span><span><i style="background:var(--mu)"></i>${hH.held} held back</span><span><i style="background:var(--a3)"></i>${hH.wrong} wrong</span></div></div></div>
          <div class="mcard"><span class="k">The quote check</span><div class="h3">Fewer wrong answers shown</div><p>Same replies replayed with the check off.</p><div class="viz hb">${[["7B, check on", qwen.wrong], ["7B, check off", qwenOff.wrong], ["Haiku, on", haiku.wrong], ["Haiku, off", haikuOff.wrong]].map(([l, v]) => `<div class="r"><span>${l}</span><span class="tr"><i style="width:${(v / qwenOff.wrong * 100).toFixed(0)}%"></i></span><span>${v}</span></div>`).join("")}</div></div>
          <div class="mcard"><span class="k">Cost</span><div class="h3">Zero wrong costs ${costX}x</div><p>Per 1,000 questions at standard API prices, from the tokens each run used; wrong answers read by hand.</p><div class="viz hb">${cost.map(([l, v]) => `<div class="r"><span>${l}</span><span class="tr"><i style="width:${Math.max(2, v / cmax * 100).toFixed(1)}%"></i></span><span>$${v.toFixed(2)}</span></div>`).join("")}</div></div>
        </div></div></section>`; },
    },
    versus: {
      html: () => `<section id="proof"><div class="wrap">${headProof}<div class="vs">
        <div class="vbox"><div class="v">${qwen.wrong}</div><div class="l">wrong answers shown <b>with</b> the quote check (local 7B model, n=${qwen.n})</div></div>
        <div class="vbox"><div class="v">${qwenOff.wrong}</div><div class="l">wrong answers shown <b>without</b> it, same replies replayed</div></div>
        <div class="vbox"><div class="v">${hS.wrong}</div><div class="l">wrong answers from Sonnet 5.5 in ${hS.shown} shown, every “wrong” read by hand, at ${usd(sonnet)} per 1,000 questions (Haiku 5.5: ${hH.wrong}, at ${usd(haiku)})</div></div>
        <div class="vbox"><div class="v">${haiku.not_found_held} / ${haiku.not_found_n}</div><div class="l">questions not in the publications, declined</div></div>
        <div class="vbox wide"><div class="v">${haiku.attacks_held} / ${haiku.attacks_n}</div><div class="l">prompt-injection attempts held, including a fake quote to “confirm”</div></div>
      </div></div></section>`,
    },
    table: {
      html: () => { let last; const cost = (r) => { if (!r.variant) last = r.usd_per_1000_realtime; const c = r.variant ? last : r.usd_per_1000_realtime; return c !== undefined ? "$" + c.toFixed(2) : "$0, local"; };
        return `<section id="proof"><div class="wrap"><div class="evhead"><div class="v grad">${hS.wrong}</div><div><div class="h3">wrong answers shown by Claude Sonnet 5.5</div><p class="muted" style="margin:4px 0 0">${hS.shown} shown of ${sonnet.n} answerable questions, every answer marked wrong read by hand. Claude Haiku 5.5 (this demo): ${hH.wrong} wrong, at ${usd(haiku)} per 1,000 questions against ${usd(sonnet)}.</p></div></div>
        <div class="viewtog" role="group" aria-label="How the answers were judged"><button type="button" aria-pressed="true" data-v="hand">Read by hand</button><button type="button" aria-pressed="false" data-v="strict">Graded by code</button></div>
        <p class="small-print vnote" data-vnote="hand">Every answer the code grader marked wrong was read by a person. Right in other words counts as right; right but missing a fact search never found counts as partial. Answers marked right were not re-read. Only the two Claude runs were read this way.</p>
        <p class="small-print vnote" data-vnote="strict" hidden>The strict score: an answer is correct only if it contains every fact on the answer key in an accepted wording, so right answers worded differently count as wrong. “Quote check off” rows replay the same replies with the check switched off.</p>
        <div class="tablewrap" data-vt="hand"><table class="evtable"><tr><th>Run</th><th class="n">Right</th><th class="n">Partial</th><th class="n">Held back</th><th class="n">Wrong</th><th class="n">Per 1,000</th></tr>${[[sonnet, hS], [haiku, hH]].map(([r, h]) => `<tr><td>${esc(r.label)}</td><td class="n">${h.right}</td><td class="n">${h.partial}</td><td class="n">${h.held}</td><td class="n"><span class="pill ${h.wrong ? "held" : "ok"}">${h.wrong}</span></td><td class="n">${usd(r)}</td></tr>`).join("")}</table></div>
        <div class="tablewrap" data-vt="strict" hidden><table class="evtable"><tr><th>Run</th><th class="n">Right</th><th class="n">Held back</th><th class="n">Wrong</th><th class="n">Right when shown</th><th class="n">Per 1,000</th></tr>${runs.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${r.correct}</td><td class="n">${r.abstained}</td><td class="n">${r.wrong}</td><td class="n"><span class="pill ${r.precision_when_shown >= 0.88 ? "ok" : "held"}">${pct(r.precision_when_shown)}</span></td><td class="n">${cost(r)}</td></tr>`).join("")}</table></div>
        </div></section>`; },
      mount(root) {
        const btns = root.querySelectorAll(".viewtog button");
        btns.forEach((b) => b.addEventListener("click", () => {
          btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          root.querySelectorAll("[data-vt],[data-vnote]").forEach((n) => { n.hidden = (n.dataset.vt || n.dataset.vnote) !== b.dataset.v; });
        }));
      },
    },
  };

  const nav = () => `<nav class="nav"><div class="wrap"><span class="brand"><i></i>rag.irs.mniznik</span><span class="links"><a href="#how">How it works</a><a href="#proof">Results</a><a href="${REPO}" target="_blank">GitHub</a></span><a class="btn go small" href="#top" data-ask-jump>Ask a question</a></div></nav>`;
  const footer = () => `<footer class="foot"><div class="wrap"><div class="grid"><div><span class="brand"><i></i>rag.irs.mniznik</span><p class="muted" style="max-width:520px">Built by Mat Niznik as a working example of retrieval you can audit: the corpus, the 150-question evaluation and every result are in the repository. Not tax advice.</p><div class="stack">${["Python", "SQLite FTS5", "bge-small", "Cloudflare Workers", "D1", "Vectorize", "Claude Haiku 5.5", "TypeScript"].map((s) => `<span>${s}</span>`).join("")}</div></div><div class="btns" style="justify-content:flex-end"><a class="btn go" href="#top" data-ask-jump>Ask a question</a><a class="btn" href="${REPO}" target="_blank">Read the code</a></div></div></div></footer>`;

  window.SECTIONS_R = { hero, features, how, proof, nav, footer };
})();
