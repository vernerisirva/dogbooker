import { it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@/db";
import { assertTestDatabase } from "../../scripts/test-database";
afterAll(() => pool.end());
it("preserves legacy confirmed/pending/inactive bookings and notification history during replacement", async () => {
  await assertTestDatabase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Transaction-local schema: historical migrations and fixtures never touch
    // the application tables, and ROLLBACK removes the entire rehearsal.
    await c.query("CREATE SCHEMA shared_migration_rehearsal");
    await c.query(
      "SET LOCAL search_path=shared_migration_rehearsal,pg_catalog",
    );
    for (const name of [
      "0001_existing_calendar.sql",
      "0002_private_auth.sql",
      "0003_approvals_notifications.sql",
    ])
      await c.query(await readFile(`drizzle/${name}`, "utf8"));
    const {
      rows: [owner],
    } = await c.query(
      "INSERT INTO users(name,email,role,dog_name) VALUES('Migration fixture','migration@example.test','owner','Luna') RETURNING id",
    );
    for (const [i, status] of [
      "confirmed",
      "pending",
      "declined",
      "cancelled",
    ].entries()) {
      const {
        rows: [entry],
      } = await c.query(
        "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,note) VALUES('booking',$1,DATE '2027-01-01'+$2::int,DATE '2027-01-01'+$2::int,$3,'Private historical note') RETURNING id",
        [owner.id, i, status],
      );
      await c.query(
        "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload,state,attempts,provider_id) VALUES($1,'requested',$2,'migration@example.test',$3,'sent',1,'previous-message')",
        [
          entry.id,
          owner.id,
          { subject: "Bokningsförfrågan", text: "Historiskt meddelande" },
        ],
      );
    }
    await c.query(
      "INSERT INTO entries(kind,start_date,end_date,note) VALUES('block','2027-02-01','2027-02-02','Private block')",
    );
    const snapshot = async () => {
      const result = [];
      for (const table of ["users", "entries", "notification_jobs"])
        result.push(
          (
            await c.query(
              `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS data FROM ${table} t`,
            )
          ).rows[0].data,
        );
      return result;
    };
    const before = await snapshot();
    await c.query(
      await readFile("drizzle/0004_dog_specific_availability.sql", "utf8"),
    );
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await c.query(
          "SELECT booking_status FROM entries WHERE kind='booking' ORDER BY start_date",
        )
      ).rows.map((r) => r.booking_status),
    ).toEqual(["confirmed", "pending", "declined", "cancelled"]);
    await c.query("SAVEPOINT conflict_check");
    await expect(
      c.query(
        "INSERT INTO entries(kind,owner_id,start_date,end_date) VALUES('booking',$1,'2027-01-01','2027-01-01')",
        [owner.id],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
    await c.query("ROLLBACK TO SAVEPOINT conflict_check");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
