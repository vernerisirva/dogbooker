import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function migrate(
  connectionString = process.env.DATABASE_URL_UNPOOLED,
) {
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required.");
  if (new URL(connectionString).hostname.includes("-pooler"))
    throw new Error("Migrations require the direct database connection.");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(731042)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("drizzle"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(`drizzle/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM app_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Migration ${name} changed after application`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO app_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      console.log(`Applied ${name}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("migrate.ts"))
  migrate().catch(() => {
    console.error(
      "Migration failed. Check connectivity and schema compatibility; credentials were not logged.",
    );
    process.exitCode = 1;
  });
