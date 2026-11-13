import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forMatch, toQuery } from "../src/text";
import { verify } from "../src/verify";

const fixtures = JSON.parse(readFileSync(new URL("../../eval/verify_cases.json", import.meta.url), "utf8"));

describe("citation check matches the Python implementation", () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      expect(verify(c.reply, fixtures.passages).status).toBe(c.expected);
    });
  }
});

describe("text helpers", () => {
  it("forMatch ignores quote style, dashes, pipes and dot leaders but keeps word order", () => {
    expect(forMatch("| Married filing jointly — 27,700 ...")).toBe("married filing jointly - 27,700");
    expect(forMatch("What’s  New")).toBe("what's new");
  });
  it("toQuery drops stopwords and repeats and keeps comma numbers", () => {
    expect(toQuery("Can I deduct my home office? Home office!")).toBe('"deduct" OR "home" OR "office"');
    expect(toQuery("Is it 15,750?")).toBe('"15,750"');
  });
});
