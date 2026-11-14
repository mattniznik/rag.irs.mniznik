// "How it was built": the loop every change goes through, rendered from RAG.engineering (written by
// scripts/export_site.py from the test tools' own listings and the decision records, so no number here is typed
// in). One renderer for both layout families: studio/loader.js calls WORKFLOW.insert() after the layout is up,
// and the section goes in just before the layout's footer.
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function html(e) {
    const steps = e.steps.map((s, i) => `<li class="wf-step" style="--i:${i}">
        <span class="wf-n" aria-hidden="true">${i + 1}</span>
        <div class="wf-body"><h3 class="wf-t">${esc(s.title)}</h3><p class="wf-x">${esc(s.text)}</p>
          <a class="wf-fact" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.fact)} <span aria-hidden="true">↗</span></a></div>
      </li>`).join("");
    const links = e.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");
    return `<section class="wf" id="built" aria-labelledby="wf-h"><div class="wf-wrap">
      <p class="wf-eyebrow">How it was built</p>
      <h2 class="wf-h" id="wf-h">Every change goes through the same loop.</h2>
      <p class="wf-lede">Each step links to the real thing on GitHub: the sources, the decisions, the tests that failed first,
        the checks on the live site. The numbers are counted from the repository when the page is built.</p>
      <div class="wf-track" aria-hidden="true"><i></i></div>
      <ol class="wf-steps">${steps}</ol>
      <div class="wf-foot"><a class="wf-badge" href="${esc(e.repo)}/actions/workflows/ci.yml" target="_blank" rel="noopener"><img src="${esc(e.badge)}" alt="CI status on GitHub" height="20"></a>${links}</div>
    </div></section>`;
  }

  // the steps light up one after another the first time the section scrolls into view
  function animate(section) {
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!motion || !("IntersectionObserver" in window)) { section.classList.add("in"); return; }
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { section.classList.add("in"); io.disconnect(); } }), { threshold: 0.2 });
    io.observe(section);
  }

  function insert() {
    const e = window.RAG && window.RAG.engineering;
    const app = document.getElementById("app"), footer = app && app.querySelector("footer");
    if (!e || !footer) return;
    footer.insertAdjacentHTML("beforebegin", html(e));
    const section = document.getElementById("built");
    if (footer.closest("main")) section.classList.add("wf-in-main"); // a one-column layout: inside its column
    animate(section);
  }

  window.WORKFLOW = { insert };
})();
