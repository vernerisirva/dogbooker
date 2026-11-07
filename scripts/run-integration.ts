import { spawnSync } from "node:child_process";
import { assertTestDatabase } from "./test-database";
import { pool } from "../src/db";
async function run() {
  await assertTestDatabase();
  await pool.end();
  const result = spawnSync(
    "node",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.integration.config.ts",
    ],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = result.status ?? 1;
}
run().catch(() => {
  console.error(
    "Integration test safety check failed. Use an isolated test database with matching TEST_DATABASE_HOST.",
  );
  process.exitCode = 1;
  pool.end();
});
