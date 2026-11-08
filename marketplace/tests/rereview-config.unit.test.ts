import { afterEach, expect, it, vi } from "vitest";
import { Client } from "pg";
import { localDatabase } from "../lib/config";
import { testDatabaseConfig } from "../../src/lib/test-database-config";

afterEach(() => vi.unstubAllEnvs());
const url =
  "postgresql://marketplace_app:synthetic@127.0.0.1:55438/dogbooker_marketplace";
it.each([
  url + "%3Fhost=remote.invalid",
  url + "/../production",
  url.replace("127.0.0.1", "127.0.0.1.remote.invalid"),
  url.replace("127.0.0.1", "127.1"),
  url.replace("127.0.0.1", "[::ffff:127.0.0.1]"),
  url.replace("55438", "65536"),
  url + ";host=remote.invalid",
  url.replace("marketplace_app:", "marketplace_app%00admin:"),
])("rejects alternate target encodings: %s", (value) => {
  expect(() => localDatabase(value, "marketplace_app")).toThrow();
});

it("keeps encoded URL delimiters inside credentials, without a second driver parse", () => {
  const password = "synthetic?host=remote.invalid#user=admin@/:%";
  const value = url
    .replace("marketplace_app:", "%6Darketplace_app:")
    .replace("synthetic", encodeURIComponent(password));
  const config = localDatabase(value, "marketplace_app");
  expect(new Client(config)).toMatchObject({
    host: "127.0.0.1",
    port: 55438,
    user: "marketplace_app",
    password,
    database: "dogbooker_marketplace",
  });
});

it.each([
  ["127.0.0.1", "127.0.0.1"],
  ["localhost", "localhost"],
  ["[::1]", "::1"],
])(
  "supports the explicit standalone loopback configuration %s",
  (authority, host) => {
    const value = `postgres://ci_user:synthetic@${authority}:5432/ci_test`;
    vi.stubEnv("ALLOW_TEST_DATABASE", "true");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    vi.stubEnv("TEST_DATABASE_HOST", host);
    vi.stubEnv("DATABASE_URL", value);
    vi.stubEnv("DATABASE_URL_UNPOOLED", value);
    expect(new Client(testDatabaseConfig())).toMatchObject({
      host,
      port: 5432,
      database: "ci_test",
      user: "ci_user",
    });
  },
);

it("does not inherit target overrides introduced after configuration validation", () => {
  const config = localDatabase(url, "marketplace_app");
  vi.stubEnv("PGHOST", "remote.invalid");
  vi.stubEnv("PGPORT", "5432");
  vi.stubEnv("PGUSER", "admin");
  vi.stubEnv("PGDATABASE", "production");
  vi.stubEnv("PGPASSWORD", "another-synthetic-password");
  vi.stubEnv("PGOPTIONS", "-c role=admin");
  const c = new Client(config);
  expect(c).toMatchObject({
    host: "127.0.0.1",
    port: 55438,
    user: "marketplace_app",
    database: "dogbooker_marketplace",
    password: "synthetic",
  });
  expect(c).toMatchObject({
    connectionParameters: { options: "-c search_path=public,pg_catalog" },
  });
});
