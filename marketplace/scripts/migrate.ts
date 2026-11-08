import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { adminPool } from "./local-admin";
export { adminPool } from "./local-admin";
export async function migrate() {
  const pool = adminPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(731044)");
    if (
      (await c.query("SELECT to_regclass('public.entries') AS legacy")).rows[0]
        .legacy
    )
      throw new Error("Refusing standalone database.");
    await c.query(
      "CREATE TABLE IF NOT EXISTS marketplace_migrations(name text PRIMARY KEY,checksum text NOT NULL)",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(
        new URL(`../migrations/${name}`, import.meta.url),
        "utf8",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = (
        await c.query(
          "SELECT checksum FROM marketplace_migrations WHERE name=$1",
          [name],
        )
      ).rows[0];
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await c.query(sql);
      await c.query("INSERT INTO marketplace_migrations VALUES($1,$2)", [
        name,
        checksum,
      ]);
      console.log(`Applied ${name}`);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("/migrate.ts")) await migrate();
