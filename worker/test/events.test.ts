import { describe, expect, it } from "vitest";
import { askPoint, BLOBS, parseEvent, parseUA } from "../src/events";

// What the Worker adds itself: where Cloudflare places the IP (country, region, city, coordinates), the network
// owner, the browser's User-Agent header, and the day's salted IP hash (the same key as `usage`).
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const server = {
  country: "US", region: "Texas", city: "Austin", lat: "30.2672", lon: "-97.7431", org: "Google LLC", ua: CHROME_WIN, visitor: "a1b2c3d4",
};
const AUSTIN = [30.3, -97.7]; // the coordinates, to one decimal (about 11 km)
const ev = (o: Record<string, unknown>) => JSON.stringify(o);
const blob = (p: { blobs: string[] } | null, name: (typeof BLOBS)[number]) => p!.blobs[BLOBS.indexOf(name)];
const d = (p: { doubles: number[] } | null) => p!.doubles;

describe("parseEvent: what the page may record", () => {
  it("turns a view into one data point: 20 blobs in a fixed order, 8 doubles, keyed by the day's visitor", () => {
    const p = parseEvent(ev({
      t: "view", layout: "05", palette: "coverDark", font: "grotesk", how: "link", src: "k7f2", ref: "www.linkedin.com", size: "phone",
      pv: "k3j9x0aa", vid: "abcdef123456", setup: "en-US|America/Chicago|390x844|3|dark|no-pref|4g",
    }), server);
    expect(BLOBS).toHaveLength(20);
    expect(p).toEqual({
      blobs: ["view", "05", "coverDark", "grotesk", "link", "k7f2", "US", "www.linkedin.com", "phone", "", "", "", "k3j9x0aa", "Austin", "Texas",
        "abcdef123456", "Google LLC", "", "Chrome 131|Windows", "en-US|America/Chicago|390x844|3|dark|no-pref|4g"],
      doubles: [0, 0, ...AUSTIN, 0, 0, 0, 0],
      indexes: ["a1b2c3d4"],
    });
  });

  it("accepts every event the page sends, and nothing else", () => {
    for (const t of ["view", "studio_open", "studio_pick", "example", "pdf", "passage", "link", "leave", "section", "ask_focus", "ask_abandon", "copy", "perf", "error"]) {
      expect(parseEvent(ev({ t }), server), t).not.toBeNull();
    }
    for (const bad of ["ask", "VIEW", "", "view ", "script"]) expect(parseEvent(ev({ t: bad }), server), bad).toBeNull();
  });

  it("drops a body that is not a small JSON object", () => {
    expect(parseEvent("not json", server)).toBeNull();
    expect(parseEvent("[1,2]", server)).toBeNull();
    expect(parseEvent("null", server)).toBeNull();
    expect(parseEvent(ev({ t: "view", pad: "x".repeat(2100) }), server)).toBeNull();
  });

  it("keeps tags, ids and hosts in their shape: odd characters and unknown fields never reach a blob", () => {
    const p = parseEvent(ev({
      t: "studio_pick", kind: "palette", value: "What is the standard deduction", layout: "../01", src: "Acme Corp!", ref: "evil.com/path?q=1",
      question: "my secret question", where: "<b>", pv: "x".repeat(30), vid: "SHORT", setup: "<script>",
    }), server);
    expect(blob(p, "kind")).toBe("palette");
    for (const k of ["value", "layout", "src", "ref", "where", "pv", "vid", "setup", "text"] as const) expect(blob(p, k), k).toBe("");
    expect(JSON.stringify(p)).not.toMatch(/secret|deduction|evil|script/);
  });

  it("only takes values from each field's own list", () => {
    const p = parseEvent(ev({ t: "view", how: "hacked", size: "huge", kind: "x" }), server);
    expect([blob(p, "how"), blob(p, "size"), blob(p, "kind")]).toEqual(["", "", ""]);
    const q = parseEvent(ev({ t: "pdf", value: "p501", where: "trace" }), server);
    expect([blob(q, "value"), blob(q, "where")]).toEqual(["p501", "trace"]);
  });

  it("records the numbers each event carries, within sane bounds", () => {
    expect(d(parseEvent(ev({ t: "leave", scroll: 62.4, secs: 95 }), server))).toEqual([62, 95, ...AUSTIN, 0, 0, 0, 0]);
    expect(d(parseEvent(ev({ t: "leave", scroll: 250, secs: 1e9 }), server)).slice(0, 2)).toEqual([100, 3600]);
    expect(d(parseEvent(ev({ t: "leave", scroll: -5, secs: "lots" }), server)).slice(0, 2)).toEqual([0, 0]);
    expect(d(parseEvent(ev({ t: "passage", n: 3 }), server)).slice(0, 2)).toEqual([3, 0]);
    expect(d(parseEvent(ev({ t: "section", kind: "how", secs: 41.6 }), server)).slice(0, 2)).toEqual([42, 0]);
    expect(d(parseEvent(ev({ t: "ask_abandon", n: 37 }), server)).slice(0, 2)).toEqual([37, 0]);
    expect(d(parseEvent(ev({ t: "copy", n: 120, where: "answer" }), server)).slice(0, 2)).toEqual([120, 0]);
    // page speed: TTFB, FCP; then (after the coordinates) LCP, CLS x 1000, load
    expect(d(parseEvent(ev({ t: "perf", ttfb: 182.4, fcp: 640, lcp: 1210, cls: 0.0423, load: 1904 }), server)))
      .toEqual([182, 640, ...AUSTIN, 1210, 42, 1904, 0]);
  });

  it("names a section by its id only", () => {
    expect(blob(parseEvent(ev({ t: "section", kind: "built" }), server), "kind")).toBe("built");
    expect(blob(parseEvent(ev({ t: "section", kind: "How it works!" }), server), "kind")).toBe("");
    expect(blob(parseEvent(ev({ t: "studio_pick", kind: "built" }), server), "kind")).toBe(""); // only a section takes an id here
  });

  it("keeps a script error's message, short and on one line, and nothing else as free text", () => {
    const p = parseEvent(ev({ t: "error", text: "TypeError: x is undefined\n   at render", value: "sections.js" }), server);
    expect([blob(p, "text"), blob(p, "value")]).toEqual(["TypeError: x is undefined at render", "sections.js"]);
    expect(blob(parseEvent(ev({ t: "error", text: "e".repeat(500) }), server), "text")).toHaveLength(200);
    expect(blob(parseEvent(ev({ t: "view", text: "free text on a view" }), server), "text")).toBe("");
  });

  it("takes the country only in its two-letter form", () => {
    expect(blob(parseEvent(ev({ t: "view" }), { ...server, country: "PL" }), "country")).toBe("PL");
    expect(blob(parseEvent(ev({ t: "view" }), { ...server, country: "Poland" }), "country")).toBe("");
  });

  it("keeps the city, region and network owner as Cloudflare names them, and the coordinates to about 11 km", () => {
    for (const [city, region] of [["São Paulo", "São Paulo"], ["Winston-Salem", "North Carolina"], ["St. John's", "Newfoundland and Labrador"], ["Kraków", "Lesser Poland"]]) {
      const p = parseEvent(ev({ t: "view" }), { ...server, city, region });
      expect([blob(p, "city"), blob(p, "region")]).toEqual([city, region]);
    }
    for (const org of ["Comcast Cable Communications, LLC", "AT&T Services, Inc.", "Deutsche Telekom AG"]) {
      expect(blob(parseEvent(ev({ t: "view" }), { ...server, org }), "org")).toBe(org);
    }
    const odd = parseEvent(ev({ t: "view" }), { ...server, city: "<script>x</script>", region: "a".repeat(81), org: "<b>" });
    expect([blob(odd, "city"), blob(odd, "region"), blob(odd, "org")]).toEqual(["", "", ""]);
    expect(d(parseEvent(ev({ t: "view" }), { ...server, lat: "51.10789", lon: "17.03854" })).slice(2, 4)).toEqual([51.1, 17]);
    // unknown or nonsense coordinates are 0, 0 (no visitor sits in the Gulf of Guinea)
    expect(d(parseEvent(ev({ t: "view" }), { ...server, lat: undefined, lon: "east" })).slice(2, 4)).toEqual([0, 0]);
    expect(d(parseEvent(ev({ t: "view" }), { ...server, lat: "123", lon: "-200" })).slice(2, 4)).toEqual([0, 0]);
  });

  it("never takes the place, the network or the browser from the page itself", () => {
    const p = parseEvent(ev({ t: "view", city: "Paris", region: "Ile-de-France", lat: 48.8, lon: 2.3, org: "Fake Inc", ua: "Fake/1" }), server);
    expect([blob(p, "city"), blob(p, "region"), blob(p, "org"), blob(p, "ua"), ...d(p).slice(2, 4)]).toEqual(["Austin", "Texas", "Google LLC", "Chrome 131|Windows", ...AUSTIN]);
  });
});

describe("parseUA: the browser and system from the User-Agent header", () => {
  const cases: [string, string][] = [
    [CHROME_WIN, "Chrome 131|Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari 18|iOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox 132|macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge 131|Windows"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Chrome 131|Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30", "LinkedIn app|iOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36", "bot:HeadlessChrome|Windows"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "bot:Googlebot|other"],
    ["", ""],
  ];
  for (const [ua, want] of cases) it(want || "(empty)", () => expect(parseUA(ua)).toBe(want));
});

describe("askPoint: the Worker's own record of a question", () => {
  it("keeps the outcome, time, cost, the question and its length, with the page's context", () => {
    const p = askPoint({ status: "answered", ms: 2140, cost: 0.00051, question: "  What is the 2025 standard deduction?  ", ctx: { layout: "01", src: "k7f2", pv: "k3j9x0aa", vid: "abcdef123456" } }, server);
    expect(blob(p, "type")).toBe("ask");
    expect(blob(p, "value")).toBe("answered");
    expect(blob(p, "text")).toBe("What is the 2025 standard deduction?");
    expect([blob(p, "layout"), blob(p, "src"), blob(p, "pv"), blob(p, "vid")]).toEqual(["01", "k7f2", "k3j9x0aa", "abcdef123456"]);
    expect(d(p)).toEqual([2140, 0.00051, ...AUSTIN, 36, 0, 0, 0]);
  });

  it("cuts a question to 300 characters, and takes the text only from the Worker, not the context", () => {
    expect(blob(askPoint({ status: "answered", ms: 1, cost: 0, question: "q".repeat(400), ctx: {} }, server), "text")).toHaveLength(300);
    expect(blob(askPoint({ status: "answered", ms: 1, cost: 0, question: "", ctx: { text: "planted" } }, server), "text")).toBe("");
  });

  it("knows every outcome, and drops one it does not", () => {
    for (const s of ["answered", "not_found", "held_back", "busy", "limit", "error"]) {
      expect(blob(askPoint({ status: s, ms: 1, cost: 0, question: "", ctx: {} }, server), "value"), s).toBe(s);
    }
    expect(askPoint({ status: "whatever", ms: 1, cost: 0, question: "", ctx: {} }, server)).toBeNull();
  });

  it("records nothing when the visitor has turned events off", () => {
    expect(askPoint({ status: "answered", ms: 1, cost: 0, question: "anything", ctx: { off: true } }, server)).toBeNull();
  });

  it("survives a missing or broken context", () => {
    expect(blob(askPoint({ status: "error", ms: 0, cost: 0, question: "", ctx: undefined }, server), "layout")).toBe("");
    expect(blob(askPoint({ status: "error", ms: 0, cost: 0, question: "", ctx: "junk" }, server), "src")).toBe("");
  });
});
