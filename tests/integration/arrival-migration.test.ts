import { it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@/db";
import { assertTestDatabase } from "../../scripts/test-database";
afterAll(() => pool.end());
it("preserves bookings, overlap protection and old notification history while versioning new events", async () => {
  await assertTestDatabase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("CREATE SCHEMA arrival_migration_rehearsal");
    await c.query(
      "SET LOCAL search_path=arrival_migration_rehearsal,pg_catalog",
    );
    for (const name of [
      "0001_existing_calendar.sql",
      "0002_private_auth.sql",
      "0003_approvals_notifications.sql",
      "0004_dog_specific_availability.sql",
    ])
      await c.query(await readFile(`drizzle/${name}`, "utf8"));
    const {
      rows: [owner],
    } = await c.query(
      "INSERT INTO users(name,email,role,dog_name) VALUES('Arrival fixture','arrival@example.test','owner','Luna') RETURNING id",
    );
    const {
      rows: [booking],
    } = await c.query(
      "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,note) VALUES('booking',$1,'2027-01-01','2027-01-03','confirmed','Private note') RETURNING id",
      [owner.id],
    );
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload,state,attempts) VALUES($1,'approved',$2,'arrival@example.test','{}','sent',1)",
      [booking.id, owner.id],
    );
    const snapshot = async () => {
      const r = [];
      for (const t of ["users", "entries", "notification_jobs"])
        r.push(
          (
            await c.query(
              `SELECT jsonb_agg(to_jsonb(t) - 'arrival_time' - 'arrival_revision' - 'event_version' ORDER BY id) AS data FROM ${t} t`,
            )
          ).rows[0].data,
        );
      return r;
    };
    const before = await snapshot();
    const constraint = (
      await c.query(
        "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='entries'::regclass AND contype='x'",
      )
    ).rows;
    await c.query(await readFile("drizzle/0005_arrival_times.sql", "utf8"));
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await c.query(
          "SELECT arrival_time,arrival_revision,booking_status FROM entries",
        )
      ).rows,
    ).toEqual([
      { arrival_time: null, arrival_revision: 0, booking_status: "confirmed" },
    ]);
    expect(
      (
        await c.query(
          "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='entries'::regclass AND contype='x'",
        )
      ).rows,
    ).toEqual(constraint);
    // The compatibility producer still deduplicates old event types after upgrade.
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload) VALUES($1,'approved',$2,'arrival@example.test','{}') ON CONFLICT DO NOTHING",
      [booking.id, owner.id],
    );
    expect(
      (await c.query("SELECT count(*)::int AS n FROM notification_jobs"))
        .rows[0].n,
    ).toBe(1);
    for (const version of [1, 1, 2])
      await c.query(
        "INSERT INTO notification_jobs(booking_id,event,event_version,recipient_id,recipient_email,payload) VALUES($1,'arrival_changed',$2,$3,'arrival@example.test','{}') ON CONFLICT DO NOTHING",
        [booking.id, version, owner.id],
      );
    expect(
      (
        await c.query(
          "SELECT event_version FROM notification_jobs WHERE event='arrival_changed' ORDER BY event_version",
        )
      ).rows,
    ).toEqual([{ event_version: 1 }, { event_version: 2 }]);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
