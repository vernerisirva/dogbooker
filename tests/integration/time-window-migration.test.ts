import { it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@/db";
import { assertTestDatabase } from "../../scripts/test-database";
afterAll(() => pool.end());
it("preserves legacy values and outbox history, enforces one open proposal and invalidates it on date changes", async () => {
  await assertTestDatabase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("CREATE SCHEMA time_window_migration_rehearsal");
    await c.query(
      "SET LOCAL search_path=time_window_migration_rehearsal,pg_catalog",
    );
    for (const file of [
      "0001_existing_calendar.sql",
      "0002_private_auth.sql",
      "0003_approvals_notifications.sql",
      "0004_dog_specific_availability.sql",
      "0005_arrival_times.sql",
      "0006_cancellation_history.sql",
    ])
      await c.query(await readFile(`drizzle/${file}`, "utf8"));
    const owner = (
      await c.query(
        "INSERT INTO users(name,email,role,dog_name) VALUES('Fixture','windows@example.test','owner','Luna') RETURNING id",
      )
    ).rows[0].id;
    const id = (
      await c.query(
        "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,arrival_time) VALUES('booking',$1,'2028-01-01','2028-01-02','confirmed','05:00') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    await c.query(await readFile("drizzle/0007_pickup_times.sql", "utf8"));
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload,state) VALUES($1,'approved',$2,'windows@example.test','{}','sent')",
      [id, owner],
    );
    const snapshot = async () => {
      const rows = [];
      for (const table of ["users", "entries", "notification_jobs"])
        rows.push(
          (
            await c.query(
              `SELECT jsonb_agg(to_jsonb(t) ORDER BY id) data FROM ${table} t`,
            )
          ).rows[0].data,
        );
      return rows;
    };
    const before = await snapshot();
    await c.query(
      await readFile("drizzle/0008_time_windows_and_proposals.sql", "utf8"),
    );
    expect(await snapshot()).toEqual(before);
    await c.query(
      "INSERT INTO booking_time_proposals(booking_id,revision,proposer_role,current_arrival,proposed_arrival,proposed_pickup) VALUES($1,1,'owner','05:00','05:00','18:00')",
      [id],
    );
    await c.query("SAVEPOINT duplicate");
    await expect(
      c.query(
        "INSERT INTO booking_time_proposals(booking_id,revision,proposer_role) VALUES($1,2,'owner')",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT duplicate");
    // Explicit admin approval can retain an unchanged grandfathered arrival.
    await c.query(
      "UPDATE booking_time_proposals SET status='approved' WHERE booking_id=$1",
      [id],
    );
    await c.query(
      "UPDATE entries SET arrival_time=arrival_time,pickup_time='18:00',arrival_revision=2 WHERE id=$1",
      [id],
    );
    await c.query(
      "INSERT INTO booking_time_proposals(booking_id,revision,proposer_role,current_arrival,proposed_arrival) VALUES($1,3,'owner','05:00','08:00')",
      [id],
    );
    await c.query("UPDATE entries SET start_date='2028-01-02' WHERE id=$1", [
      id,
    ]);
    expect(
      (
        await c.query(
          "SELECT status FROM booking_time_proposals WHERE revision=3",
        )
      ).rows[0].status,
    ).toBe("superseded");
    expect(
      (
        await c.query(
          "SELECT arrival_time,arrival_revision FROM entries WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({ arrival_time: "05:00:00", arrival_revision: 3 });
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
