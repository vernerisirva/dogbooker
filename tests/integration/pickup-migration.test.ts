import { it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@/db";
import { assertTestDatabase } from "../../scripts/test-database";
afterAll(() => pool.end());
it("preserves legacy arrivals/history and restricts new values without breaking unrelated edits", async () => {
  await assertTestDatabase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("CREATE SCHEMA pickup_migration_rehearsal");
    await c.query(
      "SET LOCAL search_path=pickup_migration_rehearsal,pg_catalog",
    );
    for (const name of [
      "0001_existing_calendar.sql",
      "0002_private_auth.sql",
      "0003_approvals_notifications.sql",
      "0004_dog_specific_availability.sql",
      "0005_arrival_times.sql",
      "0006_cancellation_history.sql",
    ])
      await c.query(await readFile(`drizzle/${name}`, "utf8"));
    const owner = (
      await c.query(
        "INSERT INTO users(name,email,role,dog_name) VALUES('Fixture','pickup@example.test','owner','Luna') RETURNING id",
      )
    ).rows[0];
    const early = (
      await c.query(
        "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,arrival_time) VALUES('booking',$1,'2027-01-01','2027-01-01','pending','05:00') RETURNING id",
        [owner.id],
      )
    ).rows[0].id;
    const late = (
      await c.query(
        "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,arrival_time) VALUES('booking',$1,'2027-02-01','2027-02-02','confirmed','23:45') RETURNING id",
        [owner.id],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload,state,attempts) VALUES($1,'approved',$2,'pickup@example.test','{}','sent',1)",
      [late, owner.id],
    );
    const snapshot = async () => {
      const rows = [];
      for (const t of ["users", "entries", "notification_jobs"])
        rows.push(
          (
            await c.query(
              `SELECT jsonb_agg(to_jsonb(t)-'pickup_time' ORDER BY id) AS data FROM ${t} t`,
            )
          ).rows[0].data,
        );
      return rows;
    };
    const before = await snapshot();
    const constraint = (
      await c.query(
        "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='entries'::regclass AND contype='x'",
      )
    ).rows;
    await c.query(await readFile("drizzle/0007_pickup_times.sql", "utf8"));
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await c.query(
          "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='entries'::regclass AND contype='x'",
        )
      ).rows,
    ).toEqual(constraint);
    expect(
      (
        await c.query(
          "SELECT count(*)::int n FROM entries WHERE pickup_time IS NOT NULL",
        )
      ).rows[0].n,
    ).toBe(0);
    // Same SQL shape as partial time edits: unchanged legacy arrival passes.
    await c.query(
      "UPDATE entries SET arrival_time=arrival_time,pickup_time='18:00',arrival_revision=arrival_revision+1 WHERE id=$1",
      [early],
    );
    await c.query(
      "UPDATE entries SET pickup_time='06:00',note='changed' WHERE id=$1",
      [late],
    );
    await c.query("UPDATE entries SET booking_status='confirmed' WHERE id=$1", [
      early,
    ]);
    await c.query("UPDATE entries SET booking_status='cancelled' WHERE id=$1", [
      early,
    ]);
    expect(
      (
        await c.query(
          "SELECT arrival_time,cancelled_at FROM entries WHERE id=$1",
          [early],
        )
      ).rows[0],
    ).toMatchObject({
      arrival_time: "05:00:00",
      cancelled_at: expect.any(Date),
    });
    const rejects = async (sql: string, values: unknown[] = []) => {
      await c.query("SAVEPOINT invalid");
      await expect(c.query(sql, values)).rejects.toMatchObject({
        code: "23514",
      });
      await c.query("ROLLBACK TO SAVEPOINT invalid");
    };
    await rejects("UPDATE entries SET arrival_time='05:15' WHERE id=$1", [
      late,
    ]);
    await rejects("UPDATE entries SET end_date=start_date WHERE id=$1", [late]);
    await rejects(
      "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,arrival_time) VALUES('booking',$1,'2027-03-01','2027-03-01','pending','05:00')",
      [owner.id],
    );
    await c.query(
      "UPDATE entries SET arrival_time='08:00',pickup_time='18:00',end_date=start_date WHERE id=$1",
      [late],
    );
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,event_version,recipient_id,recipient_email,payload) VALUES($1,'times_changed',1,$2,'pickup@example.test','{}') ON CONFLICT DO NOTHING",
      [late, owner.id],
    );
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,event_version,recipient_id,recipient_email,payload) VALUES($1,'times_changed',1,$2,'pickup@example.test','{}') ON CONFLICT DO NOTHING",
      [late, owner.id],
    );
    expect(
      (await c.query("SELECT count(*)::int n FROM notification_jobs")).rows[0]
        .n,
    ).toBe(2);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
