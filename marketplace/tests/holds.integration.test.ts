import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { localAdminConfig } from "../scripts/local-admin";
import { addDays, todayStockholm } from "../lib/dates";

const name = `mp_acceptance_${randomUUID().replaceAll("-", "")}`;
const control = new Pool(localAdminConfig("postgres"));
const db = new Pool({
  ...localAdminConfig(name),
  max: 12,
  statement_timeout: 8000,
});
const base = `${todayStockholm()}T10:00:00Z`;
let created = false;
beforeAll(async () => {
  await control.query(`CREATE DATABASE ${name}`);
  created = true;
  for (const file of (
    await readdir(new URL("../migrations/", import.meta.url))
  ).sort())
    if (file.endsWith(".sql"))
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
  // Test-only clock substitution in a disposable database, never a runtime override.
  await db.query("CREATE TABLE hold_test_clock(instant timestamptz NOT NULL)");
  await db.query("INSERT INTO hold_test_clock VALUES($1)", [base]);
  await db.query(
    "CREATE FUNCTION hold_test_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT instant FROM hold_test_clock'",
  );
  const policy = (
    await db.query(
      "SELECT pg_get_expr(polqual,polrelid) AS sql FROM pg_policy WHERE polname='care_parties'",
    )
  ).rows[0].sql;
  await db.query(
    `ALTER POLICY care_parties ON booking_dogs USING (${policy.replaceAll("clock_timestamp()", "hold_test_now()")})`,
  );
  const funcs = (
    await db.query(
      "SELECT oid::regprocedure::text AS name,pg_get_functiondef(oid) AS sql FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc LIKE '%clock_timestamp()%' AND prokind='f'",
    )
  ).rows;
  for (const f of funcs)
    await db.query(
      f.sql.replaceAll(
        "clock_timestamp()",
        "(SELECT instant FROM public.hold_test_clock)",
      ),
    );
});
beforeEach(async () => {
  await db.query("UPDATE hold_test_clock SET instant=$1", [base]);
  await db.query("UPDATE booking_hold_policy SET duration_seconds=172800");
});
afterAll(async () => {
  await db.end();
  if (created) await control.query(`DROP DATABASE ${name}`);
  await control.end();
});
async function clock(value: string) {
  await db.query("UPDATE hold_test_clock SET instant=$1", [value]);
}
async function person() {
  const id = randomUUID();
  await db.query(
    "INSERT INTO \"user\"(id,name,email) VALUES($1,'Synthetic',$2)",
    [id, `${id}@example.test`],
  );
  return id;
}
async function begin(actor = "", isolation = "READ COMMITTED") {
  const c = await db.connect();
  await c.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  await c.query("SET LOCAL ROLE marketplace_app");
  await c.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
  return c;
}
async function run(actor: string, sql: string, args: unknown[] = []) {
  const c = await begin(actor);
  try {
    const r = await c.query(sql, args);
    await c.query("COMMIT");
    return r;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
async function finish(...clients: PoolClient[]) {
  for (const c of clients) {
    await c.query("ROLLBACK");
    c.release();
  }
}
const profile = {
  name: "Holds sitter",
  area: "Stockholm",
  latitude: 59.33,
  longitude: 18.07,
  radiusKm: 20,
  description: "",
  sizes: ["small"],
  experienceYears: 3,
  dailyPrice: 40000,
  capacity: 1,
  residentDogs: false,
  services: [],
  preferences: [],
};
async function world(offset = 10) {
  const owner = await person(),
    sitter = await person(),
    other = await person();
  const sid = (await run(sitter, "SELECT save_sitter($1) AS id", [profile]))
    .rows[0].id;
  const dogInput = {
    name: "Synthetic",
    size: "small",
    ageYears: 3,
    breed: "",
    social: true,
    requirements: [],
    preferences: [],
    careNotes: "PRIVATE HOLD CARE",
  };
  const dog = (await run(owner, "SELECT save_dog($1) AS id", [dogInput]))
    .rows[0].id;
  const otherDog = (await run(other, "SELECT save_dog($1) AS id", [dogInput]))
    .rows[0].id;
  const startDate = addDays(todayStockholm(), offset),
    endDate = addDays(startDate, 2);
  await run(sitter, "SELECT set_availability($1,$2,true)", [
    startDate,
    endDate,
  ]);
  const input = {
    sitterId: sid,
    dogIds: [dog],
    startDate,
    endDate,
    requestKey: randomUUID(),
    expectedDailyPrice: 40000,
    latitude: 59.33,
    longitude: 18.07,
  };
  return { owner, sitter, other, sid, dog, otherDog, input };
}
async function book(w: Awaited<ReturnType<typeof world>>) {
  return (await run(w.owner, "SELECT request_booking($1) AS id", [w.input]))
    .rows[0].id as string;
}
async function row(id: string) {
  return (
    await db.query(
      "SELECT *,expires_at::text AS deadline FROM bookings WHERE id=$1",
      [id],
    )
  ).rows[0];
}
async function expired(id: string) {
  const b = await row(id);
  await clock(b.deadline);
}
async function active(id: string) {
  return (
    await db.query(
      "SELECT (SELECT count(*)::int FROM reservations WHERE booking_id=$1 AND active) AS slots,(SELECT count(*)::int FROM booking_dogs WHERE booking_id=$1 AND active) AS dogs",
      [id],
    )
  ).rows[0];
}
async function sweep(n = 100) {
  return (await run("", "SELECT expire_booking_holds($1) AS n", [n])).rows[0]
    .n as number;
}
const pid = async (c: PoolClient) =>
  (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
async function blocked(waiter: number, blocker: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (
      (
        await db.query("SELECT $2::int=ANY(pg_blocking_pids($1)) AS waiting", [
          waiter,
          blocker,
        ])
      ).rows[0].waiting
    )
      return;
  }
  throw new Error("Expected database lock wait");
}
const outcome = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value, code: null }),
    (e: { code: string }) => ({ value: null, code: e.code }),
  );

it("stores a default 48-hour hold and reserves all inclusive days", async () => {
  const w = await world(),
    id = await book(w),
    b = await row(id);
  expect(b.status).toBe("pending");
  expect(b.expires_at.getTime() - b.created_at.getTime()).toBe(48 * 3600000);
  expect(await active(id)).toEqual({ slots: 3, dogs: 1 });
  expect(b.expired_at).toBeNull();
});
it("uses the persisted administrator policy only for new holds", async () => {
  const w = await world(),
    first = await book(w);
  await db.query("UPDATE booking_hold_policy SET duration_seconds=3600");
  const other = await world(),
    second = await book(other);
  const a = await row(first),
    b = await row(second);
  expect(a.expires_at.getTime() - a.created_at.getTime()).toBe(172800000);
  expect(b.expires_at.getTime() - b.created_at.getTime()).toBe(3600000);
  await expect(
    run(w.owner, "UPDATE booking_hold_policy SET duration_seconds=1"),
  ).rejects.toMatchObject({ code: "42501" });
});
it("caps a short-notice hold at Stockholm start midnight and rejects same-day requests", async () => {
  const w = await world(1),
    id = await book(w);
  expect((await row(id)).deadline).toBe(
    (
      await db.query(
        "SELECT ($1::date::timestamp AT TIME ZONE 'Europe/Stockholm')::text AS t",
        [w.input.startDate],
      )
    ).rows[0].t,
  );
  const today = await world(0);
  await expect(book(today)).rejects.toMatchObject({ code: "P0003" });
});
it.each([-1, 0, 1])(
  "approval at deadline %+i ms has one authoritative result",
  async (offset) => {
    const w = await world(),
      id = await book(w),
      b = await row(id);
    await clock(new Date(b.expires_at.getTime() + offset).toISOString());
    await run(w.sitter, "SELECT decide_booking($1,'confirmed',0)", [id]);
    const result = await row(id);
    expect(result.status).toBe(offset < 0 ? "confirmed" : "expired");
    expect(result.revision).toBe(1);
    expect(await active(id)).toEqual(
      offset < 0 ? { slots: 3, dogs: 1 } : { slots: 0, dogs: 0 },
    );
  },
);
it("never expires confirmed bookings, even past their stay", async () => {
  const w = await world(),
    id = await book(w);
  await run(w.sitter, "SELECT decide_booking($1,'confirmed',0)", [id]);
  await clock(`${addDays(w.input.endDate, 3)}T12:00:00Z`);
  await sweep();
  expect((await row(id)).status).toBe("confirmed");
  expect(await active(id)).toEqual({ slots: 3, dogs: 1 });
});
it.each(["cancelled", "declined"])(
  "%s before deadline releases once and preserves history",
  async (decision) => {
    const w = await world(),
      id = await book(w);
    await run(
      decision === "cancelled" ? w.owner : w.sitter,
      "SELECT decide_booking($1,$2,0)",
      [id, decision],
    );
    const before = await row(id);
    await expired(id);
    await sweep();
    await sweep();
    expect(await row(id)).toEqual(before);
    expect(await active(id)).toEqual({ slots: 0, dogs: 0 });
  },
);
it("repeated actor-free expiration preserves revision, timestamps and snapshots", async () => {
  const w = await world(),
    id = await book(w);
  await expired(id);
  await sweep();
  const before = await row(id);
  await sweep();
  await sweep();
  expect(await row(id)).toEqual(before);
  expect(before.status).toBe("expired");
  expect(before.revision).toBe(1);
  expect(
    (
      await db.query(
        "SELECT snapshot->>'care_notes' AS care FROM booking_dogs WHERE booking_id=$1",
        [id],
      )
    ).rows[0].care,
  ).toBe("PRIVATE HOLD CARE");
});
it("never resurrects an expired request, including identical request-key retries", async () => {
  const w = await world(),
    id = await book(w);
  await expired(id);
  expect(await book(w)).toBe(id);
  await run(w.sitter, "SELECT decide_booking($1,'confirmed',0)", [id]);
  expect((await row(id)).status).toBe("expired");
  await expect(
    db.query("UPDATE bookings SET status='confirmed' WHERE id=$1", [id]),
  ).rejects.toMatchObject({ code: "23514" });
});
it("reconciles replacement capacity after scheduler downtime", async () => {
  const w = await world(),
    old = await book(w);
  await expired(old);
  const replacement = (
    await run(w.other, "SELECT request_booking($1) AS id", [
      { ...w.input, dogIds: [w.otherDog], requestKey: randomUUID() },
    ])
  ).rows[0].id;
  expect((await row(old)).status).toBe("expired");
  expect(await active(old)).toEqual({ slots: 0, dogs: 0 });
  expect(await active(replacement)).toEqual({ slots: 3, dogs: 1 });
});
it("clears the owner's expired cross-sitter dog exclusion", async () => {
  const w = await world(),
    old = await book(w),
    other = await world();
  await expired(old);
  const replacement = (
    await run(w.owner, "SELECT request_booking($1) AS id", [
      { ...w.input, sitterId: other.sid, requestKey: randomUUID() },
    ])
  ).rows[0].id;
  expect((await row(old)).status).toBe("expired");
  expect(await active(replacement)).toEqual({ slots: 3, dogs: 1 });
});
it("search eligibility ignores due capacity even before worker cleanup", async () => {
  const w = await world(),
    id = await book(w);
  await expired(id);
  const rows = (
    await run(w.other, "SELECT * FROM public_sitters($1,$2,1,false)", [
      w.input.startDate,
      w.input.endDate,
    ])
  ).rows;
  expect(rows.find((r) => r.profile.id === w.sid).capacity_ok).toBe(true);
  expect((await row(id)).status).toBe("pending");
});
it("expired care is private and history remains visible only to booking parties", async () => {
  const w = await world(),
    id = await book(w),
    outsider = await person();
  await expired(id);
  expect(
    (
      await run(w.sitter, "SELECT * FROM booking_dogs WHERE booking_id=$1", [
        id,
      ])
    ).rows,
  ).toEqual([]);
  expect(
    (await run(w.owner, "SELECT * FROM booking_dogs WHERE booking_id=$1", [id]))
      .rows,
  ).toHaveLength(1);
  await run(w.owner, "SELECT reconcile_actor_holds()");
  for (const actor of [w.owner, w.sitter])
    expect(
      (await run(actor, "SELECT status FROM bookings WHERE id=$1", [id])).rows,
    ).toEqual([{ status: "expired" }]);
  expect(
    (await run(outsider, "SELECT * FROM bookings WHERE id=$1", [id])).rows,
  ).toEqual([]);
  await expect(
    run(outsider, "SELECT decide_booking($1,'confirmed',0)", [id]),
  ).rejects.toMatchObject({ code: "P0002" });
  await expect(run("", "SELECT reconcile_actor_holds()")).rejects.toMatchObject(
    { code: "42501" },
  );
  await expect(
    run("", "SELECT expire_sitter_holds($1)", [w.sid]),
  ).rejects.toMatchObject({ code: "42501" });
});
it.each(["profile", "availability"])(
  "reconciles overdue commitments before %s changes",
  async (kind) => {
    const w = await world(),
      id = await book(w);
    await expired(id);
    if (kind === "profile")
      await run(w.sitter, "SELECT save_sitter($1)", [
        { ...profile, capacity: 2 },
      ]);
    else
      await run(w.sitter, "SELECT set_availability($1,$2,false)", [
        w.input.startDate,
        w.input.endDate,
      ]);
    expect((await row(id)).status).toBe("expired");
  },
);
it.each([0, 501, null])("rejects invalid worker batch %s", async (n) => {
  await expect(
    run("", "SELECT expire_booking_holds($1)", [n]),
  ).rejects.toMatchObject({ code: "22023" });
});
it("recovers an interrupted bounded batch without partial reservation release", async () => {
  // Drain prior test holds, then create an isolated backlog at a fresh clock.
  await clock(`${addDays(todayStockholm(), 100)}T12:00:00Z`);
  while (await sweep(500)) {
    /* drain */
  }
  await clock(base);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await book(await world()));
  await expired(ids[0]);
  const c = await begin();
  await c.query("SELECT expire_booking_holds(2)");
  await finish(c); // worker died before commit
  expect(
    await Promise.all(ids.map(async (id) => (await row(id)).status)),
  ).toEqual(["pending", "pending", "pending"]);
  for (const id of ids) expect(await active(id)).toEqual({ slots: 3, dogs: 1 });
  expect(await sweep(2)).toBe(2);
  expect(await sweep(2)).toBe(1);
  expect(await sweep(2)).toBe(0);
});
it("rolls back the entire transition when reservation release fails", async () => {
  const w = await world(),
    id = await book(w);
  await expired(id);
  await db.query(
    `CREATE FUNCTION fail_hold_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.booking_id='${id}'::uuid THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_hold_release BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION fail_hold_release()`,
  );
  try {
    await expect(sweep()).rejects.toMatchObject({ code: "P0001" });
    expect((await row(id)).status).toBe("pending");
    expect(await active(id)).toEqual({ slots: 3, dogs: 1 });
  } finally {
    await db.query(
      "DROP TRIGGER fail_hold_release ON reservations; DROP FUNCTION fail_hold_release()",
    );
  }
  await sweep();
  expect((await row(id)).status).toBe("expired");
});
it("concurrent workers skip a busy sitter and still expire an independent sitter", async () => {
  const w = await world(),
    id = await book(w),
    other = await world(),
    otherId = await book(other);
  await expired(id);
  const lock = await db.connect();
  await lock.query("BEGIN");
  await lock.query("SELECT 1 FROM sitters WHERE id=$1 FOR UPDATE", [w.sid]);
  try {
    await sweep(500);
    expect((await row(id)).status).toBe("pending");
    expect((await row(otherId)).status).toBe("expired");
  } finally {
    await finish(lock);
  }
  await sweep();
  expect((await row(id)).status).toBe("expired");
});
it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "approval winning before deadline excludes expiration (%s)",
  async (isolation) => {
    const w = await world(),
      id = await book(w);
    const c = await begin(w.sitter, isolation);
    await c.query("SELECT decide_booking($1,'confirmed',0)", [id]);
    try {
      await expired(id);
      await sweep(500);
      await c.query("COMMIT");
      await sweep();
      expect((await row(id)).status).toBe("confirmed");
    } finally {
      await finish(c);
    }
  },
);
it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "expiration winning excludes a queued approval (%s)",
  async (isolation) => {
    const w = await world(),
      id = await book(w);
    await expired(id);
    const approval = await begin(w.sitter, isolation);
    await approval.query("SELECT status FROM bookings WHERE id=$1", [id]); // Pin old snapshot.
    const worker = await begin();
    await worker.query("SELECT expire_booking_holds(500)");
    const approvalPid = await pid(approval),
      workerPid = await pid(worker);
    const result = outcome(
      approval.query("SELECT decide_booking($1,'confirmed',0)", [id]),
    );
    try {
      await blocked(approvalPid, workerPid);
      await worker.query("COMMIT");
      expect((await result).code).toBe(
        isolation === "READ COMMITTED" ? null : "40001",
      );
      await approval.query("COMMIT");
      expect((await row(id)).status).toBe("expired");
      expect(await active(id)).toEqual({ slots: 0, dogs: 0 });
    } finally {
      await worker.query("ROLLBACK");
      await result;
      await finish(worker, approval);
    }
  },
);
it("approval rechecks the clock after waiting on the sitter", async () => {
  const w = await world(),
    id = await book(w),
    lock = await db.connect(),
    approval = await begin(w.sitter);
  await lock.query("BEGIN");
  await lock.query("SELECT 1 FROM sitters WHERE id=$1 FOR UPDATE", [w.sid]);
  const lp = await pid(lock),
    ap = await pid(approval),
    result = outcome(
      approval.query("SELECT decide_booking($1,'confirmed',0)", [id]),
    );
  try {
    await blocked(ap, lp);
    await expired(id);
    await lock.query("COMMIT");
    expect((await result).code).toBeNull();
    await approval.query("COMMIT");
    expect((await row(id)).status).toBe("expired");
  } finally {
    await lock.query("ROLLBACK");
    await result;
    await finish(lock, approval);
  }
});
it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "contending replacements at capacity cannot both win (%s)",
  async (isolation) => {
    const w = await world(),
      old = await book(w);
    await expired(old);
    const first = await begin(w.owner, isolation),
      second = await begin(w.other, isolation);
    await second.query("SELECT 1 FROM bookings");
    await first.query("SELECT request_booking($1)", [
      { ...w.input, requestKey: randomUUID() },
    ]);
    const fp = await pid(first),
      sp = await pid(second);
    const result = outcome(
      second.query("SELECT request_booking($1)", [
        { ...w.input, dogIds: [w.otherDog], requestKey: randomUUID() },
      ]),
    );
    try {
      await blocked(sp, fp);
      await first.query("COMMIT");
      expect((await result).code).toBe(
        isolation === "READ COMMITTED" ? "P0001" : "40001",
      );
      await second.query("ROLLBACK");
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM reservations WHERE sitter_id=$1 AND active",
            [w.sid],
          )
        ).rows[0].n,
      ).toBe(3);
    } finally {
      await first.query("ROLLBACK");
      await result;
      await finish(first, second);
    }
  },
);
it.each([
  ["2027-03-27T22:30:00Z", "2027-03-28", "2027-03-27T23:00:00Z"],
  ["2027-03-28T20:30:00Z", "2027-03-29", "2027-03-28T22:00:00Z"],
  ["2027-10-30T20:30:00Z", "2027-10-31", "2027-10-30T22:00:00Z"],
  ["2027-10-31T21:30:00Z", "2027-11-01", "2027-10-31T23:00:00Z"],
])("uses Stockholm midnight across DST at %s", async (now, start, expected) => {
  const w = await world();
  await clock(now);
  await run(w.sitter, "SELECT set_availability($1,$1,true)", [start]);
  const id = (
    await run(w.owner, "SELECT request_booking($1) AS id", [
      { ...w.input, startDate: start, endDate: start },
    ])
  ).rows[0].id;
  expect((await row(id)).expires_at.toISOString()).toBe(
    new Date(expected).toISOString(),
  );
});
