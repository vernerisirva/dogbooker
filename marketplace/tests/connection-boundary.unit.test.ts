import { afterEach, expect, it, vi } from "vitest";
import { Client, type ClientBase } from "pg";
import { localDatabase, type RuntimeRole } from "../lib/config";
import { localAdminConfig } from "../scripts/local-admin";
import { verifyRuntimeConnection } from "../lib/connection";

afterEach(() => vi.unstubAllEnvs());
const url = (role = "marketplace_app") =>
  `postgresql://${role}:synthetic%3Ap%40ss@127.0.0.1:55438/dogbooker_marketplace`;
it.each(["marketplace_app", "marketplace_auth"] as RuntimeRole[])(
  "builds explicit connection options for %s without a second URL parse",
  (role) => {
    const config = localDatabase(url(role), role);
    expect(config).not.toHaveProperty("connectionString");
    expect(new Client(config)).toMatchObject({
      host: "127.0.0.1",
      port: 55438,
      database: "dogbooker_marketplace",
      user: role,
      password: "synthetic:p@ss",
    });
  },
);
it.each([
  undefined,
  "",
  "not-a-url-with-synthetic-secret",
  url() + "?",
  url() + "#",
  url() + "?host=/tmp",
  url() + "?%68ost=remote.invalid",
  url() + "?user=marketplace_app&user=admin",
  url() + "?options=-c%20role%3Dadmin",
  url() + "?sslkey=/private/synthetic.key",
  url() + "#?host=remote.invalid",
  url().replace("postgresql:", "socket:"),
  url().replace("postgresql:", "https:"),
  url().replace("127.0.0.1", "localhost"),
  url().replace("127.0.0.1", "remote.invalid"),
  url().replace("55438", "5432"),
  url().replace("/dogbooker_marketplace", "/dogbooker_standalone"),
  url().replace("marketplace_app:", "marketplace_auth:"),
  url().replace(":synthetic%3Ap%40ss", ":"),
  url().replace("synthetic%3Ap%40ss", "%GG"),
  "\n" + url(),
  url() + "\t",
])("fails closed for unsupported URL/configuration %s", (value) => {
  expect(() => localDatabase(value, "marketplace_app")).toThrow();
});
it.each([
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGOPTIONS",
  "PGSSLMODE",
  "PGSSLNEGOTIATION",
  "PGREPLICATION",
  "NODE_PG_FORCE_NATIVE",
])("rejects inherited %s for runtime and admin tools", (key) => {
  vi.stubEnv(key, "synthetic-override");
  expect(() => localDatabase(url(), "marketplace_app")).toThrow();
  expect(() => localAdminConfig()).toThrow();
});
it("never falls back to generic URLs or another role and accepts local build/CI modes", () => {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://synthetic@remote.invalid/production",
  );
  vi.stubEnv(
    "DATABASE_URL_UNPOOLED",
    "postgresql://synthetic@remote.invalid/production",
  );
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CI", "true");
  expect(localDatabase(url(), "marketplace_app").host).toBe("127.0.0.1");
  expect(() => localDatabase(undefined, "marketplace_app")).toThrow();
  expect(() => localDatabase(url(), "admin" as RuntimeRole)).toThrow();
});
it("does not expose input credentials through parse errors", () => {
  const secret = "synthetic-sensitive-string";
  try {
    localDatabase(`postgresql://u:${secret}@bad%host/db`, "marketplace_app");
  } catch (e) {
    expect(String(e)).not.toContain(secret);
    expect(JSON.stringify(e)).not.toContain(secret);
    expect(e).not.toHaveProperty("input");
    expect(e).not.toHaveProperty("cause");
    return;
  }
  throw new Error("Expected rejection");
});
it("confines admin connections to fixed sockets and allowlisted database identities", () => {
  for (const name of [
    "postgres",
    "dogbooker_marketplace",
    `mp_blockers_${"a".repeat(32)}`,
  ]) {
    expect(new Client(localAdminConfig(name))).toMatchObject({
      host: "/tmp/dogbooker-marketplace-pg",
      port: 55438,
      database: name,
      password: "local-socket-only",
    });
  }
  for (const name of [
    "production",
    "dogbooker_standalone",
    "mp_blockers_bad",
    "postgres?host=remote.invalid",
  ])
    expect(() => localAdminConfig(name)).toThrow();
});
const identity = {
  db: "dogbooker_marketplace",
  role: "marketplace_app",
  login: "marketplace_app",
  host: "127.0.0.1",
  port: 55438,
  privileged: false,
};
it.each([
  { db: "other" },
  { role: "admin" },
  { login: "admin" },
  { host: "remote.invalid" },
  { port: 5432 },
  { privileged: true },
])("rejects an unexpected connected identity: %j", async (change) => {
  const c = {
    query: vi.fn().mockResolvedValue({ rows: [{ ...identity, ...change }] }),
  } as unknown as ClientBase;
  await expect(verifyRuntimeConnection(c, "marketplace_app")).rejects.toThrow(
    "identity",
  );
});
