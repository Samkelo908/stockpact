import { defineConfig, devices } from "@playwright/test";

const port = 3147;
const origin = "http://localhost:" + port;
const channel = process.env.STOCKPACT_BROWSER_CHANNEL ??
  (process.platform === "win32" ? "msedge" : "chromium");
const browser = channel === "chromium" ? {} : { channel };

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: origin, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...browser } },
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", ...browser } },
  ],
  webServer: {
    command: "npm run dev -- --port " + port,
    url: origin + "/api/state",
    timeout: 120000,
    env: {
      STOCKPACT_DEMO: "true",
      STOCKPACT_DB_PATH: ".stockpact/test-db-" + Date.now(),
      STOCKPACT_FILE_PATH: ".stockpact/test-attachments",
      STOCKPACT_ESCROW_MODE: "demo",
      BETTER_AUTH_URL: origin,
      DATABASE_URL: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_API_TOKEN: "",
      STOCKPACT_R2_ACCOUNT_ID: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
