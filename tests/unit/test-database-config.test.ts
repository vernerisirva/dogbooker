import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testDatabaseConfig } from "../../src/lib/test-database-config";
import { migrate } from "../../scripts/migrate";
const url = "postgresql://dogbooker:synthetic@127.0.0.1:54329/dogbooker";
beforeEach(() => {
  vi.stubEnv("ALLOW_TEST_DATABASE", "true");
  vi.stubEnv("TEST_DATABASE_HOST", "127.0.0.1");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", url);
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  "dogbooker",
  "dogbooker_standalone",
  "dogbooker_test",
  "isolated_ci_test",
])("accepts supported local test identity %s", (name) => {
  const value = url.replace(/\/dogbooker$/, `/${name}`);
  vi.stubEnv("DATABASE_URL", value);
  vi.stubEnv("DATABASE_URL_UNPOOLED", value);
  expect(testDatabaseConfig().database).toBe(name);
});
it.each([
  ["DATABASE_URL", url + "?host=production.invalid"],
  ["DATABASE_URL_UNPOOLED", url + "?user=admin"],
  ["DATABASE_URL", url.replace("127.0.0.1", "remote.invalid")],
  ["DATABASE_URL_UNPOOLED", url.replace(/\/dogbooker$/, "/other_test")],
  ["DATABASE_URL_UNPOOLED", url.replace("54329", "5432")],
  ["DATABASE_URL", url.replace("54329", "0")],
  ["DATABASE_URL_UNPOOLED", url.replace("dogbooker:", "admin:")],
  ["TEST_DATABASE_HOST", "remote.invalid"],
  ["ALLOW_TEST_DATABASE", "false"],
  ["GMAIL_APP_PASSWORD", "synthetic-outbound-password"],
  ["PGOPTIONS", "-c role=admin"],
])("rejects unsafe inherited test configuration %s", (key, value) => {
  vi.stubEnv(key, value);
  expect(testDatabaseConfig).toThrow();
});
it("rejects a remote migration function argument even with safe environment URLs", () => {
  expect(() =>
    testDatabaseConfig(url.replace("127.0.0.1", "remote.invalid")),
  ).toThrow();
});
it.each(["true", "false"])(
  "rejects malformed migration input without leaking credentials in test mode %s",
  async (mode) => {
    vi.stubEnv("ALLOW_TEST_DATABASE", mode);
    const secret = "synthetic-private-password";
    const error = await migrate(`postgresql://u:${secret}@bad%host/db`).catch(
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("input");
    expect(error).not.toHaveProperty("cause");
  },
);
