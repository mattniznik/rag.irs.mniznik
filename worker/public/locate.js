// Find where a verified quote sits in its passage, so the page can highlight it.
// The check compares normalized text (src/text.ts forMatch); this builds the same normalized text
// while remembering which original character each normalized character came from.
// test/locate.test.ts pins normalize(x).text to forMatch(x).

const SAME = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "‑": "-", " ": " " };
const STRIP_QUOTE = /^[\s"'‘’“”.…]+|[\s"'‘’“”…]+$/g;

/** forMatch(text), plus map[k] = index in `text` of normalized character k. */
export function normalize(text) {
  let out = "";
  const map = [];
  const push = (ch, at) => {
    if (/\s/.test(ch)) {
      if (out.length === 0 || out[out.length - 1] === " ") return;
      out += " ";
      map.push(at);
      return;
    }
    for (const low of ch.toLowerCase()) {
      out += low;
      map.push(at);
    }
  };
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("...", i)) { push(" ", i); i += 3; continue; }
    const c = SAME[text[i]] ?? text[i];
    push(c === "|" || c === "*" || c === "…" ? " " : c, i);
    i += 1;
  }
  if (out.endsWith(" ")) { out = out.slice(0, -1); map.pop(); }
  return { text: out, map };
}

/** [start, end) of `quote` inside `passage` in original characters, or null if it is not there. */
export function locate(passage, quote) {
  const q = normalize(String(quote).replace(STRIP_QUOTE, "")).text;
  if (!q) return null;
  const p = normalize(passage);
  const at = p.text.indexOf(q);
  if (at < 0) return null;
  return [p.map[at], p.map[at + q.length - 1] + 1];
}
