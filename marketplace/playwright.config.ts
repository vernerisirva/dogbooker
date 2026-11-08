import { defineConfig, devices } from "@playwright/test";
import { localDatabase, localOrigin } from "./lib/config";
process.loadEnvFile(".env.local");
localDatabase(process.env.MARKETPLACE_DATABASE_URL, "marketplace_app");
localDatabase(process.env.MARKETPLACE_AUTH_DATABASE_URL, "marketplace_auth");
localOrigin();
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
