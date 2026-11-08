import { expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { localAdminConfig } from "../scripts/local-admin";
import { addDays, todayStockholm } from "../lib/dates";

it("backfills every legacy pending row from migration, preserves history and rolls back/reapplies atomically", async () => {
  const name = `mp_migration_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool(localAdminConfig("postgres"));
  await control.query(`CREATE DATABASE ${name}`);
  const db = new Pool(localAdminConfig(name));
  try {
    const files = (await readdir(new URL("../migrations/", import.meta.url)))
      .filter((x) => x.endsWith(".sql"))
      .sort();
    for (const file of files.filter((x) => !x.startsWith("0007")))
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const owner = randomUUID(),
      sitter = randomUUID(),
      sid = randomUUID();
    await db.query(
      "INSERT INTO \"user\"(id,name,email) VALUES($1,'Owner','owner@example.test'),($2,'Sitter','sitter@example.test')",
      [owner, sitter],
    );
    await db.query(
      "INSERT INTO sitters(id,user_id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences) VALUES($1,$2,'Migration','Stockholm',59.33,18.07,20,'',ARRAY['small'],3,40000,10,false,'{}','{}')",
      [sid, sitter],
    );
    const ids: string[] = [];
    for (const [index, status] of [
      "pending",
      "pending",
      "pending",
      "confirmed",
      "declined",
      "cancelled",
    ].entries()) {
      const id = randomUUID(),
        dog = randomUUID();
      ids.push(id);
      const day = addDays(
        todayStockholm(),
        index === 1 ? 1 : index === 2 ? -10 : 20,
      );
      await db.query(
        "INSERT INTO dogs(id,owner_id,name,size,age_years,social,requirements,preferences) VALUES($1,$2,'Dog','small',3,true,'{}','{}')",
        [dog, owner],
      );
      await db.query(
        "INSERT INTO bookings(id,sitter_id,owner_id,start_date,end_date,status,request_key,payload,daily_price,total_price,revision,created_at) VALUES($1,$2,$3,$4,$4,$5,$6,'{}',40000,40000,$7,'2000-01-01Z')",
        [id, sid, owner, day, status, randomUUID(), index],
      );
      const active = ["pending", "confirmed"].includes(status);
      await db.query(
        'INSERT INTO booking_dogs VALUES($1,$2,$3,$4,$5,$5,$6,\'{"care_notes":"PRIVATE HISTORY"}\')',
        [id, sid, owner, dog, day, active],
      );
      await db.query("INSERT INTO reservations VALUES($1,$2,$3,$4,$5,$5,$6)", [
        id,
        sid,
        owner,
        index + 1,
        day,
        active,
      ]);
    }
    const snapshot = async () => ({
      bookings: (
        await db.query(
          "SELECT to_jsonb(b)-'expires_at'-'expired_at' AS data FROM bookings b ORDER BY id",
        )
      ).rows,
      dogs: (
        await db.query(
          "SELECT to_jsonb(d) AS data FROM booking_dogs d ORDER BY booking_id",
        )
      ).rows,
      reservations: (
        await db.query(
          "SELECT to_jsonb(r) AS data FROM reservations r ORDER BY booking_id",
        )
      ).rows,
    });
    const before = await snapshot();
    const sql = await readFile(
      new URL("../migrations/0007_expiring_holds.sql", import.meta.url),
      "utf8",
    );
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(sql);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='bookings' AND column_name='expires_at'",
        )
      ).rows[0].n,
    ).toBe(0);
    const lower = (await db.query("SELECT clock_timestamp() AS t")).rows[0].t;
    await db.query(sql);
    const upper = (await db.query("SELECT clock_timestamp() AS t")).rows[0].t;
    expect(await snapshot()).toEqual(before);
    const rows = (
      await db.query("SELECT id,status,expires_at,expired_at FROM bookings")
    ).rows;
    for (const b of rows) {
      expect(b.expired_at).toBeNull();
      if (b.status === "pending") {
        expect(b.expires_at.getTime()).toBeGreaterThanOrEqual(
          lower.getTime() + 172800000,
        );
        expect(b.expires_at.getTime()).toBeLessThanOrEqual(
          upper.getTime() + 172800000 + 1,
        );
      } else expect(b.expires_at).toBeNull();
    }
    const acting = await db.connect();
    try {
      await acting.query("BEGIN");
      await acting.query("SET LOCAL ROLE marketplace_app");
      await acting.query("SELECT set_config('app.actor_id',$1,true)", [sitter]);
      await expect(
        acting.query("SELECT decide_booking($1,'confirmed',2)", [ids[2]]),
      ).rejects.toMatchObject({ code: "P0003" });
      await acting.query("ROLLBACK");
      await acting.query("BEGIN");
      await acting.query("SET LOCAL ROLE marketplace_app");
      await acting.query("SELECT set_config('app.actor_id',$1,true)", [owner]);
      await acting.query("SELECT decide_booking($1,'cancelled',2)", [ids[2]]);
      await acting.query("COMMIT");
    } finally {
      await acting.query("ROLLBACK");
      acting.release();
    }
    expect(
      (
        await db.query("SELECT status,revision FROM bookings WHERE id=$1", [
          ids[2],
        ])
      ).rows[0],
    ).toEqual({ status: "cancelled", revision: 3 });
    expect(
      (await db.query("SELECT count(*)::int AS n FROM bookings")).rows[0].n,
    ).toBe(6);
  } finally {
    await db.end();
    await control.query(`DROP DATABASE ${name}`);
    await control.end();
  }
});
