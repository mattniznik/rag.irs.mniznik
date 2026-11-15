// The layouts, colour sets and typefaces a visitor can pick in the Studio panel, and the site default.
// A classic script: it sets window.STUDIO before the loader (studio/loader.js) decides what to show.
(function () {
  "use strict";
  // Four layouts are built from sections (rich/sections.js); three are the simple one-column report (simple/).
  // cfg is each layout's own look; a visitor can then change the colours and type.
  const OPTIONS = [
    { id: "01", name: "Ask anything", short: "The ask box up front, the answer right under it, then a field of dots that shows the pipeline.", cfg: { hero: "search", features: "bento", how: "field", proof: "numbers", palette: "coverDark", font: "grotesk" } },
    { id: "04", name: "Under the hood", short: "For engineers: the run as a log, the system as a figure, the results as a table.", cfg: { hero: "console", features: "none", how: "pipeline", proof: "table", palette: "mono", font: "mono" } },
    { id: "05", name: "Scroll story", short: "The answer over the IRS page it quotes; one question walks through the system as you scroll.", cfg: { hero: "split", features: "list", how: "story", proof: "cards", palette: "coverDark", font: "grotesk" } },
    { id: "06", name: "Editorial", short: "Paper and serif: the answer as a footnoted quote, one real run stepped through in a player.", cfg: { hero: "editorial", features: "list", how: "player", proof: "versus", palette: "coverPaper", font: "serif" } },
    { id: "07", name: "Simple: moving line", simple: 1, short: "One plain column, the way the demo started. A dot carries the question through the steps.", cfg: { palette: "demo", font: "system" } },
    { id: "08", name: "Simple: golden field", simple: 2, short: "One column on black. 3,973 dots, one per passage, narrow to one checked answer.", cfg: { palette: "mono", font: "grotesk" } },
    { id: "09", name: "Simple: step-through", simple: 3, short: "One column on paper. A player walks one real run through all six steps.", cfg: { palette: "paperRust", font: "serif" } },
  ];
  // what a first-time visitor sees (font "mono" -> "condensed", chosen 2026-11-14)
  const DEFAULT = { option: "01", palette: "coverPaper", font: "condensed" };

  const PALETTES = {
    coverDark: { name: "Golden hour on black", bg: "#070708", card: "#141416", card2: "#1b1b1e", line: "#26262c", tx: "#f3f3f5", mu: "#9a9aa3", a1: "#f4a83a", a2: "#ec8050", a3: "#d55c82", acc: "#f4a83a", on: "#111111", mark: "rgba(244,168,58,.28)" },
    coverTouch: { name: "Golden touch on black", bg: "#070708", card: "#141416", card2: "#1b1b1e", line: "#26262c", tx: "#f3f3f5", mu: "#9a9aa3", a1: "#f5a03a", a2: "#e9765e", a3: "#d9568a", acc: "#f5a03a", on: "#111111", mark: "rgba(245,160,58,.28)" },
    // acc #d9652f -> #b4471b and on #ffffff -> #111111 (2026-11-13): white on the gold button was 2.0:1, the accent as text 3.2:1
    coverPaper: { name: "Golden hour on paper", light: true, bg: "#f6f0e6", card: "#ffffff", card2: "#fbf7f0", line: "#e3d9c8", tx: "#111111", mu: "#4a4743", a1: "#f4a83a", a2: "#ec8050", a3: "#d55c82", acc: "#b4471b", on: "#111111", mark: "rgba(244,168,58,.35)" },
    coverInk: { name: "Golden hour, all ink", light: true, bg: "#ec8a4c", card: "rgba(10,10,10,.07)", card2: "rgba(10,10,10,.11)", line: "rgba(10,10,10,.18)", tx: "#0a0a0a", mu: "#3b2219", a1: "#0a0a0a", a2: "#2b1a12", a3: "#0a0a0a", acc: "#0a0a0a", on: "#f6f0e6", mark: "rgba(255,255,255,.45)" },
    mono: { name: "Mono + golden", bg: "#0b0b0c", card: "#131315", card2: "#1a1a1d", line: "#2a2a2f", tx: "#f4f4f5", mu: "#8d8d94", a1: "#f4a83a", a2: "#ec8050", a3: "#d55c82", acc: "#f4a83a", on: "#111111", mark: "rgba(244,168,58,.25)" },
    // a3 #1baf7a -> #0f7a55 (2026-11-13): white on the green end of the button gradient was 2.8:1
    demo: { name: "Live demo (blue)", light: true, bg: "#fcfcfb", card: "#ffffff", card2: "#f3f3f0", line: "#e1e0d9", tx: "#0b0b0b", mu: "#52514e", a1: "#2a78d6", a2: "#2457c5", a3: "#0f7a55", acc: "#2457c5", on: "#ffffff", mark: "#fff1b8" },
    // added 2026-11-13. Every palette here passes: text and muted text >= 4.5:1 on bg, accent >= 3:1, button text
    // >= 4.5:1 on each of a1-a3 (and on fill where a palette has its own button fill).
    demoDark: { name: "Live demo, dark", bg: "#1a1a19", card: "#1f1f1e", card2: "#232321", line: "#2c2c2a", tx: "#f0efec", mu: "#a9a89e", a1: "#7aa2ff", a2: "#3987e5", a3: "#199e70", acc: "#7aa2ff", on: "#0b0b0b", mark: "#5a4a10" },
    paperRust: { name: "Paper and rust", light: true, bg: "#f6f0e6", card: "#fffdf8", card2: "#efe7d9", line: "#e0d5c3", tx: "#1a1714", mu: "#4a4743", a1: "#b4471b", a2: "#a8501c", a3: "#8a6d12", acc: "#b4471b", on: "#ffffff", fill: "#1a1714", onFill: "#f6f0e6", mark: "#f7d27a" },
    ocean: { name: "Ocean night", bg: "#06121a", card: "#0c1c26", card2: "#112634", line: "#1d3444", tx: "#e9f3f7", mu: "#93acba", a1: "#4fd1c5", a2: "#38bdf8", a3: "#a78bfa", acc: "#4fd1c5", on: "#04222a", mark: "rgba(79,209,197,.26)" },
    lavender: { name: "Lavender dusk", bg: "#110e1b", card: "#19152a", card2: "#211c36", line: "#2e2746", tx: "#f1edfb", mu: "#a69fc2", a1: "#c4b5fd", a2: "#f0abfc", a3: "#fda4af", acc: "#c4b5fd", on: "#140f24", mark: "rgba(196,181,253,.24)" },
    lime: { name: "Graphite and lime", bg: "#0c0d0c", card: "#151715", card2: "#1c1f1c", line: "#2a2e2a", tx: "#f2f5f0", mu: "#9aa39a", a1: "#c6f432", a2: "#7ee081", a3: "#2dd4bf", acc: "#c6f432", on: "#10140a", mark: "rgba(198,244,50,.22)" },
    forest: { name: "Forest and brass", light: true, bg: "#f2f4ee", card: "#ffffff", card2: "#e9eee3", line: "#d5ddca", tx: "#13201a", mu: "#46564b", a1: "#2f7d4f", a2: "#4d7f2f", a3: "#8a6d12", acc: "#2f7d4f", on: "#ffffff", mark: "rgba(201,162,39,.32)" },
    sunrise: { name: "Sunrise", light: true, bg: "#fffaf3", card: "#ffffff", card2: "#fff1e0", line: "#f0dcc4", tx: "#1f140b", mu: "#6b5646", a1: "#f76707", a2: "#f0507a", a3: "#b56bd6", acc: "#c2410c", on: "#1f140b", mark: "rgba(247,103,7,.2)" },
    nordic: { name: "Nordic ice", light: true, bg: "#f4f7fb", card: "#ffffff", card2: "#e9eff7", line: "#d5dfeb", tx: "#0f1b2d", mu: "#48596f", a1: "#2563eb", a2: "#0e7490", a3: "#7c3aed", acc: "#1d4ed8", on: "#ffffff", mark: "#dbeafe" },
    cherry: { name: "Cherry ink", light: true, bg: "#fbf6f4", card: "#ffffff", card2: "#f5e9e5", line: "#e8d4cd", tx: "#1f0f0c", mu: "#6b4b43", a1: "#be123c", a2: "#c2410c", a3: "#7e22ce", acc: "#be123c", on: "#ffffff", mark: "rgba(190,18,60,.16)" },
  };

  // gf: the Google Fonts families each pairing needs (pages load only the chosen one); hw: heading weight
  const DMS = "DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700";
  const FONTS = {
    grotesk: { name: "Space Grotesk + DM Sans", head: "'Space Grotesk', system-ui, sans-serif", body: "'DM Sans', system-ui, sans-serif", gf: "Space+Grotesk:wght@500;600;700&family=" + DMS, hw: 700 },
    serif: { name: "Instrument Serif + DM Sans", head: "'Instrument Serif', Georgia, serif", body: "'DM Sans', system-ui, sans-serif", gf: "Instrument+Serif:ital@0;1&family=" + DMS, hw: 400 },
    mono: { name: "JetBrains Mono + DM Sans", head: "'JetBrains Mono', ui-monospace, monospace", body: "'DM Sans', system-ui, sans-serif", gf: "JetBrains+Mono:wght@400;500;700&family=" + DMS, hw: 700 },
    condensed: { name: "Barlow Condensed caps + DM Sans", head: "'Barlow Condensed', 'Bahnschrift Condensed', sans-serif", body: "'DM Sans', system-ui, sans-serif", caps: true, gf: "Barlow+Condensed:wght@700;800&family=" + DMS, hw: 800 },
    system: { name: "System UI (the live page)", head: "system-ui, -apple-system, 'Segoe UI', sans-serif", body: "system-ui, -apple-system, 'Segoe UI', sans-serif", gf: "", hw: 700 },
    inter: { name: "Inter", head: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", gf: "Inter:wght@400;500;600;700;800", hw: 700 },
    sora: { name: "Sora + Manrope", head: "'Sora', system-ui, sans-serif", body: "'Manrope', system-ui, sans-serif", gf: "Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700", hw: 700 },
    plex: { name: "IBM Plex Sans", head: "'IBM Plex Sans', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif", gf: "IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500", hw: 600 },
    fraunces: { name: "Fraunces + Inter", head: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif", gf: "Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600", hw: 600 },
    playfair: { name: "Playfair Display + Source Sans 3", head: "'Playfair Display', Georgia, serif", body: "'Source Sans 3', system-ui, sans-serif", gf: "Playfair+Display:wght@500;600;700&family=Source+Sans+3:wght@400;500;600;700", hw: 600 },
  };

  window.STUDIO = { OPTIONS, PALETTES, FONTS, DEFAULT };
})();
