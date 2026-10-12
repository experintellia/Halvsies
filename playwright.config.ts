// End-to-end tests: the real app in real browser engines, against the vite dev
// server and its mock webxdc host (@webxdc/vite-plugins). The mock keeps the
// update log in localStorage and syncs peers through `storage` events, so two
// pages in one browser context are two people in one chat — and a fresh
// context per test is a fresh chat.
//
// Two engines because those are what Halvsies actually runs in: Delta Chat on
// Android is a Chromium WebView, on iOS it is WKWebView (WebKit).
import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "ios", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
