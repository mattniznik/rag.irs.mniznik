// Renders a section-built layout into #app from its config: the hero, the promises, how it works and the proof
// (rich/sections.js), in the visitor's colours and type. studio/loader.js calls window.renderRich(cfg) once.
(function () {
  "use strict";
  window.renderRich = function (c) {
    const S = window.STUDIO, L = window.SECTIONS_R;
    const pal = S.PALETTES[c.palette], font = S.FONTS[c.font];
    const root = document.documentElement, r = root.style;
    for (const k of ["bg", "card", "card2", "line", "tx", "mu", "a1", "a2", "a3", "acc", "on", "mark"]) r.setProperty("--" + k, pal[k]);
    r.setProperty("--fh", font.head); r.setProperty("--fb", font.body);
    r.colorScheme = pal.light ? "light" : "dark";
    document.body.className = [pal.light ? "light" : "", c.font === "serif" ? "serif" : "", c.font === "mono" ? "mono-font" : "", font.caps ? "caps" : ""].filter(Boolean).join(" ");
    const parts = [["hero", L.hero], ["features", L.features], ["how", L.how], ["proof", L.proof]];
    const page = document.getElementById("app");
    page.innerHTML = L.nav() + parts.map(([k, lib]) => `<div data-slot="${k}">${(lib[c[k]] || Object.values(lib)[0]).html()}</div>`).join("") + L.footer();
    for (const [k, lib] of parts) { const v = lib[c[k]] || Object.values(lib)[0]; if (v.mount) v.mount(page.querySelector(`[data-slot="${k}"]`), window); }

    // the results' bars and dots grow the first time they scroll into view
    const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.toggle("motion", motion);
    const pr = page.querySelector("#proof");
    if (pr && (!motion || !("IntersectionObserver" in window))) pr.classList.add("in");
    else if (pr) { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { pr.classList.add("in"); io.disconnect(); } }), { threshold: 0.2 }); io.observe(pr); }

    // "Ask a question" in the nav and the footer: bring the hero's ask box into view and put the cursor in it
    page.querySelectorAll("[data-ask-jump]").forEach((a) => a.addEventListener("click", (e) => {
      const input = page.querySelector("[data-ask] input");
      if (!input) return;
      e.preventDefault();
      input.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "center" });
      input.focus({ preventScroll: true });
    }));
  };
})();
