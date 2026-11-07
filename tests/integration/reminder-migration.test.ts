import { it, expect, afterAll } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { pool } from "@/db";
import { assertTestDatabase } from "../../scripts/test-database";
afterAll(() => pool.end());
it("preserves legacy times/history and backfills only the latest rejected fields", async () => {
  await assertTestDatabase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("CREATE SCHEMA reminder_migration_rehearsal");
    await c.query(
      "SET LOCAL search_path=reminder_migration_rehearsal,pg_catalog",
    );
    for (const f of (await readdir("drizzle"))
      .filter((f) => f.endsWith(".sql") && f < "0009")
      .sort())
      await c.query(await readFile(`drizzle/${f}`, "utf8"));
    const owner = (
      await c.query(
        "INSERT INTO users(name,email,role,dog_name) VALUES('Fixture','reminder@example.test','owner','Luna') RETURNING id",
      )
    ).rows[0].id;
    const id = (
      await c.query(
        "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,arrival_time,pickup_time,arrival_revision) VALUES('booking',$1,'2028-01-01','2028-01-02','confirmed','08:00','18:00',2) RETURNING id",
        [owner],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO booking_time_proposals(booking_id,revision,proposer_role,status,current_arrival,current_pickup,proposed_arrival,proposed_pickup) VALUES($1,1,'owner','declined','08:00','18:00','09:00','18:00')",
      [id],
    );
    await c.query(
      "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload,state) VALUES($1,'approved',$2,'reminder@example.test','{}','sent')",
      [id, owner],
    );
    const snapshot = async () => {
      const values = [];
      for (const t of [
        "users",
        "entries",
        "notification_jobs",
        "booking_time_proposals",
      ])
        values.push(
          (
            await c.query(
              `SELECT jsonb_agg(to_jsonb(t)-'arrival_resubmission_required'-'pickup_resubmission_required'-'requests_arrival'-'requests_pickup' ORDER BY id) data FROM ${t} t`,
            )
          ).rows[0].data,
        );
      return values;
    };
    const before = await snapshot();
    await c.query(
      await readFile("drizzle/0009_independent_time_reminders.sql", "utf8"),
    );
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await c.query(
          "SELECT arrival_resubmission_required,pickup_resubmission_required FROM entries",
        )
      ).rows[0],
    ).toEqual({
      arrival_resubmission_required: true,
      pickup_resubmission_required: false,
    });
    for (const event of ["dropoff_reminder", "pickup_reminder"])
      await c.query(
        "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload) VALUES($1,$2,$3,'reminder@example.test','{}')",
        [id, event, owner],
      );
    await c.query("SAVEPOINT duplicate");
    await expect(
      c.query(
        "INSERT INTO notification_jobs(booking_id,event,recipient_id,recipient_email,payload) VALUES($1,'dropoff_reminder',$2,'reminder@example.test','{}')",
        [id, owner],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await c.query("ROLLBACK TO SAVEPOINT duplicate");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
