// The Studio: a visitor picks a layout, a colour set and a typeface. The pick is saved in this browser
// (localStorage, read by studio/loader.js) and shown on every later visit. Each pick reloads the page into it,
// and the panel opens again where it was. On a section-built layout the button sits in the nav; on the simple
// layouts it floats. On a phone the panel is a bottom sheet.
(function () {
  "use strict";
  const S = window.STUDIO, SITE = window.SITE, KEY = SITE.STORAGE_KEY, REOPEN = "rag-studio-reopen";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cur = SITE.choice;
  let panel, backdrop, opener = null, fontsIn = false;

  const sw = (p) => `<span class="sp-sw" aria-hidden="true"><i style="background:${p.bg}"></i><i style="background:${p.a1}"></i><i style="background:${p.a2}"></i><i style="background:${p.a3}"></i></span>`;
  const icon = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 0 0 16c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.8-.5-1.2-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6h1.8A3.7 3.7 0 0 0 18 8.8C18 5 14.4 2 10 2Zm-4.5 8a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm2.3-3.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm2.3 3.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"/></svg>';
  const status = { saved: "Saved in this browser. You will see this look next time.", link: "Shown from a link, not saved. Pick anything to keep a look.", default: "This is the default look. Pick anything to save your own." }[cur.source];

  function html() {
    const o = S.OPTIONS.find((x) => x.id === cur.option), P = S.PALETTES[cur.palette], F = S.FONTS[cur.font];
    const lay = (x) => `<button type="button" class="sp-lay${x.id === cur.option ? " on" : ""}" data-o="${x.id}" aria-pressed="${x.id === cur.option}">${sw(S.PALETTES[x.cfg.palette])}<b>${esc(x.name)}</b><small>${esc(x.short)}</small></button>`;
    const pal = ([k, p]) => `<button type="button" class="sp-pal${k === cur.palette ? " on" : ""}" data-p="${k}" title="${esc(p.name)}" aria-label="${esc(p.name)}" aria-pressed="${k === cur.palette}">${sw(p)}</button>`;
    const ent = Object.entries(S.PALETTES);
    return `<div class="sp-head"><div><div class="sp-title" id="sp-title">Studio</div><div class="sp-sub">Make this page yours</div></div><button type="button" class="sp-x" aria-label="Close the studio">&times;</button></div>
      <div class="sp-body">
        <p class="sp-info">This page comes in ${S.OPTIONS.length} layouts, ${ent.length} colour sets and ${Object.keys(S.FONTS).length} typefaces. The answers and the numbers are the same in all of them. Pick the look you like best: it is saved in this browser and shown next time you come back.</p>
        <div class="sp-h">Layout</div><div class="sp-group">${S.OPTIONS.filter((x) => !x.simple).map(lay).join("")}</div>
        <div class="sp-h sp-h2">One-column layouts</div><div class="sp-group">${S.OPTIONS.filter((x) => x.simple).map(lay).join("")}</div>
        <div class="sp-h">Colours <span>${esc(P.name)}</span></div>
        <div class="sp-pals"><span class="sp-k">Dark</span>${ent.filter(([, p]) => !p.light).map(pal).join("")}</div>
        <div class="sp-pals"><span class="sp-k">Light</span>${ent.filter(([, p]) => p.light).map(pal).join("")}</div>
        <div class="sp-h">Type <span>${esc(F.name)}</span></div>
        <div class="sp-fonts">${Object.entries(S.FONTS).map(([k, f]) => `<button type="button" class="sp-font${k === cur.font ? " on" : ""}" data-f="${k}" aria-pressed="${k === cur.font}"><span style="font-family:${esc(f.head)};font-weight:${f.hw || 700}${f.caps ? ";text-transform:uppercase" : ""}">Tax answers you can check</span><small>${esc(f.name)}</small></button>`).join("")}</div>
      </div>
      <div class="sp-foot"><p class="sp-status">${esc(status)}<br><b>${esc(o.name)}</b> · ${esc(P.name)} · ${esc(F.name)}</p><button type="button" class="sp-reset"${cur.source === "default" ? " disabled" : ""}>Back to the default</button></div>`;
  }

  // a pick: save it, then reload into it (a ?layout= link is dropped so the saved pick shows)
  function go(next, keepScroll) {
    if (next) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: the pick shows once */ } }
    else { try { localStorage.removeItem(KEY); } catch { /* nothing saved */ } }
    try { sessionStorage.setItem(REOPEN, JSON.stringify({ y: keepScroll ? scrollY : 0, body: panel.querySelector(".sp-body").scrollTop })); } catch { /* no reopen */ }
    const u = new URL(location.href);
    ["layout", "palette", "font"].forEach((k) => u.searchParams.delete(k));
    const target = u.pathname + u.search;
    if (target === location.pathname + location.search) location.reload(); else location.replace(target);
  }

  function open(fromBtn) {
    opener = fromBtn || document.activeElement;
    if (!fontsIn) { // every typeface's face, once, so each Type button shows itself
      fontsIn = true;
      const fam = new Map();
      for (const f of Object.values(S.FONTS)) for (const spec of (f.gf || "").split("&family=").filter(Boolean)) { const n = spec.split(":")[0]; if (!fam.has(n)) fam.set(n, spec); }
      const l = document.createElement("link"); l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?" + [...fam.values()].map((s) => "family=" + s).join("&") + "&display=swap";
      document.head.append(l);
    }
    document.documentElement.classList.add("sp-open");
    panel.setAttribute("aria-hidden", "false");
    panel.querySelector(".sp-x").focus({ preventScroll: true });
  }
  function close() {
    document.documentElement.classList.remove("sp-open");
    panel.setAttribute("aria-hidden", "true");
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  function mount() {
    backdrop = document.createElement("div"); backdrop.className = "sp-backdrop";
    panel = document.createElement("div"); panel.className = "sp-panel";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "sp-title"); panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = html();
    document.body.append(backdrop, panel);

    // the button: in the nav of a section-built layout, floating on a simple one
    const btn = document.createElement("button");
    btn.type = "button"; btn.innerHTML = `${icon}<span>Studio</span>`; btn.setAttribute("aria-haspopup", "dialog");
    btn.title = "Change the layout, colours and type";
    const navLinks = document.querySelector(".nav .wrap .links");
    if (navLinks) { btn.className = "sp-btn sp-nav"; navLinks.before(btn); } else { btn.className = "sp-btn sp-fab"; document.body.append(btn); }
    btn.addEventListener("click", () => open(btn));

    backdrop.addEventListener("click", close);
    panel.querySelector(".sp-x").addEventListener("click", close);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return; // keep the focus inside the panel while it is open
      const f = [...panel.querySelectorAll("button:not([disabled])")], first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // a new layout comes with its own colours and type; colours and type change only themselves
    panel.querySelectorAll("[data-o]").forEach((b) => b.addEventListener("click", () => {
      const o = S.OPTIONS.find((x) => x.id === b.dataset.o);
      if (o.id === cur.option) { if (cur.source !== "saved") go({ option: cur.option, palette: cur.palette, font: cur.font }, true); return; } // keep the look on screen
      go({ option: o.id, palette: o.cfg.palette, font: o.cfg.font }, false);
    }));
    panel.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => go({ option: cur.option, palette: b.dataset.p, font: cur.font }, true)));
    panel.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => go({ option: cur.option, palette: cur.palette, font: b.dataset.f }, true)));
    panel.querySelector(".sp-reset").addEventListener("click", () => go(null, false));

    // after a pick the page reloads: open the panel again, at the same place
    let back = null;
    try { back = JSON.parse(sessionStorage.getItem(REOPEN)); sessionStorage.removeItem(REOPEN); } catch { /* none */ }
    if (back) {
      if (back.y) requestAnimationFrame(() => window.scrollTo(0, back.y));
      open(btn);
      panel.querySelector(".sp-body").scrollTop = back.body || 0;
    }
  }

  window.STUDIO_PANEL = { mount, open, close };
})();
