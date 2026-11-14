// Usage events for Workers Analytics Engine. The page sends small JSON events to /api/event
// (shared/track.js); /api/ask adds one for each question. This module decides what is kept: each field the
// page sends has a fixed shape or comes from a fixed list, and anything else is dropped. The only free text is
// the question (from the Worker, never from the page) and a script error's message. The Worker adds what it
// knows about the request: Cloudflare's IP lookup (country, region, city, coordinates to one decimal, the
// network owner), the browser and system from the User-Agent header, and the day's salted IP hash (the same
// key as the usage table) as the index. Pure: no I/O, tested on its own (test/events.test.ts).

/** The blobs of every data point, always in this order (Analytics Engine stores them as blob1..blob20; 20 is
 *  its maximum). */
export const BLOBS = [
  "type", "layout", "palette", "font", "how", "src", "country", "ref", "size", "kind", "value", "where", "pv",
  "city", "region", "vid", "org", "text", "ua", "setup",
] as const;
type Blob = (typeof BLOBS)[number];

/** What the Worker knows about the request: request.cf (country, region, city, latitude, longitude,
 *  asOrganization), the User-Agent header, and the visitor key. */
export interface Server {
  country: string; visitor: string;
  region?: unknown; city?: unknown; lat?: unknown; lon?: unknown; org?: unknown; ua?: unknown;
}
/** One Analytics Engine data point. Doubles, always 8:
 *   1-2  leave [scroll %, seconds]; passage [n]; section [seconds]; ask_abandon and copy [characters];
 *        perf [TTFB ms, FCP ms]; ask [ms, cost USD]
 *   3-4  latitude, longitude to one decimal (0, 0 when unknown)
 *   5-8  perf [LCP ms, CLS x 1000, load ms]; ask [question length] */
export interface Point { blobs: string[]; doubles: number[]; indexes: string[] }

export const MAX_BODY = 2048;
const TYPES = new Set(["view", "studio_open", "studio_pick", "example", "pdf", "passage", "link", "leave", "section", "ask_focus", "ask_abandon", "copy", "perf", "error"]);
const OUTCOMES = new Set(["answered", "not_found", "held_back", "busy", "limit", "error"]);

const pattern = (re: RegExp) => (v: unknown) => (typeof v === "string" && re.test(v) ? v : "");
const oneOf = (...xs: string[]) => (v: unknown) => (typeof v === "string" && xs.includes(v) ? v : "");
/** Free text on one line, cut to `max` characters. */
const line = (max: number) => (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// each field the page may send, and the only shape it may take
const FIELDS: Partial<Record<Blob, (v: unknown) => string>> = {
  layout: pattern(/^\d{2}$/), // "01".."09"
  palette: pattern(/^[A-Za-z0-9]{1,24}$/), // a preset key, "coverPaper"
  font: pattern(/^[A-Za-z0-9]{1,24}$/),
  how: oneOf("default", "saved", "link"), // how the look was chosen (studio/choice.js)
  src: pattern(/^[a-z0-9-]{1,40}$/), // the code on a link Mat sent
  ref: pattern(/^[a-z0-9.-]{1,100}$/), // the referrer's host, never its path
  size: oneOf("phone", "tablet", "desktop"),
  kind: oneOf("layout", "palette", "font", "reset", "recorded", "sample"),
  value: pattern(/^[A-Za-z0-9_.-]{1,40}$/), // an example id, a preset key, a publication file ("p501"), a script file
  where: oneOf("answer", "trace", "footnote", "how", "built", "nav", "page"),
  pv: pattern(/^[a-z0-9]{8}$/), // a random id for one page load
  vid: pattern(/^[a-z0-9]{12}$/), // a random id kept in the browser (localStorage), for returning visitors
  setup: pattern(/^[A-Za-z0-9_./|+:-]{1,160}$/), // "en-US|America/Chicago|390x844|3|dark|no-pref|4g"
};
const SECTION = pattern(/^[a-z0-9-]{1,24}$/); // a section's id, for `section` events only
const ERROR_TEXT = line(200);
const QUESTION = line(300);
const country = pattern(/^[A-Z0-9]{2}$/); // Cloudflare's two-letter code ("T1" is Tor)
// a place or company name as Cloudflare gives it ("São Paulo", "St. John's", "AT&T Services, Inc.")
const name = (max: number) => pattern(new RegExp(`^[\\p{L}\\p{M}0-9 .,'\\u2019()&/+-]{1,${max}}$`, "u"));
const place = name(80), org = name(100);

/** A coordinate to one decimal (about 11 km: an IP lookup is not more precise than a city), or 0 if unusable. */
function coord(v: unknown, limit: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 10) / 10 : 0;
}

function clamp(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(hi, Math.max(lo, n));
}
const whole = (v: unknown, hi: number) => Math.round(clamp(v, 0, hi));

/** The browser (with its major version) and the system, from a User-Agent header: "Chrome 131|Windows".
 *  Headless browsers and crawlers come back as "bot:<name>", so they can be left out of the counts. */
export function parseUA(ua: unknown): string {
  if (typeof ua !== "string" || !ua.trim()) return "";
  const bot = ua.match(/HeadlessChrome|Googlebot|bingbot|LinkedInBot|Twitterbot|facebookexternalhit|Slackbot|Discordbot|Applebot|DuckDuckBot|YandexBot|Baiduspider|GPTBot|ClaudeBot|PerplexityBot|Lighthouse|PhantomJS|python-requests|curl|Wget|node-fetch|undici|[A-Za-z]*(?:bot|crawler|spider)\b/i);
  const v = (re: RegExp) => { const m = ua.match(re); return m ? m[1] : ""; };
  const ver = (label: string, re: RegExp) => (v(re) ? `${label} ${v(re)}` : "");
  const browser = bot ? `bot:${bot[0]}`
    : /LinkedInApp/.test(ua) ? "LinkedIn app"
    : /FBAN|FBAV/.test(ua) ? "Facebook app"
    : ver("Edge", /Edg(?:e|A|iOS)?\/(\d+)/) || ver("Opera", /OPR\/(\d+)/) || ver("Samsung", /SamsungBrowser\/(\d+)/)
      || ver("Firefox", /(?:Firefox|FxiOS)\/(\d+)/) || ver("Chrome", /(?:Chrome|CriOS)\/(\d+)/)
      || ver("Safari", /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/) || "other";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows NT/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "other";
  return `${browser}|${os}`;
}

// what only the Worker supplies, never the event
const FROM_SERVER: Partial<Record<Blob, (s: Server) => string>> = {
  country: (s) => country(s.country), city: (s) => place(s.city), region: (s) => place(s.region), org: (s) => org(s.org), ua: (s) => parseUA(s.ua),
};

function point(type: string, ev: Record<string, unknown>, server: Server, nums: number[], text = ""): Point {
  const blobs = BLOBS.map((b) => {
    if (b === "type") return type;
    if (b === "text") return text;
    if (b === "kind" && type === "section") return SECTION(ev.kind);
    const fromServer = FROM_SERVER[b];
    return fromServer ? fromServer(server) : FIELDS[b]?.(ev[b]) ?? "";
  });
  const lat = coord(server.lat, 90), lon = coord(server.lon, 180), known = lat !== 0 && lon !== 0;
  const n = (i: number) => nums[i] ?? 0;
  return { blobs, doubles: [n(0), n(1), known ? lat : 0, known ? lon : 0, n(2), n(3), n(4), n(5)], indexes: [server.visitor] };
}

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The numbers an event carries, in the order of doubles 1, 2, 5, 6, 7, 8. */
function numbers(ev: Record<string, unknown>): number[] {
  switch (ev.t) {
    case "leave": return [whole(ev.scroll, 100), whole(ev.secs, 3600)];
    case "passage": return [whole(ev.n, 50)];
    case "section": return [whole(ev.secs, 3600)];
    case "ask_abandon": return [whole(ev.n, 300)];
    case "copy": return [whole(ev.n, 20000)];
    case "perf": return [whole(ev.ttfb, 120000), whole(ev.fcp, 120000), whole(ev.lcp, 120000), whole(clamp(ev.cls, 0, 10) * 1000, 10000), whole(ev.load, 120000)];
    default: return [];
  }
}

/** An event from the page, or null if it is not one the page sends. */
export function parseEvent(raw: string, server: Server): Point | null {
  if (raw.length > MAX_BODY) return null;
  let ev: Record<string, unknown> | null;
  try { ev = asObject(JSON.parse(raw)); } catch { return null; }
  if (!ev || typeof ev.t !== "string" || !TYPES.has(ev.t)) return null;
  return point(ev.t, ev, server, numbers(ev), ev.t === "error" ? ERROR_TEXT(ev.text) : "");
}

/** The Worker's record of one question: the outcome, time, cost, the question (cut to 300 characters) and its
 *  length, with the page's context. Null when the visitor turned events off (ctx.off, sent by track.js). */
export function askPoint(a: { status: string; ms: number; cost: number; question: string; ctx: unknown }, server: Server): Point | null {
  if (!OUTCOMES.has(a.status)) return null;
  const ctx = asObject(a.ctx) ?? {};
  if (ctx.off === true) return null;
  const q = QUESTION(a.question);
  return point("ask", { ...ctx, value: a.status }, server, [clamp(a.ms, 0, 600000), clamp(a.cost, 0, 10), q.length], q);
}
