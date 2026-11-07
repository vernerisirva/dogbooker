import { pool } from "../src/db";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { writeFile, mkdir } from "node:fs/promises";
export async function assertTestDatabase() {
  if (process.env.GMAIL_APP_PASSWORD?.trim())
    throw new Error("Refusing fixtures with outbound email credentials configured.");
  const url = process.env.DATABASE_URL;
  if (
    process.env.ALLOW_TEST_DATABASE !== "true" ||
    !url ||
    new URL(url).hostname !== process.env.TEST_DATABASE_HOST
  )
    throw new Error(
      "Tests require ALLOW_TEST_DATABASE=true and an exact TEST_DATABASE_HOST match. Never use production.",
    );
  const real = await pool.query(
    "SELECT count(*)::int AS n FROM users WHERE email NOT LIKE '%@example.test'",
  );
  if (real.rows[0].n)
    throw new Error("Refusing fixtures: database contains non-test accounts.");
}
export async function seedTestDatabase() {
  await assertTestDatabase();
  const c = await pool.connect();
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  try {
    await c.query("BEGIN");
    // All rows here belong to the isolated test database, checked above.
    await c.query("DELETE FROM notification_jobs");
    await c.query("DELETE FROM time_window_overrides");
    await c.query(
      "UPDATE time_window_settings SET revision=0,arrival_start='06:00',arrival_end='23:00',pickup_start='06:00',pickup_end='23:00'",
    );
    await c.query("DELETE FROM entries");
    await c.query("DELETE FROM users");
    await c.query("DELETE FROM auth_rate_limits");
    const people = [
      {
        name: "Test Sitter",
        email: "admin@example.test",
        role: "admin",
        dog: null,
      },
      {
        name: "Owner Alice",
        email: "alice@example.test",
        role: "owner",
        dog: "Luna",
      },
      {
        name: "Owner Bob",
        email: "bob@example.test",
        role: "owner",
        dog: "Milo",
      },
    ];
    const accounts = [];
    for (const person of people) {
      const {
        rows: [u],
      } = await c.query(
        "INSERT INTO users(name,email,role,dog_name,email_verified) VALUES($1,$2,$3,$4,true) RETURNING id",
        [person.name, person.email, person.role, person.dog],
      );
      await c.query(
        "INSERT INTO auth_accounts(account_id,provider_id,user_id,password) VALUES($1::text,'credential',$1::uuid,$2)",
        [u.id, hash],
      );
      accounts.push({ ...person, id: u.id, password });
    }
    await c.query("COMMIT");
    await mkdir(".local", { recursive: true });
    await writeFile(".local/test-accounts.json", JSON.stringify(accounts), {
      mode: 0o600,
    });
    return accounts;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
if (process.argv[1]?.endsWith("test-database.ts"))
  seedTestDatabase()
    .then(() =>
      console.log(
        "Isolated test fixtures prepared; credentials kept in .local.",
      ),
    )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
