// Browser tests for the demo page (e2e/*.e2e.ts), against e2e/serve.mjs: the same files the Worker serves, and
// an /api/ask stand-in, so no model is called. Desktop and phone sizes. Run: npm run e2e
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 8787);

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts", // not *.spec.ts: vitest would pick those up as its own tests
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: "reduce", // still frames: no test waits on an animation
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
