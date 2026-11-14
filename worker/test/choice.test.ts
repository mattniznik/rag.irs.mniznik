import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module served to the browser
import { configFor, parseSaved, resolveChoice } from "../public/studio/choice.js";

// the real presets the page loads (a classic script that sets window.STUDIO)
const sandbox: { window: Record<string, any> } = { window: {} };
runInNewContext(readFileSync(new URL("../public/presets.js", import.meta.url), "utf8"), sandbox);
const presets = sandbox.window.STUDIO;

describe("presets the page ships", () => {
  it("has a default that points at a real layout, colour set and typeface", () => {
    const d = presets.DEFAULT;
    expect(presets.OPTIONS.map((o: any) => o.id)).toContain(d.option);
    expect(presets.PALETTES[d.palette]).toBeTruthy();
    expect(presets.FONTS[d.font]).toBeTruthy();
  });
  it("opens a first visit on the look Mat picked: Ask anything, Golden hour on paper, Barlow Condensed caps", () => {
    expect(presets.DEFAULT).toEqual({ option: "01", palette: "coverPaper", font: "condensed" });
  });
  it("gives every layout colours and type that exist", () => {
    for (const o of presets.OPTIONS) {
      expect(presets.PALETTES[o.cfg.palette], o.id).toBeTruthy();
      expect(presets.FONTS[o.cfg.font], o.id).toBeTruthy();
    }
  });
});

describe("resolveChoice: which layout a visitor sees", () => {
  const fallback = { option: "01", palette: "coverPaper", font: "mono" };
  it("shows the site default to a first-time visitor", () => {
    const c = resolveChoice({ query: "", saved: null, presets, fallback });
    expect(c).toEqual({ option: "01", palette: "coverPaper", font: "mono", source: "default" });
  });
  it("shows the visitor's saved pick", () => {
    const c = resolveChoice({ query: "", saved: { option: "08", palette: "ocean", font: "inter" }, presets, fallback });
    expect(c).toEqual({ option: "08", palette: "ocean", font: "inter", source: "saved" });
  });
  it("lets a ?layout= link win over the saved pick, with that layout's own colours", () => {
    const c = resolveChoice({ query: "?layout=09", saved: { option: "08", palette: "ocean", font: "inter" }, presets, fallback });
    expect(c.option).toBe("09");
    expect(c.source).toBe("link");
    const own = presets.OPTIONS.find((o: any) => o.id === "09").cfg;
    expect([c.palette, c.font]).toEqual([own.palette, own.font]);
  });
  it("ignores a link to a layout that no longer exists (the old ?layout=report)", () => {
    const c = resolveChoice({ query: "?layout=report", saved: { option: "05", palette: "lime", font: "sora" }, presets, fallback });
    expect([c.option, c.source]).toEqual(["05", "saved"]);
  });
  it("drops a saved pick of a removed layout and falls back to the default", () => {
    const c = resolveChoice({ query: "", saved: { option: "02", palette: "ocean", font: "inter" }, presets, fallback });
    expect([c.option, c.source]).toEqual(["01", "default"]);
  });
  it("keeps the saved layout but repairs colours or type that no longer exist", () => {
    const c = resolveChoice({ query: "", saved: { option: "04", palette: "gone", font: "gone" }, presets, fallback });
    const own = presets.OPTIONS.find((o: any) => o.id === "04").cfg;
    expect(c).toEqual({ option: "04", palette: own.palette, font: own.font, source: "saved" });
  });
});

describe("configFor and parseSaved", () => {
  it("builds the render config from the layout's sections plus the chosen colours and type", () => {
    const cfg = configFor({ option: "01", palette: "ocean", font: "inter" }, presets);
    expect(cfg).toMatchObject({ option: "01", palette: "ocean", font: "inter", hero: "search", simple: null });
    expect(configFor({ option: "08", palette: "mono", font: "grotesk" }, presets).simple).toBe(2);
  });
  it("reads storage defensively", () => {
    expect(parseSaved('{"option":"05"}')).toEqual({ option: "05" });
    expect(parseSaved("not json")).toBeNull();
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved("42")).toBeNull();
  });
});
