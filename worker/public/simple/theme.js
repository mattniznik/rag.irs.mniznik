// Dresses a simple layout in the visitor's colours and type: sets the layout's CSS variables from the palettes and
// typefaces in /presets.js. studio/loader.js calls window.applyTheme(cfg) before the layout's scripts run, so the
// animations read the final colours.
(function () {
  "use strict";
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const textOn = (bg) => (/^#[0-9a-f]{6}$/i.test(bg) && cr("#111111", bg) > cr("#ffffff", bg) ? "#111111" : "#ffffff");

  window.applyTheme = function (cfg) {
    const P = window.STUDIO.PALETTES[cfg.palette], F = window.STUDIO.FONTS[cfg.font];
    const root = document.documentElement, set = (k, v) => root.style.setProperty(k, v);
    if (P) {
      root.style.colorScheme = P.light ? "light" : "dark";
      set("--bg", P.bg); set("--fg", P.tx); set("--muted", P.mu); set("--ink2", `color-mix(in srgb, ${P.tx} 30%, ${P.mu})`);
      set("--line", P.line); set("--soft", P.card2); set("--card", P.card); set("--field", P.card);
      set("--accent", P.acc); set("--on-acc", textOn(P.acc)); set("--mark", P.mark);
      set("--accent-fill", P.fill || P.acc); set("--on-accent", P.fill ? P.onFill : textOn(P.acc));
      set("--ring-1", P.a1); set("--ring-2", P.a2); set("--ring-3", P.a3); set("--on-grad", P.on);
      set("--num-bg", P.tx); set("--num-fg", P.bg); set("--c-bar", P.a1);
      // chart colours stay the colour-blind-checked sets, light or dark to match the palette
      const ch = P.light ? ["#2a78d6", "#eda100", "#1baf7a", "#eb6834"] : ["#3987e5", "#c98500", "#199e70", "#d95926"];
      ["--c-correct", "--c-partial", "--c-held", "--c-wrong"].forEach((k, i) => set(k, ch[i]));
      set("--ok", P.light ? "#1f6b2a" : "#3fbf7f"); set("--bad", P.light ? "#b42b2b" : "#ef7a6a");
    }
    if (F) {
      set("--font-head", F.head); set("--font-body", F.body); set("--h1-weight", F.hw); set("--h2-weight", F.hw);
      document.body.classList.toggle("caps", !!F.caps);
    }
  };
})();
