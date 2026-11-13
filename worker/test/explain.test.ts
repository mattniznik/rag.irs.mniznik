import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module shared with the browser page
import { locate, normalize } from "../public/locate.js";
import { fuse } from "../src/fuse";
import { forMatch } from "../src/text";
import { citationChecks, verify } from "../src/verify";

const fixtures = JSON.parse(readFileSync(new URL("../../eval/verify_cases.json", import.meta.url), "utf8"));

describe("locate: the page's highlighter agrees with the citation check", () => {
  const samples: string[] = [
    ...fixtures.passages.map((p: { text: string }) => p.text),
    "| Married filing jointly — 27,700 ...",
    "  What’s  New for 2025…  ",
    "Line 1.... 12 | **Note**: “Exempt” individuals",
  ];
  for (const [i, s] of samples.entries()) {
    it(`normalize(text).text equals forMatch(text), sample ${i}`, () => {
      expect(normalize(s).text).toBe(forMatch(s));
    });
  }

  it("finds a quote across table pipes and curly quotes and returns original offsets", () => {
    const passage = "Filing status | Amount\nMarried filing jointly | $31,500\nHe said “not exempt” here.";
    const [s, e] = locate(passage, "married filing jointly $31,500");
    expect(passage.slice(s, e)).toBe("Married filing jointly | $31,500");
    const [s2, e2] = locate(passage, '"not exempt"');
    expect(passage.slice(s2, e2)).toBe("not exempt");
  });

  it("returns null for text that is not in the passage", () => {
    expect(locate("The standard deduction is $15,750.", "The standard deduction is $16,000")).toBeNull();
    expect(locate("anything", "  ")).toBeNull();
  });
});

describe("fuse: reciprocal rank fusion with the ranks the page shows", () => {
  it("adds both lists, keeps 1-based ranks, and breaks ties keyword-first like Python", () => {
    const r = fuse(["a", "b"], ["b", "c"], 3, 60);
    expect(r.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(r[0]).toMatchObject({ id: "b", kw: 2, vec: 1 });
    expect(r[1]).toMatchObject({ id: "a", kw: 1, vec: null });
    expect(r[2]).toMatchObject({ id: "c", kw: null, vec: 2 });
    expect(r[0].fused).toBeCloseTo(1 / 62 + 1 / 61, 12);
  });
  it("keeps only the best k", () => {
    expect(fuse(["a", "b", "c"], [], 2, 60).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("citationChecks: one row per citation, matching verify()", () => {
  const passages = [
    { id: "p1", text: "The area you use to figure your deduction is limited to 300 square feet." },
    { id: "p2", text: "You can deduct daily transportation costs between your home and another work location." },
  ];
  it("marks the good quote ok and carries the reason for the bad one", () => {
    const reply = { status: "answered", answer: "300 square feet.", citations: [
      { passage: 1, quote: "limited to 300 square feet" },
      { passage: 1, quote: "daily transportation costs between your home" },
    ] };
    const v = verify(reply, passages);
    const rows = citationChecks(reply, v.problems);
    expect(v.status).toBe("unverified");
    expect(rows[0]).toEqual({ passage: "1", quote: "limited to 300 square feet", ok: true, problem: null });
    expect(rows[1].ok).toBe(false);
    expect(rows[1].problem).toBe("quote is not in passage p1");
  });
  it("reports nothing for a reply that did not claim an answer", () => {
    const reply = { status: "not_found", answer: "", citations: [{ passage: 1, quote: "limited to 300 square feet" }] };
    expect(citationChecks(reply, verify(reply, passages).problems)).toEqual([]);
    expect(citationChecks(null, ["reply was not JSON"])).toEqual([]);
  });
});
