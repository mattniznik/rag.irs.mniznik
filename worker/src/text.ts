// Port of src/cite_or_abstain/text.py (for_match) and keyword_index.py (to_query).
// Behaviour is pinned by eval/verify_cases.json, which the Python tests also run.
import { STOPWORDS } from "./generated";

const QUOTES: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "‑": "-", " ": " ",
};
const QUOTE_CHARS = /[‘’“”–—‑ ]/g;
const LAYOUT = /[|*]|\.\.\.|…/g;

/** Normalize for comparing a quote with a passage: quote marks, dashes, spacing, case, and purely
 *  visual characters (table pipes, footnote asterisks, dot leaders). Word order still has to match. */
export function forMatch(text: string): string {
  return text.replace(QUOTE_CHARS, (c) => QUOTES[c]).replace(LAYOUT, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

const TOKEN = /[a-z0-9]+(?:[.,][0-9]+)*/g;

/** A free-text question as an FTS5 OR-query of quoted terms, stopwords and repeats removed. */
export function toQuery(question: string): string {
  const seen: string[] = [];
  for (const t of question.toLowerCase().match(TOKEN) ?? []) {
    if (!STOPWORDS.has(t) && !seen.includes(t)) seen.push(t);
  }
  return seen.map((t) => `"${t}"`).join(" OR ");
}
