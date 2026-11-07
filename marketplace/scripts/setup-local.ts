import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import { userInfo } from "node:os";
// Fixed Unix socket and database names: this command cannot target a remote deployment.
const admin = new Pool({
  host: "/tmp/dogbooker-marketplace-pg",
  port: 55438,
  user: userInfo().username,
  database: "postgres",
});
try {
  try {
    await access(".env.local");
    throw new Error(".env.local already exists; reuse db:migrate and db:seed.");
  } catch (e) {
    if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT"))
      throw e;
  }
  const exists = await admin.query(
    "SELECT datname FROM pg_database WHERE datname='dogbooker_marketplace'",
  );
  if (exists.rowCount)
    throw new Error(
      "Dedicated database already exists; refusing to replace data or credentials.",
    );
  const appPassword = randomBytes(32).toString("hex"),
    authPassword = randomBytes(32).toString("hex");
  // Only generated hex strings are interpolated; PostgreSQL does not parameterize role passwords.
  await admin.query(
    `CREATE ROLE marketplace_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${appPassword}'`,
  );
  await admin.query(
    `CREATE ROLE marketplace_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${authPassword}'`,
  );
  await admin.query("CREATE DATABASE dogbooker_marketplace");
  await admin.query("REVOKE ALL ON DATABASE dogbooker_marketplace FROM PUBLIC");
  await admin.query(
    "GRANT CONNECT ON DATABASE dogbooker_marketplace TO marketplace_app,marketplace_auth",
  );
  const env =
    [
      `MARKETPLACE_DATABASE_URL=postgresql://marketplace_app:${appPassword}@127.0.0.1:55438/dogbooker_marketplace`,
      `MARKETPLACE_AUTH_DATABASE_URL=postgresql://marketplace_auth:${authPassword}@127.0.0.1:55438/dogbooker_marketplace`,
      `MARKETPLACE_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
      "MARKETPLACE_ORIGIN=http://127.0.0.1:3100",
    ].join("\n") + "\n";
  await writeFile(".env.local", env, { flag: "wx", mode: 0o600 });
  console.log(
    "Created isolated local marketplace database and restricted roles. Credentials saved privately.",
  );
} finally {
  await admin.end();
}
