import { it, expect } from "vitest";
import { Pool } from "pg";
import { localAdminConfig } from "../scripts/local-admin";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { addDays, todayStockholm } from "../lib/dates";
it("installs fresh and preserves populated reservations when converting ranges to daily slots", async () => {
  const control = new Pool(localAdminConfig("postgres"));
  const name = `mp_migration_${randomUUID().replaceAll("-", "")}`;
  await control.query(`CREATE DATABASE ${name}`);
  const db = new Pool(localAdminConfig(name));
  try {
    for (const file of ["0001_foundation.sql", "0002_auth_uuid_defaults.sql"])
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const owner = randomUUID(),
      sitter = randomUUID(),
      sid = randomUUID(),
      dogs = [randomUUID(), randomUUID()];
    const a = addDays(todayStockholm(), 20),
      b = addDays(todayStockholm(), 22);
    await db.query(
      `INSERT INTO "user"(id,name,email) VALUES($1,'Synthetic owner','owner@example.test'),($2,'Synthetic sitter','sitter@example.test')`,
      [owner, sitter],
    );
    await db.query(
      "INSERT INTO sitters(id,user_id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences) VALUES($1,$2,'Migration sitter','Stockholm',59.33,18.07,20,'',ARRAY['small'],3,40000,3,false,'{}','{}')",
      [sid, sitter],
    );
    for (const dog of dogs)
      await db.query(
        "INSERT INTO dogs(id,owner_id,name,size,age_years,social,requirements,preferences,care_notes) VALUES($1,$2,'Synthetic','small',3,true,'{}','{}','PRIVATE SNAPSHOT')",
        [dog, owner],
      );
    await db.query(
      "INSERT INTO availability SELECT $1::uuid,$2::date+i FROM generate_series(0,2) i",
      [sid, a],
    );
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_id',$1,true)", [owner]);
      await client.query("SELECT request_booking($1)", [
        {
          sitterId: sid,
          dogIds: dogs,
          startDate: a,
          endDate: b,
          requestKey: randomUUID(),
          expectedDailyPrice: 40000,
          latitude: 59.33,
          longitude: 18.07,
        },
      ]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const snapshot = async () => ({
      sitters: (
        await db.query("SELECT to_jsonb(s) data FROM sitters s ORDER BY id")
      ).rows,
      availability: (
        await db.query(
          "SELECT to_jsonb(a) data FROM availability a ORDER BY sitter_id,day",
        )
      ).rows,
      bookings: (
        await db.query("SELECT to_jsonb(b) data FROM bookings b ORDER BY id")
      ).rows,
      care: (
        await db.query(
          "SELECT to_jsonb(d) data FROM booking_dogs d ORDER BY dog_id",
        )
      ).rows,
    });
    const before = await snapshot();
    expect(
      (await db.query("SELECT count(*)::int n FROM reservations")).rows[0].n,
    ).toBe(2);
    const occupancy = (
      await db.query(
        "SELECT (start_date+i)::text AS date_key,count(*)::int n FROM reservations CROSS JOIN LATERAL generate_series(0,end_date-start_date) i GROUP BY 1 ORDER BY 1",
      )
    ).rows;
    for (const file of [
      "0003_daily_inventory.sql",
      "0004_review_hardening.sql",
      "0005_post_write_date_check.sql",
      "0006_inventory_snapshot_fence.sql",
    ])
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    expect(await snapshot()).toEqual(before);
    expect(
      (await db.query("SELECT count(*)::int n FROM reservations")).rows[0].n,
    ).toBe(6);
    expect(
      (
        await db.query(
          "SELECT start_date::text AS date_key,count(*)::int n FROM reservations GROUP BY 1 ORDER BY 1",
        )
      ).rows,
    ).toEqual(occupancy);
    expect(
      (await db.query("SELECT 1 FROM reservations WHERE start_date<>end_date"))
        .rowCount,
    ).toBe(0);
  } finally {
    await db.end();
    await control.query(`DROP DATABASE ${name}`);
    await control.end();
  }
});
