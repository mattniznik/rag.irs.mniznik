// Shows the visitor's layout: resolves the choice (a ?layout= link, their saved pick, or the default), loads only
// that layout's styles and scripts, renders it into #app, then adds the Studio. index.html keeps the page invisible
// (html.boot) until this is done, so nobody sees a half-styled page.
import { STORAGE_KEY, configFor, parseSaved, resolveChoice } from "./choice.js";

const S = window.STUDIO;
// /api/ask answers only on the live site; anywhere else the ask boxes replay recorded runs
window.RAG_LIVE = location.hostname === "rag.irs.mniznik.com" || window.RAG_LIVE === true;

let saved = null;
try { saved = parseSaved(localStorage.getItem(STORAGE_KEY)); } catch { /* storage blocked: show the default */ }
const choice = resolveChoice({ query: location.search, saved, presets: S, fallback: S.DEFAULT });
const cfg = configFor(choice, S);
window.SITE = { choice, cfg, STORAGE_KEY };

const css = (href) => new Promise((done) => {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
  l.onload = l.onerror = () => done(); document.head.append(l);
});
const js = (src) => new Promise((done, fail) => {
  const s = document.createElement("script"); s.src = src;
  s.onload = () => done(); s.onerror = () => fail(new Error("could not load " + src)); document.body.append(s);
});

// type: the chosen pairing plus the mono face every layout uses for labels; not waited for (display=swap)
const fam = new Map();
for (const spec of [...(S.FONTS[cfg.font].gf || "").split("&family=").filter(Boolean), "JetBrains+Mono:wght@400;500;700"]) {
  const name = spec.split(":")[0];
  if (!fam.has(name)) fam.set(name, spec);
}
css("https://fonts.googleapis.com/css2?" + [...fam.values()].map((s) => "family=" + s).join("&") + "&display=swap");

const sheets = [css("/studio/panel.css"), css("/shared/workflow.css"),
  ...(cfg.simple ? [css("/simple/base.css"), css(`/simple/s${cfg.simple}.css`)] : [css("/rich/page.css")])];
const app = document.getElementById("app");
try {
  const [data, loc, main] = await Promise.all([
    fetch("/site-data.json").then((r) => r.json()),
    import("/locate.js"),
    // no ".html": Workers static assets answer /x.html with a 307 to /x, so ask for /x and skip the hop
    cfg.simple ? fetch(`/simple/main${cfg.simple}`).then((r) => r.text()) : null,
    ...sheets,
  ]);
  window.RAG = data;
  window.locate = loc.locate;
  if (cfg.simple) {
    app.innerHTML = main + '<div class="tip" id="tip" hidden></div>';
    await js("/simple/theme.js");
    window.applyTheme(cfg);
    await js(`/simple/s${cfg.simple}.js`);
    await js("/simple/report.js");
  } else {
    await js("/rich/flows.js");
    await js("/rich/sections.js");
    await js("/rich/render.js");
    window.renderRich(cfg);
  }
  await js("/shared/workflow.js"); // "How it was built", before the layout's footer
  window.WORKFLOW.insert();
  await js("/studio/panel.js");
  window.STUDIO_PANEL.mount();
} catch (e) {
  app.innerHTML = '<p style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px">The page did not load. Reload to try again, or read the code on <a href="https://github.com/mattniznik/rag.irs.mniznik">GitHub</a>.</p>';
  console.error(e);
} finally {
  document.documentElement.classList.remove("boot");
}
