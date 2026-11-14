// Usage events and Microsoft Clarity. Events go to /api/event on this site with sendBeacon; the Worker keeps
// only fields of a fixed shape (src/events.ts) and adds its own (place, network, browser).
//   view          one per page load: the look, the link code, the referrer's host, size, setup, visitor id
//   studio_*      Studio open and picks         example   a recorded example or sample question
//   pdf, link     links to an IRS PDF page, GitHub or LinkedIn       passage   an opened passage
//   section       seconds each part of the page was in view
//   ask_focus     the ask box got focus          ask_abandon   something was typed and never asked
//   copy          text copied, where and how long                   error     a script error (5 at most)
//   perf          TTFB, FCP, LCP, CLS, load      leave     furthest point read, seconds in view
// A question's words and outcome are recorded by /api/ask, with the context from TRACK.ctx().
// Off with Global Privacy Control, or in this browser after ?track=off (until ?track=on): then no events, no
// visitor id and no Clarity. A ?src=<code> on the link is kept for the visit in sessionStorage.
(function () {
  "use strict";
  const OFF = "rag-no-track", SRC = "rag-src", VID = "rag-vid", CLARITY = "zdgaglciqq";
  const q = new URLSearchParams(location.search);
  const store = (s, f) => { try { return f(s); } catch { return null; } }; // storage can be blocked
  if (q.get("track") === "off") store(localStorage, (s) => s.setItem(OFF, "1"));
  if (q.get("track") === "on") store(localStorage, (s) => s.removeItem(OFF));
  const off = navigator.globalPrivacyControl === true || store(localStorage, (s) => s.getItem(OFF)) === "1";
  const rand = (n) => { let s = ""; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };

  let src = (q.get("src") || "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(src)) src = "";
  if (src) store(sessionStorage, (s) => s.setItem(SRC, src)); else src = store(sessionStorage, (s) => s.getItem(SRC)) || "";

  let vid = "";
  if (!off) {
    vid = store(localStorage, (s) => s.getItem(VID)) || "";
    if (!/^[a-z0-9]{12}$/.test(vid)) { vid = rand(12); store(localStorage, (s) => s.setItem(VID, vid)); }
  }
  const pv = rand(8); // this page load only
  const c = (window.SITE && window.SITE.choice) || {};
  /** The context every event carries; a question to /api/ask carries it too (or { off: true }). */
  const ctx = () => (off ? { off: true } : { layout: c.option, palette: c.palette, font: c.font, how: c.source, src, pv, vid });

  function send(t, fields) {
    if (off) return;
    const body = JSON.stringify(Object.assign({ t }, ctx(), fields));
    try { if (!navigator.sendBeacon("/api/event", body)) fetch("/api/event", { method: "POST", body, keepalive: true }); } catch { /* never in the way */ }
  }
  window.TRACK = { ctx };
  if (off) return;

  // ---------- Microsoft Clarity: recordings and heatmaps, tagged so a recording can be matched to the events ----------
  (function (c, l, a, r, i, t, y) { // Microsoft's loader, as in the @microsoft/clarity package (src/utils.js)
    if (l.getElementById("clarity-script")) return;
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i; t.id = "clarity-script";
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY);
  window.clarity("identify", vid, undefined, pv);
  window.clarity("set", "layout", c.option || "");
  window.clarity("set", "vid", vid);
  window.clarity("set", "pv", pv);
  if (src) window.clarity("set", "src", src);

  // ---------- the view ----------
  const refHost = (() => { try { const h = new URL(document.referrer).hostname; return h && h !== location.hostname ? h : ""; } catch { return ""; } })();
  const size = innerWidth < 700 ? "phone" : innerWidth < 1100 ? "tablet" : "desktop";
  const mq = (m) => matchMedia(m).matches;
  const setup = [
    navigator.language || "", (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })(),
    `${screen.width}x${screen.height}`, String(Math.round((devicePixelRatio || 1) * 100) / 100),
    mq("(prefers-color-scheme: dark)") ? "dark" : "light", mq("(prefers-reduced-motion: reduce)") ? "reduce" : "no-pref",
    (navigator.connection && navigator.connection.effectiveType) || "",
  ].map((s) => String(s).replace(/[^A-Za-z0-9_./+:-]/g, "")).join("|");
  send("view", { ref: refHost, size, setup });

  // where on the page something happened
  const where = (el) =>
    el.closest(".tr-more, .trace") ? "trace" : el.closest(".footnotes") ? "footnote" : el.closest("#built") ? "built" : el.closest(".nav") ? "nav"
      : el.closest(".answer-card, .mock, .term, #result, #replay-result, [data-stage]") ? "answer" : el.closest("#how, .how, [data-slot='how']") ? "how" : "page";

  // ---------- clicks ----------
  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const sp = el.closest(".sp-btn, .sp-lay, .sp-pal, .sp-font, .sp-reset");
    if (sp) {
      if (sp.matches(".sp-btn")) return send("studio_open", {});
      if (sp.matches(".sp-reset")) return send("studio_pick", { kind: "reset" });
      const [kind, key] = sp.matches(".sp-lay") ? ["layout", "o"] : sp.matches(".sp-pal") ? ["palette", "p"] : ["font", "f"];
      return send("studio_pick", { kind, value: sp.dataset[key] });
    }
    const ex = el.closest("[data-ex], [data-sample]");
    if (ex) return send("example", ex.dataset.ex ? { kind: "recorded", value: ex.dataset.ex } : { kind: "sample", value: ex.dataset.sample });
    const a = el.closest("a[href]");
    if (a) {
      const pdf = a.href.match(/irs\.gov\/pub\/irs-(?:pdf|prior)\/([\w-]+)\.pdf/);
      if (pdf) return send("pdf", { value: pdf[1], where: where(a) });
      const site = /github\.com/.test(a.href) ? "github" : /linkedin\.com/.test(a.href) ? "linkedin" : "";
      if (site) return send("link", { value: site, where: where(a) });
    }
  }, true); // capture: a Studio pick reloads the page from its own handler, so count it first

  // an opened passage in "How this answer was made" (toggle does not bubble; capture sees it)
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open || !d.matches(".prow")) return;
    send("passage", { n: [...d.parentElement.querySelectorAll(":scope > .prow")].indexOf(d) + 1, where: where(d) });
  }, true);

  // ---------- the ask box: focused, typed into, asked or not ----------
  const isAsk = (el) => el instanceof HTMLInputElement && (el.closest("[data-ask]") || el.id === "q");
  let focused = false, typed = 0;
  document.addEventListener("focusin", (e) => { if (isAsk(e.target) && !focused) { focused = true; send("ask_focus", {}); } });
  document.addEventListener("input", (e) => { if (isAsk(e.target)) typed = e.target.value.trim().length; });
  document.addEventListener("submit", () => { typed = 0; }, true);

  // ---------- copying ----------
  document.addEventListener("copy", () => {
    const sel = getSelection(), n = sel ? String(sel).length : 0;
    const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    if (n) send("copy", { n, where: node ? where(node) : "page" });
  });

  // ---------- script errors (5 per page at most) ----------
  let errors = 0;
  const err = (message, file) => {
    if (errors++ >= 5) return;
    send("error", { text: String(message || "").slice(0, 200), value: String(file || "").split(/[/?#]/).filter(Boolean).pop() || "" });
  };
  addEventListener("error", (e) => err(e.message, e.filename));
  addEventListener("unhandledrejection", (e) => err(e.reason && e.reason.message ? e.reason.message : String(e.reason), ""));

  // ---------- page speed ----------
  const perf = { ttfb: 0, fcp: 0, lcp: 0, cls: 0, load: 0 };
  const watch = (type, f) => { try { new PerformanceObserver((l) => l.getEntries().forEach(f)).observe({ type, buffered: true }); } catch { /* not supported */ } };
  watch("paint", (e) => { if (e.name === "first-contentful-paint") perf.fcp = e.startTime; });
  watch("largest-contentful-paint", (e) => { perf.lcp = e.startTime; });
  watch("layout-shift", (e) => { if (!e.hadRecentInput) perf.cls += e.value; });
  const nav = () => { const n = performance.getEntriesByType("navigation")[0]; if (n) { perf.ttfb = n.responseStart; perf.load = n.loadEventEnd; } };

  // ---------- sections: seconds each part of the page was in view ----------
  const secs = new Map(), since = new Map(), sentSecs = new Map();
  const nameOf = (el) => el.dataset.slot || el.id || el.tagName.toLowerCase();
  const tick = (name, on) => {
    const now = Date.now();
    if (since.has(name)) { secs.set(name, (secs.get(name) || 0) + now - since.get(name)); since.delete(name); }
    if (on && document.visibilityState === "visible") since.set(name, now);
  };
  let io = null;
  const parts = [...document.querySelectorAll("[data-slot], #built, footer, main > h2[id]")];
  const observe = () => parts.forEach((el) => { io.unobserve(el); io.observe(el); }); // observe() reports what is in view now
  try {
    io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const h = Math.min(e.boundingClientRect.height, innerHeight);
      tick(nameOf(e.target), e.isIntersecting && e.intersectionRect.height >= h * 0.25);
    }), { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    observe();
  } catch { io = null; /* no IntersectionObserver */ }

  // ---------- leaving: once each time the page is hidden ----------
  let maxScroll = 0, shown = 0, shownSince = document.visibilityState === "visible" ? Date.now() : 0, sent = false, perfSent = false;
  const read = () => {
    const h = document.documentElement.scrollHeight;
    maxScroll = Math.max(maxScroll, h ? Math.min(100, ((scrollY + innerHeight) / h) * 100) : 0);
  };
  addEventListener("scroll", read, { passive: true });
  const leave = () => {
    if (sent) return;
    sent = true;
    read();
    if (shownSince) { shown += Date.now() - shownSince; shownSince = 0; }
    [...since.keys()].forEach((name) => tick(name, false));
    for (const [name, ms] of secs) {
      const s = Math.round(ms / 1000) - (sentSecs.get(name) || 0);
      if (s > 0) { sentSecs.set(name, (sentSecs.get(name) || 0) + s); send("section", { kind: name, secs: s }); }
    }
    if (typed > 0) { send("ask_abandon", { n: typed }); typed = 0; }
    if (!perfSent) { perfSent = true; nav(); send("perf", perf); }
    send("leave", { scroll: Math.round(maxScroll), secs: Math.round(shown / 1000) });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
    else { shownSince = Date.now(); sent = false; if (io) observe(); }
  });
  addEventListener("pagehide", leave);
})();
