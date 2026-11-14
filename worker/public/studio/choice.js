// Which layout, colours and type a visitor sees. Pure: the caller passes what it read from the URL and storage.
// Order: a ?layout= link (shown, not saved) > the visitor's saved pick > the site default.
export const STORAGE_KEY = "rag-site-choice";

export function resolveChoice({ query = "", saved = null, presets, fallback }) {
  const { OPTIONS, PALETTES, FONTS } = presets;
  const pick = (src) => {
    const o = src && OPTIONS.find((x) => x.id === src.option);
    if (!o) return null;
    return { option: o.id, palette: PALETTES[src.palette] ? src.palette : o.cfg.palette, font: FONTS[src.font] ? src.font : o.cfg.font };
  };
  const q = new URLSearchParams(query);
  const fromLink = q.get("layout") ? pick({ option: q.get("layout"), palette: q.get("palette"), font: q.get("font") }) : null;
  if (fromLink) return { ...fromLink, source: "link" };
  const fromSaved = pick(saved);
  if (fromSaved) return { ...fromSaved, source: "saved" };
  return { ...(pick(fallback) || pick({ option: OPTIONS[0].id })), source: "default" };
}

/** The render config: the layout's own sections, then the chosen colours and type. */
export function configFor(choice, presets) {
  const o = presets.OPTIONS.find((x) => x.id === choice.option);
  return { ...o.cfg, option: o.id, palette: choice.palette, font: choice.font, simple: o.simple || null };
}

/** Storage can hold anything (an older version, another tab, a hand edit): only an object counts. */
export function parseSaved(raw) {
  if (typeof raw !== "string") return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}
