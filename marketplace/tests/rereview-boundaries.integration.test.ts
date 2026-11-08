import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { localAdminConfig } from "../scripts/local-admin";
import { localDatabase } from "../lib/config";
import { addDays, todayStockholm } from "../lib/dates";

// Independent acceptance fixtures: actual migrations, no clock/function substitution.
const name = `mp_acceptance_${randomUUID().replaceAll("-", "")}`;
const control = new Pool(localAdminConfig("postgres"));
const db = new Pool({ ...localAdminConfig(name), statement_timeout: 5000 });
// Only the generated disposable database differs; exercise a real restricted login.
const runtime = new Pool({
  ...localDatabase(process.env.MARKETPLACE_DATABASE_URL, "marketplace_app"),
  database: name,
});
let created = false;
beforeAll(async () => {
  await control.query(`CREATE DATABASE ${name}`);
  created = true;
  for (const file of (
    await readdir(new URL("../migrations/", import.meta.url))
  ).sort()) {
    if (file.endsWith(".sql"))
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
  }
});
afterAll(async () => {
  await runtime.end();
  await db.end();
  if (created) await control.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await control.end();
});

async function begin(actor: string, isolation = "READ COMMITTED") {
  const c = await db.connect();
  await c.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  await c.query("SET LOCAL ROLE marketplace_app");
  await c.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
  return c;
}
async function release(c: PoolClient) {
  await c.query("ROLLBACK");
  c.release();
}
async function run(actor: string, sql: string, args: unknown[] = []) {
  const c = await begin(actor);
  try {
    const result = await c.query(sql, args);
    await c.query("COMMIT");
    return result;
  } finally {
    await release(c);
  }
}
async function fixture() {
  const owner = randomUUID(),
    sitter = randomUUID();
  for (const id of [owner, sitter])
    await db.query(
      "INSERT INTO \"user\"(id,name,email) VALUES($1,'Re-review',$2)",
      [id, `${id}@example.test`],
    );
  const profile = {
    name: "Re-review sitter",
    area: "Stockholm",
    latitude: 59.33,
    longitude: 18.07,
    radiusKm: 20,
    description: "Synthetic",
    sizes: ["small"],
    experienceYears: 1,
    dailyPrice: 40000,
    capacity: 1,
    residentDogs: false,
    services: [],
    preferences: [],
  };
  const sid = (await run(sitter, "SELECT save_sitter($1) id", [profile]))
    .rows[0].id;
  const dogs: string[] = [];
  for (let i = 0; i < 2; i++)
    dogs.push(
      (
        await run(owner, "SELECT save_dog($1) id", [
          {
            name: "Synthetic",
            size: "small",
            ageYears: 3,
            breed: "",
            social: true,
            requirements: [],
            preferences: [],
            careNotes: "PRIVATE SYNTHETIC",
          },
        ])
      ).rows[0].id,
    );
  const start = addDays(todayStockholm(), 40),
    end = addDays(start, 2);
  await run(sitter, "SELECT set_availability($1,$2,true)", [start, end]);
  const input = {
    sitterId: sid,
    dogIds: [dogs[0]],
    startDate: start,
    endDate: end,
    requestKey: randomUUID(),
    expectedDailyPrice: 40000,
    latitude: 59.33,
    longitude: 18.07,
  };
  return { owner, sitter, sid, dogs, input };
}
async function inventory(sid: string) {
  return (
    await db.query(
      "SELECT start_date::text AS day,count(*)::int n FROM reservations WHERE sitter_id=$1 AND active GROUP BY 1 ORDER BY 1",
      [sid],
    )
  ).rows.map((r) => r.n);
}

it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "commits an unrelated sitter booking while another sitter remains locked at %s",
  async (isolation) => {
    const a = await fixture(),
      b = await fixture();
    const holding = await begin(a.owner, isolation),
      independent = await begin(b.owner, isolation);
    try {
      await holding.query("SELECT request_booking($1)", [a.input]);
      // Holding stays open: successful completion proves absence of a global inventory lock.
      await independent.query("SELECT request_booking($1)", [b.input]);
      await independent.query("COMMIT");
      expect(await inventory(b.sid)).toEqual([1, 1, 1]);
      expect(await inventory(a.sid)).toEqual([]);
      await holding.query("ROLLBACK");
      expect(await inventory(a.sid)).toEqual([]);
    } finally {
      await release(holding);
      await release(independent);
    }
  },
);

it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "rejects an old booking snapshot after another request consumes the last slot at %s",
  async (isolation) => {
    const w = await fixture(),
      stale = await begin(w.owner, isolation);
    try {
      await stale.query("SELECT * FROM bookings");
      await run(w.owner, "SELECT request_booking($1)", [w.input]);
      await expect(
        stale.query("SELECT request_booking($1)", [
          {
            ...w.input,
            dogIds: [w.dogs[1]],
            requestKey: randomUUID(),
          },
        ]),
      ).rejects.toMatchObject({
        code: isolation === "READ COMMITTED" ? "P0001" : "40001",
      });
      expect(await inventory(w.sid)).toEqual([1, 1, 1]);
    } finally {
      await release(stale);
    }
  },
);

it.each([
  ["REPEATABLE READ", true],
  ["REPEATABLE READ", false],
  ["SERIALIZABLE", true],
  ["SERIALIZABLE", false],
] as const)(
  "handles old replacement snapshots at %s after cancellation commit=%s",
  async (isolation, commit) => {
    const w = await fixture();
    const bid = (await run(w.owner, "SELECT request_booking($1) id", [w.input]))
      .rows[0].id;
    const stale = await begin(w.owner, isolation),
      cancelling = await begin(w.sitter);
    const replacement = {
      ...w.input,
      dogIds: [w.dogs[1]],
      requestKey: randomUUID(),
    };
    try {
      await stale.query("SELECT * FROM bookings");
      await cancelling.query("SELECT decide_booking($1,'cancelled',0)", [bid]);
      await cancelling.query(commit ? "COMMIT" : "ROLLBACK");
      await expect(
        stale.query("SELECT request_booking($1)", [replacement]),
      ).rejects.toMatchObject({ code: commit ? "40001" : "P0001" });
      await stale.query("ROLLBACK");
      expect(await inventory(w.sid)).toEqual(commit ? [] : [1, 1, 1]);
      if (commit)
        await run(w.owner, "SELECT request_booking($1)", [replacement]);
      expect(await inventory(w.sid)).toEqual([1, 1, 1]);
      expect(
        (
          await db.query(
            "SELECT active FROM booking_dogs WHERE booking_id=$1",
            [bid],
          )
        ).rows[0].active,
      ).toBe(!commit);
    } finally {
      await release(stale);
      await release(cancelling);
    }
  },
);

it("denies alternative runtime mutation paths and protects the trigger boundary", async () => {
  for (const role of ["marketplace_app", "marketplace_auth"])
    for (const table of [
      "sitters",
      "dogs",
      "availability",
      "bookings",
      "booking_dogs",
      "reservations",
    ])
      expect(
        (
          await db.query(
            "SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') allowed",
            [role, table],
          )
        ).rows[0].allowed,
      ).toBe(false);
  const w = await fixture();
  for (const sql of [
    "UPDATE sitters SET capacity=10",
    "DELETE FROM bookings",
    "TRUNCATE reservations",
    "ALTER TABLE bookings DISABLE TRIGGER booking_inventory_fence",
    "SET LOCAL session_replication_role=replica",
    "SET LOCAL ROLE marketplace_auth",
    "SELECT fence_sitter_inventory()",
  ]) {
    const c = await runtime.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.actor_id',$1,true)", [w.owner]);
      await expect(c.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await release(c);
    }
  }
  const triggers = (
    await db.query(
      "SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('booking_inventory_fence','availability_inventory_fence') ORDER BY tgname",
    )
  ).rows;
  expect(triggers).toEqual([
    { tgname: "availability_inventory_fence", tgenabled: "O" },
    { tgname: "booking_inventory_fence", tgenabled: "O" },
  ]);
});
