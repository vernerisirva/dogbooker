import { defineConfig, devices } from "@playwright/test";
// Preserve explicit environment overrides and support standard quoted/unquoted .env syntax.
if (!process.env.BASE_URL) process.loadEnvFile(".env.local");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000/login",
        reuseExistingServer: false,
        timeout: 120000,
      },
});
