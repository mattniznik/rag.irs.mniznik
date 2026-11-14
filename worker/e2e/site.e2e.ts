// Browser tests for the demo page: the seven layouts, the Studio (picking, saving, links, keyboard) and the ask
// boxes' live, busy and error replies. They run against e2e/serve.mjs (the page's own files and an /api/ask
// stand-in), at desktop and phone size (playwright.config.ts). Third-party requests are blocked, so nothing
// here depends on the network.
import { expect, test, type Page } from "@playwright/test";

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
