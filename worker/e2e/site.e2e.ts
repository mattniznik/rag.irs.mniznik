// Browser tests for the demo page: the seven layouts, the Studio (picking, saving, links, keyboard) and the ask
// boxes' live, busy and error replies. They run against e2e/serve.mjs (the page's own files and an /api/ask
// stand-in), at desktop and phone size (playwright.config.ts). Third-party requests are blocked, so nothing
// here depends on the network.
import { expect, test, type Page } from "@playwright/test";
import { askPoint, BLOBS, parseEvent } from "../src/events";

declare global {
  interface Window { SITE: any; STUDIO: any; STUDIO_PANEL: any; RAG_LIVE: boolean }
}

const LAYOUTS = ["01", "04", "05", "06", "07", "08", "09"];
const ONE_COLUMN = new Set(["07", "08", "09"]);
const KEY = "rag-site-choice";
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ context, page }) => {
  await context.route((url) => url.hostname !== "127.0.0.1", (route) => route.abort());
  await page.addInitScript(() => { window.RAG_LIVE = true; }); // as on rag.irs.mniznik.com: the ask boxes call /api/ask
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  errors.set(page, list);
});

/** The loader has rendered the layout and mounted the Studio. */
async function ready(page: Page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains("boot") && !!window.STUDIO_PANEL, null, { timeout: 15000 });
}
const choice = (page: Page) => page.evaluate(() => ({ ...window.SITE.choice, saved: localStorage.getItem("rag-site-choice") }));
/** A Studio pick reloads the page into it. */
async function pick(page: Page, selector: string) {
  await Promise.all([page.waitForEvent("load"), page.locator(selector).click()]);
  await ready(page);
}
async function openStudio(page: Page) {
  await page.locator(".sp-btn").click();
  await expect(page.locator(".sp-panel")).toBeVisible();
}

for (const id of LAYOUTS) {
  test(`layout ${id} loads with no errors and no sideways scroll`, async ({ page }) => {
    await page.goto(`/?layout=${id}`);
    await ready(page);
    const c = await choice(page);
    expect([c.option, c.source]).toEqual([id, "link"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator(ONE_COLUMN.has(id) ? ".sp-btn.sp-fab" : ".nav .sp-btn.sp-nav")).toBeVisible();
    expect(errors.get(page)).toEqual([]);
  });
}

test.describe("the Studio", () => {
  test("a first visit shows the default look and saves nothing", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const c = await choice(page);
    const d = await page.evaluate(() => window.STUDIO.DEFAULT);
    expect(c).toMatchObject({ option: d.option, palette: d.palette, font: d.font, source: "default", saved: null });
  });

  test("the panel lists every layout, colour set and typeface", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await openStudio(page);
    const want = await page.evaluate(() => [window.STUDIO.OPTIONS.length, Object.keys(window.STUDIO.PALETTES).length, Object.keys(window.STUDIO.FONTS).length]);
    expect([await page.locator(".sp-lay").count(), await page.locator(".sp-pal").count(), await page.locator(".sp-font").count()]).toEqual(want);
  });

  test("picking a layout saves it, reloads into it, and the pick survives a new visit", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await openStudio(page);
    await pick(page, '.sp-lay[data-o="08"]');
    expect(await choice(page)).toMatchObject({ option: "08", source: "saved" });
    await expect(page.locator("html")).toHaveClass(/sp-open/); // the panel opens again where it was
    await page.reload();
    await ready(page);
    expect(await choice(page)).toMatchObject({ option: "08", source: "saved" });
    await expect(page.locator("html")).not.toHaveClass(/sp-open/);
  });

  test("colours and type change only themselves", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await openStudio(page);
    await pick(page, '.sp-pal[data-p="ocean"]');
    await pick(page, '.sp-font[data-f="playfair"]');
    const d = await page.evaluate(() => window.STUDIO.DEFAULT);
    expect(await choice(page)).toMatchObject({ option: d.option, palette: "ocean", font: "playfair", source: "saved" });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(6, 18, 26)"); // ocean's background
  });

  test("a ?layout= link shows a layout without touching the saved pick", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ option: "05", palette: "lime", font: "sora" })), KEY);
    await page.goto("/?layout=09");
    await ready(page);
    expect(await choice(page)).toMatchObject({ option: "09", source: "link" });
    await page.goto("/");
    await ready(page);
    expect(await choice(page)).toMatchObject({ option: "05", palette: "lime", font: "sora", source: "saved" });
  });

  test("an old link to a layout that no longer exists falls back", async ({ page }) => {
    await page.goto("/?layout=report");
    await ready(page);
    const d = await page.evaluate(() => window.STUDIO.DEFAULT);
    expect(await choice(page)).toMatchObject({ option: d.option, source: "default" });
  });

  test("back to the default clears the pick", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ option: "06", palette: "nordic", font: "inter" })), KEY);
    await page.reload();
    await ready(page);
    await openStudio(page);
    await pick(page, ".sp-reset");
    expect(await choice(page)).toMatchObject({ source: "default", saved: null });
  });

  test("the keyboard stays inside the open panel and Esc hands the focus back", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.locator(".sp-btn").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".sp-x")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    const lastIsFocused = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".sp-panel button:not([disabled])")];
      return document.activeElement === f[f.length - 1];
    });
    expect(lastIsFocused).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.locator(".sp-x")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveClass(/sp-open/);
    await expect(page.locator(".sp-btn")).toBeFocused();
  });

  test("on a phone the panel is a bottom sheet that scrolls", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone layout only");
    await page.goto("/");
    await ready(page);
    await openStudio(page);
    const r = await page.evaluate(() => {
      const box = document.querySelector(".sp-panel")!.getBoundingClientRect(), body = document.querySelector(".sp-body")!;
      return { bottom: Math.round(box.bottom), height: window.innerHeight, top: Math.round(box.top), scrolls: body.scrollHeight > body.clientHeight };
    });
    expect(r.bottom).toBe(r.height);
    expect(r.top).toBeGreaterThan(0);
    expect(r.scrolls).toBe(true);
  });
});

const PDF_PAGE = /^https:\/\/www\.irs\.gov\/pub\/irs-(pdf|prior)\/[\w-]+\.pdf#page=\d+$/;
for (const id of LAYOUTS) {
  test(`layout ${id} links each answer to its exact page in the IRS PDF and shows how it was made`, async ({ page }) => {
    await page.goto(`/?layout=${id}`);
    await ready(page);
    // the answer on screen: a one-column layout shows it after a recorded example is picked
    if (ONE_COLUMN.has(id)) await page.locator("#replay-chips .chip").first().click();
    const answer = ONE_COLUMN.has(id) ? page.locator("#replay-result") : page.locator('[data-slot="hero"]');
    const sourceLinks = await answer.locator('a[href*="irs.gov"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(sourceLinks.length).toBeGreaterThan(0);
    for (const h of sourceLinks) expect(h).toMatch(PDF_PAGE);
    // how it was made: already open under the answer, no click needed; the 8 passages search picked, each
    // openable at its page in the PDF
    const trace = answer.locator(ONE_COLUMN.has(id) ? ".trace" : ".tr-more .trace").first();
    await expect(trace).toBeVisible();
    await expect(trace.locator(".prow")).toHaveCount(8);
    const pages = trace.getByRole("link", { name: "Open this page in the IRS PDF", includeHidden: true });
    await expect(pages).toHaveCount(8);
    for (const h of await pages.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) expect(h).toMatch(PDF_PAGE);
    expect(errors.get(page)).toEqual([]);
  });
}

const REPO = "https://github.com/mattniznik/rag.irs.mniznik";
for (const id of LAYOUTS) {
  test(`layout ${id} shows how it was built, with numbers from the data and links into the repository`, async ({ page }) => {
    await page.goto(`/?layout=${id}`);
    await ready(page);
    const built = page.locator("#built");
    await built.scrollIntoViewIfNeeded();
    await expect(built).toBeVisible();
    await expect(built.locator(".wf-step")).toHaveCount(6);
    // the counts on the page are the generated ones, not typed in
    const eng = await page.evaluate(() => (window as any).RAG.engineering);
    const text = await built.innerText();
    for (const n of [eng.tests.python, eng.tests.typescript, eng.tests.browser, eng.decisions.length, eng.sources]) {
      expect(text).toContain(String(n));
    }
    const hrefs = await built.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) expect(h.startsWith(REPO)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(errors.get(page)).toEqual([]);
  });
}

test.describe("asking a question", () => {
  test("a section-built layout shows a live answer, the busy notice and an error", async ({ page }) => {
    await page.goto("/?layout=01");
    await ready(page);
    const box = page.locator("[data-ask] input"), stage = page.locator("[data-stage]");
    await box.fill("What is the 2025 standard deduction for a single person?");
    await box.press("Enter");
    await expect(stage.locator(".top .mono")).toContainText("live answer");
    await expect(stage.locator(".quote")).toHaveCount(1);
    await expect(stage.locator(".tr-more .trace")).toBeVisible(); // shown with the answer, unasked
    await expect(stage.locator(".tr-more .trace .prow")).toHaveCount(8);
    await box.fill("Are you busy?");
    await box.press("Enter");
    await expect(stage).toContainText("Too many requests right now");
    await expect(stage.getByRole("link", { name: "Contact Mat" })).toHaveAttribute("href", /linkedin\.com/);
    await box.fill("Show me an error");
    await box.press("Enter");
    await expect(stage).toContainText("The model is unavailable right now");
    expect(errors.get(page)).toEqual([]);
  });

  test("a one-column layout shows the answer with how it was made, the busy notice and an error", async ({ page }) => {
    await page.goto("/?layout=07");
    await ready(page);
    const q = page.locator("#q"), result = page.locator("#result");
    await q.fill("What is the 2025 standard deduction for a single person?");
    await page.locator("#go").click();
    await expect(result.locator(".trace > header")).toHaveText("How this answer was made");
    expect(await result.locator("mark").count()).toBeGreaterThan(0); // the quote highlighted where the check found it
    await q.fill("Are you busy?");
    await page.locator("#go").click();
    await expect(result.getByRole("link", { name: "Contact Mat" })).toBeVisible();
    await q.fill("Show me an error");
    await page.locator("#go").click();
    await expect(result).toContainText("The model is unavailable right now");
    expect(errors.get(page)).toEqual([]);
  });
});

// Usage events (shared/track.js, /api/event): the stand-in keeps what the page sends. Each test tags its
// visit with its own ?src=, since the tests share one server and run in parallel.
test.describe("usage events: the basics", () => {
  type Sent = { raw: string; ev: Record<string, any> };
  const newTag = () => "e2e-" + Math.random().toString(36).slice(2, 10);
  const sent = async (page: Page, tag: string) => (await (await page.request.get(`/__events?src=${tag}`)).json()) as Sent[];
  const ofType = async (page: Page, tag: string, t: string) => (await sent(page, tag)).filter((e) => e.ev.t === t).map((e) => e.ev);
  const QUESTION = "What is the 2025 standard deduction for a single person?";
  /** Every event the page sent passes the Worker's own check with each field intact. */
  async function keptWhole(page: Page, tag: string) {
    const server = { country: "US", visitor: "v" };
    for (const { raw, ev } of await sent(page, tag)) {
      const p = ev.t === "ask" ? askPoint({ status: "answered", ms: 1, cost: 0, ctx: ev }, server) : parseEvent(raw, server);
      expect(p, raw).not.toBeNull();
      for (const [k, v] of Object.entries(ev)) {
        const i = (BLOBS as readonly string[]).indexOf(k);
        if (i > 0) expect(p!.blobs[i], `${ev.t}.${k}`).toBe(String(v));
      }
    }
  }

  test("a page load sends one view: layout, how it was chosen, the link's tag and only the referrer's host", async ({ page }, info) => {
    const tag = newTag();
    await page.goto(`/?layout=05&src=${tag}`, { referer: "https://www.linkedin.com/feed/update/12345?trk=abc" });
    await ready(page);
    await expect.poll(async () => (await ofType(page, tag, "view")).length).toBe(1);
    const [v] = await ofType(page, tag, "view");
    expect(v).toMatchObject({ layout: "05", how: "link", src: tag, ref: "www.linkedin.com", size: info.project.name === "phone" ? "phone" : "desktop" });
    expect(v.pv).toMatch(/^[a-z0-9]{8}$/);
    expect(JSON.stringify(await sent(page, tag))).not.toMatch(/feed|12345|trk/);
  });

  test("an example, a passage, a PDF page and the Studio each send one event", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=01&src=${tag}`);
    await ready(page);
    await page.locator('[data-ex="S04"]').first().click();
    await expect.poll(async () => (await ofType(page, tag, "example")).map((e) => e.value)).toEqual(["S04"]);
    await page.locator('[data-slot="hero"] .tr-more .prow summary').nth(2).click();
    await expect.poll(async () => (await ofType(page, tag, "passage")).map((e) => [e.where, e.n])).toEqual([["trace", 3]]);
    // the click on the link is what counts; the IRS site itself is blocked in these tests
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator('[data-slot="hero"] .answer-card a[href*="irs.gov"]').first().click()]);
    await popup.close();
    await expect.poll(async () => (await ofType(page, tag, "pdf")).map((e) => [e.where, e.value])).toEqual([["answer", "p334"]]);
    await openStudio(page);
    await expect.poll(async () => (await ofType(page, tag, "studio_open")).length).toBe(1);
    await pick(page, '.sp-pal[data-p="ocean"]');
    await expect.poll(async () => (await ofType(page, tag, "studio_pick")).map((e) => [e.kind, e.value])).toEqual([["palette", "ocean"]]);
    // the pick reloads the page: a second view, now with the saved look
    await expect.poll(async () => (await ofType(page, tag, "view")).map((e) => e.how)).toEqual(["link", "saved"]);
    // what the page sends is what the Worker keeps (src/events.ts): no field fails its check and is blanked
    await keptWhole(page, tag);
  });

  test("a one-column layout's recorded example sends its id", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=08&src=${tag}`);
    await ready(page);
    const chip = page.locator("#replay-chips .chip").first();
    const id = await chip.getAttribute("data-ex");
    expect(id).toMatch(/^[A-Z]\d{2}$/);
    await chip.click();
    await expect.poll(async () => (await ofType(page, tag, "example")).map((e) => e.value)).toEqual([id]);
  });

  test("a question carries its context to the Worker, and the page's own events never repeat its words", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=01&src=${tag}`);
    await ready(page);
    const box = page.locator("[data-ask] input");
    await box.fill(QUESTION);
    await box.press("Enter");
    await expect(page.locator("[data-stage] .top .mono")).toContainText("live answer");
    await page.goto(`/?layout=07&src=${tag}`);
    await ready(page);
    await page.locator("#q").fill(QUESTION);
    await page.locator("#go").click();
    await expect(page.locator("#result .trace > header")).toBeVisible();
    await expect.poll(async () => (await ofType(page, tag, "ask")).map((e) => e.layout)).toEqual(["01", "07"]);
    expect(JSON.stringify(await sent(page, tag))).not.toMatch(/deduction|single person/i);
    await keptWhole(page, tag);
  });

  test("leaving the page sends how far it was read and for how long", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=01&src=${tag}`);
    await ready(page);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.goto("about:blank");
    await expect.poll(async () => (await ofType(page, tag, "leave")).length).toBe(1);
    const [l] = await ofType(page, tag, "leave");
    expect(l.scroll).toBeGreaterThanOrEqual(95);
    expect(l.secs).toBeGreaterThanOrEqual(0);
  });

  test("with Global Privacy Control on, nothing is sent and a question says so", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
    const tag = newTag();
    await page.goto(`/?layout=01&src=${tag}`);
    await ready(page);
    await page.locator('[data-ex="S04"]').first().click();
    const box = page.locator("[data-ask] input");
    await box.fill(QUESTION);
    const [req] = await Promise.all([page.waitForRequest("**/api/ask"), box.press("Enter")]);
    expect(JSON.parse(req.postData() || "{}").ctx).toEqual({ off: true });
    await expect(page.locator("[data-stage] .top .mono")).toContainText("live answer");
    expect(await sent(page, tag)).toEqual([]);
  });

  test("?track=off turns events off in this browser until ?track=on", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?track=off&src=${tag}`);
    await ready(page);
    await page.goto(`/?src=${tag}`);
    await ready(page);
    await page.locator('[data-ex="S04"]').first().click();
    await page.goto(`/?track=on&src=${tag}`);
    await ready(page);
    await expect.poll(async () => (await ofType(page, tag, "view")).length).toBe(1);
    expect((await sent(page, tag)).map((e) => e.ev.t)).toEqual(["view"]);
  });
});

// Everything else the page records (shared/track.js), and Microsoft Clarity.
test.describe("usage events: setup, sections, the ask box, copies, speed, errors, Clarity", () => {
  type Sent = { raw: string; ev: Record<string, any> };
  const newTag = () => "e2e-" + Math.random().toString(36).slice(2, 10);
  const sent = async (page: Page, tag: string) => (await (await page.request.get(`/__events?src=${tag}`)).json()) as Sent[];
  const ofType = async (page: Page, tag: string, t: string) => (await sent(page, tag)).filter((e) => e.ev.t === t).map((e) => e.ev);

  test("a view carries the visitor's setup and an id that survives a reload and a second tab", async ({ page, context }) => {
    const tag = newTag();
    await page.goto(`/?src=${tag}`);
    await ready(page);
    await expect.poll(async () => (await ofType(page, tag, "view")).length).toBe(1);
    const [v] = await ofType(page, tag, "view");
    expect(v.setup).toMatch(/^[A-Za-z-]*\|[A-Za-z_/+-]*\|\d+x\d+\|[\d.]+\|(dark|light)\|(reduce|no-pref)\|[a-z0-9-]*$/);
    expect(v.vid).toMatch(/^[a-z0-9]{12}$/);
    await page.reload();
    await ready(page);
    const second = await context.newPage();
    await second.goto(`/?src=${tag}`);
    await ready(second);
    await expect.poll(async () => (await ofType(page, tag, "view")).map((e) => e.vid)).toEqual([v.vid, v.vid, v.vid]);
    await second.close();
  });

  test("sections in view, the ask box focused and left unasked, a copy and the page speed each send", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=01&src=${tag}`);
    await ready(page);
    const box = page.locator("[data-ask] input");
    await box.click();
    await box.pressSequentially("abc");
    await page.evaluate(() => { // select the answer and copy it, as a visitor would
      const a = document.querySelector('[data-slot="hero"] .answer-card .a')!;
      const r = document.createRange(); r.selectNodeContents(a);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new ClipboardEvent("copy", { bubbles: true }));
    });
    await page.waitForTimeout(1200); // the hero stays in view for at least a second
    await page.goto("about:blank"); // leaving sends the rest
    await expect.poll(async () => (await ofType(page, tag, "leave")).length).toBe(1);
    expect((await ofType(page, tag, "ask_focus")).length).toBe(1);
    expect((await ofType(page, tag, "ask_abandon")).map((e) => e.n)).toEqual([3]);
    const [copy] = await ofType(page, tag, "copy");
    expect(copy.where).toBe("answer");
    expect(copy.n).toBeGreaterThan(10);
    const hero = (await ofType(page, tag, "section")).find((e) => e.kind === "hero");
    expect(hero?.secs).toBeGreaterThanOrEqual(1);
    const [perf] = await ofType(page, tag, "perf");
    expect(perf.fcp).toBeGreaterThan(0);
    expect(perf.load).toBeGreaterThan(0);
  });

  test("script errors are reported, five at most", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=07&src=${tag}`);
    await ready(page);
    await page.evaluate(() => { for (let i = 0; i < 7; i++) setTimeout(() => { throw new Error("boom-" + i); }); });
    await expect.poll(async () => (await ofType(page, tag, "error")).length).toBe(5);
    await page.waitForTimeout(300);
    const errs = await ofType(page, tag, "error");
    expect(errs).toHaveLength(5);
    expect(errs[0].text).toMatch(/boom-0/);
  });

  test("Clarity is loaded with Microsoft's tag and told the layout, the link code and the visitor", async ({ page }) => {
    const tag = newTag();
    await page.goto(`/?layout=04&src=${tag}`);
    await ready(page);
    expect(await page.locator("script#clarity-script").getAttribute("src")).toBe("https://www.clarity.ms/tag/zdgaglciqq");
    const calls = await page.evaluate(() => ((window as any).clarity.q as IArguments[]).map((a) => Array.from(a)));
    const vid = await page.evaluate(() => localStorage.getItem("rag-vid"));
    expect(calls).toContainEqual(["set", "layout", "04"]);
    expect(calls).toContainEqual(["set", "src", tag]);
    expect(calls).toContainEqual(["set", "vid", vid]);
    expect(calls.find((c) => c[0] === "identify")?.[1]).toBe(vid);
  });

  test("Clarity is told the moments that matter and keeps those recordings: a link code, a question, its outcome, a PDF", async ({ page }) => {
    const tag = newTag();
    const calls = () => page.evaluate(() => ((window as any).clarity.q as IArguments[]).map((a) => Array.from(a)));
    await page.goto(`/?layout=01&src=${tag}`);
    await ready(page);
    expect(await calls()).toContainEqual(["upgrade", "application link"]);
    const box = page.locator("[data-ask] input");
    await box.fill("What is the 2025 standard deduction for a single person?");
    await box.press("Enter");
    await expect(page.locator("[data-stage] .top .mono")).toContainText("live answer");
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator('[data-stage] .answer-card a[href*="irs.gov"]').first().click()]);
    await popup.close();
    const c = await calls();
    for (const call of [["event", "asked_question"], ["upgrade", "asked a question"], ["event", "answer_answered"], ["event", "opened_pdf"]]) expect(c).toContainEqual(call);
    // the one-column layouts report the outcome too
    await page.goto(`/?layout=07&src=${tag}`);
    await ready(page);
    await page.locator("#q").fill("Show me an error");
    await page.locator("#go").click();
    await expect(page.locator("#result")).toContainText("The model is unavailable right now");
    expect(await calls()).toContainEqual(["event", "answer_error"]);
  });

  test("a live question is hidden from Clarity's recordings; a recorded example is not", async ({ page }) => {
    await page.goto("/?layout=01");
    await ready(page);
    await expect(page.locator('[data-stage] .answer-card .q')).not.toHaveAttribute("data-clarity-mask", "true");
    const box = page.locator("[data-ask] input");
    await box.fill("What is the 2025 standard deduction for a single person?");
    await box.press("Enter");
    await expect(page.locator("[data-stage] .top .mono")).toContainText("live answer");
    await expect(page.locator('[data-stage] .answer-card .q')).toHaveAttribute("data-clarity-mask", "true");
  });

  test("with Global Privacy Control or ?track=off: no visitor id, no Clarity, no events", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
    const tag = newTag();
    await page.goto(`/?src=${tag}`);
    await ready(page);
    expect(await page.evaluate(() => [localStorage.getItem("rag-vid"), !!document.getElementById("clarity-script"), typeof (window as any).clarity])).toEqual([null, false, "undefined"]);
    const tag2 = newTag();
    const other = await page.context().newPage(); // no GPC here: ?track=off alone
    await other.goto(`/?track=off&src=${tag2}`);
    await ready(other);
    expect(await other.evaluate(() => [localStorage.getItem("rag-vid"), !!document.getElementById("clarity-script")])).toEqual([null, false]);
    expect(await sent(page, tag)).toEqual([]);
    expect(await sent(page, tag2)).toEqual([]);
    await other.close();
  });
});
