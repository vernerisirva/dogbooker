import { defineConfig, devices } from "@playwright/test";
import { testDatabaseConfig } from "./src/lib/test-database-config";
if (process.env.BASE_URL)
  throw new Error("Browser fixtures require their own local test server.");
process.loadEnvFile(".env.local");
testDatabaseConfig();
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
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
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
