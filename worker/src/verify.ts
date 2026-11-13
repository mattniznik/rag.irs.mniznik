// Port of src/cite_or_abstain/answer.py: parse the model's JSON and verify every citation before
// anything is shown. eval/verify_cases.json pins this to the Python behaviour.
import { MAX_QUOTE_WORDS, MIN_QUOTE_WORDS } from "./generated";
import { forMatch } from "./text";

export interface Passage { id: string; doc: string; year: number; page: number; section: string; kind: string; text: string }
export interface Citation { passage_id: string; quote: string }
export interface Verdict { status: "answered" | "not_found" | "unverified"; answer: string; citations: Citation[]; problems: string[] }

export function parse(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  for (const candidate of [text, start >= 0 && end > start ? text.slice(start, end + 1) : ""]) {
    if (!candidate) continue;
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const STRIP_QUOTE = /^[\s"'‘’“”.…]+|[\s"'‘’“”…]+$/g;

export function verify(reply: Record<string, unknown> | null, passages: Pick<Passage, "id" | "text">[]): Verdict {
  if (reply === null) return { status: "unverified", answer: "", citations: [], problems: ["reply was not JSON"] };
  const raw = String(reply.status ?? "").trim().toLowerCase();
  if (raw === "not_found") return { status: "not_found", answer: "", citations: [], problems: [] };
  if (raw !== "answered") return { status: "unverified", answer: "", citations: [], problems: [`unknown status '${raw}'`] };
  const answer = String(reply.answer ?? "").trim();
  const cites = Array.isArray(reply.citations) ? reply.citations : [];
  const byId = new Map(passages.map((p) => [p.id, forMatch(p.text)]));
  const problems: string[] = [];
  const valid: Citation[] = [];
  cites.forEach((c, i) => {
    const cite = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const number = String(cite.passage ?? "").trim().replace(/^\[|\]$/g, "");
    let pid: string;
    if (/^\d+$/.test(number) && Number(number) >= 1 && Number(number) <= passages.length) {
      pid = passages[Number(number) - 1].id;
    } else {
      pid = String(cite.passage_id ?? `#${number}`).trim().replace(/^\[|\]$/g, "");
    }
    const quote = String(cite.quote ?? "").replace(STRIP_QUOTE, "");
    const n = quote.split(/\s+/).filter(Boolean).length;
    const text = byId.get(pid);
    if (text === undefined) problems.push(`citation ${i}: passage '${pid}' was not given`);
    else if (n < MIN_QUOTE_WORDS || n > MAX_QUOTE_WORDS) problems.push(`citation ${i}: quote has ${n} words`);
    else if (!text.includes(forMatch(quote))) problems.push(`citation ${i}: quote is not in passage ${pid}`);
    else valid.push({ passage_id: pid, quote });
  });
  if (!answer) problems.push("empty answer");
  if (cites.length === 0) problems.push("no citations");
  return { status: problems.length ? "unverified" : "answered", answer, citations: valid, problems };
}

export interface CitationCheck { passage: string | null; quote: string; ok: boolean; problem: string | null }

/** Every citation the model wrote, with the check's verdict on it, for the demo's "how this answer
 *  was made" view. Reads the per-citation problems verify() already produced, so the two never
 *  disagree. scripts/export_site.py builds the same shape for recorded examples. */
export function citationChecks(reply: Record<string, unknown> | null, problems: string[]): CitationCheck[] {
  // verify() checks citations only on an "answered" reply; anything else has nothing to report.
  if (!reply || String(reply.status ?? "").trim().toLowerCase() !== "answered") return [];
  const cites = Array.isArray(reply.citations) ? reply.citations : [];
  return cites.map((c, i) => {
    const cite = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const found = problems.find((p) => p.startsWith(`citation ${i}: `));
    const passage = cite.passage ?? cite.passage_id;
    return {
      passage: passage === undefined || passage === null ? null : String(passage),
      quote: String(cite.quote ?? ""),
      ok: !found,
      problem: found ? found.slice(`citation ${i}: `.length) : null,
    };
  });
}
