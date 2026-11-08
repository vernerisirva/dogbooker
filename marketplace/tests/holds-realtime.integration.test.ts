import { expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { localAdminConfig } from "../scripts/local-admin";

it("hides overdue care under the unmodified database clock before cleanup", async () => {
  const name = `mp_acceptance_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool(localAdminConfig("postgres"));
  const db = new Pool({ ...localAdminConfig(name), statement_timeout: 5000 });
  let created = false;
  async function acting(actor: string, sql: string, args: unknown[] = []) {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE marketplace_app");
      await c.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      const result = await c.query(sql, args);
      await c.query("COMMIT");
      return result.rows;
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }
  try {
    await control.query(`CREATE DATABASE ${name}`);
    created = true;
    for (const file of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const owner = randomUUID(),
      sitter = randomUUID(),
      outsider = randomUUID();
    for (const id of [owner, sitter, outsider])
      await db.query(
        "INSERT INTO \"user\"(id,name,email) VALUES($1,'Synthetic review',$2)",
        [id, `${id}@example.test`],
      );
    const sid = (
      await acting(sitter, "SELECT save_sitter($1) AS id", [
        {
          name: "Synthetic sitter",
          area: "Stockholm",
          latitude: 59.33,
          longitude: 18.07,
          radiusKm: 20,
          description: "",
          sizes: ["small"],
          experienceYears: 1,
          dailyPrice: 40000,
          capacity: 1,
          residentDogs: false,
          services: [],
          preferences: [],
        },
      ])
    )[0].id;
    const dog = (
      await acting(owner, "SELECT save_dog($1) AS id", [
        {
          name: "Synthetic dog",
          size: "small",
          ageYears: 2,
          breed: "",
          social: true,
          requirements: [],
          preferences: [],
          careNotes: "SYNTHETIC PRIVATE",
        },
      ])
    )[0].id;
    const day = (
      await db.query(
        "SELECT ((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date+20)::text AS day",
      )
    ).rows[0].day;
    await acting(sitter, "SELECT set_availability($1,$1,true)", [day]);
    await db.query("UPDATE booking_hold_policy SET duration_seconds=2");
    const id = (
      await acting(owner, "SELECT request_booking($1) AS id", [
        {
          sitterId: sid,
          dogIds: [dog],
          startDate: day,
          endDate: day,
          requestKey: randomUUID(),
          expectedDailyPrice: 40000,
          latitude: 59.33,
          longitude: 18.07,
        },
      ])
    )[0].id;
    const care = "SELECT booking_id FROM booking_dogs WHERE booking_id=$1";
    expect(await acting(sitter, care, [id])).toHaveLength(1);

    // Observe PostgreSQL's exact deadline; the delay only yields between checks.
    const until = Date.now() + 5000;
    for (;;) {
      const due = (
        await db.query(
          "SELECT expires_at<=clock_timestamp() AS due FROM bookings WHERE id=$1",
          [id],
        )
      ).rows[0].due;
      if (due) break;
      if (Date.now() >= until)
        throw new Error("Database hold deadline did not arrive");
      await setTimeout(10);
    }
    expect(await acting(sitter, care, [id])).toEqual([]);
    expect(await acting(owner, care, [id])).toHaveLength(1);
    expect(
      await acting(outsider, "SELECT id FROM bookings WHERE id=$1", [id]),
    ).toEqual([]);
    expect(
      (await db.query("SELECT status FROM bookings WHERE id=$1", [id])).rows[0]
        .status,
    ).toBe("pending");
    expect((await acting("", "SELECT expire_booking_holds(1) AS n"))[0].n).toBe(
      1,
    );
    expect(
      (await db.query("SELECT status,revision FROM bookings WHERE id=$1", [id]))
        .rows[0],
    ).toEqual({ status: "expired", revision: 1 });
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM reservations WHERE booking_id=$1 AND active",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM booking_dogs WHERE booking_id=$1 AND active",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await acting("", "SELECT expire_booking_holds(1) AS n"))[0].n).toBe(
      0,
    );
  } finally {
    await db.end();
    if (created) await control.query(`DROP DATABASE ${name}`);
    await control.end();
  }
});
