import { afterAll, beforeAll, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { localAdminConfig } from "../scripts/local-admin";
import { readFile, readdir } from "node:fs/promises";
import { addDays, todayStockholm } from "../lib/dates";

// All instrumentation is confined to this disposable database. No app migration changes.
const options = {
  statement_timeout: 10000,
};
const name = `mp_acceptance_${randomUUID().replaceAll("-", "")}`;
const control = new Pool({ ...localAdminConfig("postgres"), ...options });
const db = new Pool({ ...localAdminConfig(name), ...options, max: 8 });
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
  await db.query("CREATE TABLE acceptance_clock(instant timestamptz NOT NULL)");
  await db.query("INSERT INTO acceptance_clock VALUES(clock_timestamp())");
  const definition = (
    await db.query(
      "SELECT pg_get_functiondef('check_range(date,date)'::regprocedure) AS sql",
    )
  ).rows[0].sql as string;
  expect(definition.match(/clock_timestamp\(\)/g)).toHaveLength(2);
  // Preserve the shipped date predicate/timezone; substitute only its clock source.
  await db.query(
    definition.replaceAll(
      "clock_timestamp()",
      "(SELECT instant FROM public.acceptance_clock)",
    ),
  );
});
afterAll(async () => {
  await db.end();
  // pool.end() can resolve before backend disconnects; let DROP wait for them.
  if (created) await control.query(`DROP DATABASE ${name}`);
  await control.end();
});

const profile = {
  name: "Acceptance sitter",
  area: "Stockholm",
  latitude: 59.33,
  longitude: 18.07,
  radiusKm: 20,
  description: "Synthetic",
  sizes: ["small"],
  experienceYears: 5,
  dailyPrice: 40000,
  capacity: 2,
  residentDogs: false,
  services: [],
  preferences: [],
};
const dog = {
  name: "Acceptance dog",
  size: "small",
  ageYears: 4,
  breed: "",
  social: true,
  requirements: [],
  preferences: [],
  careNotes: "SYNTHETIC PRIVATE CARE",
};
async function person() {
  const id = randomUUID();
  await db.query(
    "INSERT INTO \"user\"(id,name,email) VALUES($1,'Acceptance',$2)",
    [id, `${id}@example.test`],
  );
  return id;
}
async function begin(actor: string, isolation = "READ COMMITTED") {
  const c = await db.connect();
  await c.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  await c.query("SET LOCAL ROLE marketplace_app");
  await c.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
  return c;
}
async function run(
  actor: string,
  sql: string,
  args: unknown[] = [],
  isolation = "READ COMMITTED",
) {
  const c = await begin(actor, isolation);
  try {
    const result = await c.query(sql, args);
    await c.query("COMMIT");
    return result;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
async function finish(...clients: PoolClient[]) {
  for (const c of clients) {
    await c.query("ROLLBACK");
    await c.query("SELECT pg_advisory_unlock_all()");
    c.release();
  }
}
const pid = async (c: PoolClient) =>
  (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
async function blocked(waiter: number, blocker: number, event?: string) {
  // Observe PostgreSQL's actual wait graph. The deadline is a failure bound, not scheduling.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await db.query(
        "SELECT pg_blocking_pids(pid) AS blockers,wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1",
        [waiter],
      )
    ).rows[0];
    if (
      row?.blockers.includes(blocker) &&
      row.wait_event_type === "Lock" &&
      (!event || row.wait_event === event)
    )
      return;
  }
  throw new Error(
    `Expected backend ${waiter} to wait on ${blocker}${event ? ` (${event})` : ""}`,
  );
}
function outcome<T>(p: Promise<T>) {
  return p.then(
    (value) => ({ value, code: null }),
    (e: { code: string }) => ({ value: null, code: e.code }),
  );
}
async function world(capacity = 2, start = addDays(todayStockholm(), 10)) {
  await db.query("UPDATE acceptance_clock SET instant=clock_timestamp()");
  const owner = await person(),
    sitter = await person(),
    otherOwner = await person();
  const sid = (
    await run(sitter, "SELECT save_sitter($1) AS id", [
      { ...profile, capacity },
    ])
  ).rows[0].id;
  const dogs = [];
  for (let i = 0; i < 2; i++)
    dogs.push(
      (await run(owner, "SELECT save_dog($1) AS id", [dog])).rows[0].id,
    );
  const otherDog = (await run(otherOwner, "SELECT save_dog($1) AS id", [dog]))
    .rows[0].id;
  const end = addDays(start, 2);
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
  return { owner, sitter, otherOwner, sid, dogs, otherDog, start, end, input };
}
async function occupied(sid: string) {
  return (
    await db.query(
      "SELECT start_date::text AS day,count(*)::int AS n FROM reservations WHERE sitter_id=$1 AND active GROUP BY 1 ORDER BY 1",
      [sid],
    )
  ).rows;
}

it("serializes a queued first-profile save around an intervening committed two-dog booking", async () => {
  const sitter = await person(),
    owner = await person();
  const creator = await begin(sitter);
  // A session lock retains the real function's advisory gate across creator COMMIT.
  await creator.query(
    "SELECT pg_advisory_lock(hashtextextended('sitter:' || $1,0))",
    [sitter],
  );
  const sid = (await creator.query("SELECT save_sitter($1) AS id", [profile]))
    .rows[0].id;
  const start = addDays(todayStockholm(), 20),
    end = addDays(start, 2);
  await creator.query("SELECT set_availability($1,$2,true)", [start, end]);
  const updater = await begin(sitter);
  const creatorPid = await pid(creator),
    updaterPid = await pid(updater);
  const change = outcome(
    updater.query("SELECT save_sitter($1)", [{ ...profile, capacity: 1 }]),
  );
  try {
    await blocked(updaterPid, creatorPid, "advisory");
    await creator.query("COMMIT");
    const ids = [];
    for (let i = 0; i < 2; i++)
      ids.push(
        (await run(owner, "SELECT save_dog($1) AS id", [dog])).rows[0].id,
      );
    await run(owner, "SELECT request_booking($1)", [
      {
        sitterId: sid,
        dogIds: ids,
        startDate: start,
        endDate: end,
        requestKey: randomUUID(),
        expectedDailyPrice: 40000,
        latitude: 59.33,
        longitude: 18.07,
      },
    ]);
    await creator.query("SELECT pg_advisory_unlock_all()");
    expect((await change).code).toBe("P0001");
    expect(
      (await db.query("SELECT capacity FROM sitters WHERE id=$1", [sid]))
        .rows[0].capacity,
    ).toBe(2);
    expect((await occupied(sid)).map((x) => x.n)).toEqual([2, 2, 2]);
  } finally {
    await creator.query("SELECT pg_advisory_unlock_all()");
    await change;
    await finish(creator, updater);
  }
});

it.each([false, true])(
  "rechecks the clock after a real cross-sitter exclusion wait (cross midnight=%s)",
  async (crossMidnight) => {
    const w = await world(2, addDays(todayStockholm(), 1));
    const secondSitter = await person();
    const sid2 = (
      await run(secondSitter, "SELECT save_sitter($1) AS id", [profile])
    ).rows[0].id;
    await run(secondSitter, "SELECT set_availability($1,$2,true)", [
      w.start,
      w.end,
    ]);
    await db.query(
      "UPDATE acceptance_clock SET instant=($1::date+time '23:59:59') AT TIME ZONE 'Europe/Stockholm'",
      [w.start],
    );
    const first = await begin(w.owner),
      second = await begin(w.owner);
    const firstPid = await pid(first),
      secondPid = await pid(second);
    await first.query("SELECT request_booking($1)", [w.input]);
    const contender = outcome(
      second.query("SELECT request_booking($1) AS id", [
        { ...w.input, sitterId: sid2, requestKey: randomUUID() },
      ]),
    );
    try {
      await blocked(secondPid, firstPid, "transactionid");
      if (crossMidnight)
        await db.query(
          "UPDATE acceptance_clock SET instant=instant+interval '2 seconds'",
        );
      await first.query("ROLLBACK");
      expect((await contender).code).toBe(crossMidnight ? "22023" : null);
      await second.query(crossMidnight ? "ROLLBACK" : "COMMIT");
      expect(await occupied(w.sid)).toEqual([]);
      expect((await occupied(sid2)).map((x) => x.n)).toEqual(
        crossMidnight ? [] : [1, 1, 1],
      );
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM bookings WHERE sitter_id=$1",
            [sid2],
          )
        ).rows[0].n,
      ).toBe(crossMidnight ? 0 : 1);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM booking_dogs WHERE sitter_id=$1",
            [sid2],
          )
        ).rows[0].n,
      ).toBe(crossMidnight ? 0 : 1);
    } finally {
      await first.query("ROLLBACK");
      await contender;
      await finish(first, second);
      await db.query("UPDATE acceptance_clock SET instant=clock_timestamp()");
    }
  },
);

it.each(["cancelled", "declined", "rollback"])(
  "makes a waiting replacement see an atomic capacity release: %s",
  async (decision) => {
    const w = await world(1);
    const bid = (
      await run(w.owner, "SELECT request_booking($1) AS id", [w.input])
    ).rows[0].id;
    const releasing = await begin(w.sitter),
      replacement = await begin(w.otherOwner);
    const releasingPid = await pid(releasing),
      replacementPid = await pid(replacement);
    await releasing.query("SELECT decide_booking($1,$2,0)", [
      bid,
      decision === "rollback" ? "cancelled" : decision,
    ]);
    const contender = outcome(
      replacement.query("SELECT request_booking($1)", [
        { ...w.input, dogIds: [w.otherDog], requestKey: randomUUID() },
      ]),
    );
    try {
      await blocked(replacementPid, releasingPid);
      await releasing.query(decision === "rollback" ? "ROLLBACK" : "COMMIT");
      expect((await contender).code).toBe(
        decision === "rollback" ? "P0001" : null,
      );
      await replacement.query(decision === "rollback" ? "ROLLBACK" : "COMMIT");
      expect((await occupied(w.sid)).map((x) => x.n)).toEqual([1, 1, 1]);
      const expectedActive = decision === "rollback";
      expect(
        (
          await db.query(
            "SELECT active FROM booking_dogs WHERE booking_id=$1",
            [bid],
          )
        ).rows[0].active,
      ).toBe(expectedActive);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM reservations WHERE booking_id=$1 AND active",
            [bid],
          )
        ).rows[0].n,
      ).toBe(expectedActive ? 3 : 0);
    } finally {
      await releasing.query("ROLLBACK");
      await contender;
      await finish(releasing, replacement);
    }
  },
);

it.each(["close", "book"])(
  "serializes availability and booking with %s committing first",
  async (firstAction) => {
    const w = await world();
    const first = await begin(firstAction === "close" ? w.sitter : w.owner);
    const second = await begin(firstAction === "close" ? w.owner : w.sitter);
    const firstPid = await pid(first),
      secondPid = await pid(second);
    const close = (c: PoolClient) =>
      c.query("SELECT set_availability($1,$2,false)", [w.start, w.end]);
    const book = (c: PoolClient) =>
      c.query("SELECT request_booking($1)", [w.input]);
    await (firstAction === "close" ? close(first) : book(first));
    const contender = outcome(
      firstAction === "close" ? book(second) : close(second),
    );
    try {
      await blocked(secondPid, firstPid);
      await first.query("COMMIT");
      expect((await contender).code).toBe("P0001");
      expect((await occupied(w.sid)).map((x) => x.n)).toEqual(
        firstAction === "close" ? [] : [1, 1, 1],
      );
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM availability WHERE sitter_id=$1",
            [w.sid],
          )
        ).rows[0].n,
      ).toBe(firstAction === "close" ? 0 : 3);
    } finally {
      await first.query("ROLLBACK");
      await contender;
      await finish(first, second);
    }
  },
);

it.each([
  ["READ COMMITTED", "READ COMMITTED"],
  ["REPEATABLE READ", "READ COMMITTED"],
  ["REPEATABLE READ", "REPEATABLE READ"],
  ["SERIALIZABLE", "READ COMMITTED"],
  ["SERIALIZABLE", "SERIALIZABLE"],
])(
  "protects capacity edits at %s when a %s booking commits after the snapshot",
  async (isolation, bookingIsolation) => {
    const w = await world();
    const editor = await begin(w.sitter, isolation);
    try {
      await editor.query("SELECT * FROM sitters"); // Establish the editor's snapshot.
      await run(
        w.owner,
        "SELECT request_booking($1)",
        [{ ...w.input, dogIds: w.dogs }],
        bookingIsolation,
      );
      const change = await outcome(
        (async () => {
          await editor.query("SELECT save_sitter($1)", [
            { ...profile, capacity: 1 },
          ]);
          await editor.query("COMMIT");
        })(),
      );
      // A safe outcome is a business conflict or serialization failure, never capacity one.
      const capacity = (
        await db.query("SELECT capacity FROM sitters WHERE id=$1", [w.sid])
      ).rows[0].capacity;
      expect({
        capacity,
        occupiedPerDay: (await occupied(w.sid)).map((x) => x.n),
      }).toEqual({ capacity: 2, occupiedPerDay: [2, 2, 2] });
      expect(["P0001", "40001"]).toContain(change.code);
    } finally {
      await finish(editor);
    }
  },
);

it.each([
  ["READ COMMITTED", "book"],
  ["READ COMMITTED", "reduce"],
  ["REPEATABLE READ", "book"],
  ["REPEATABLE READ", "reduce"],
  ["SERIALIZABLE", "book"],
  ["SERIALIZABLE", "reduce"],
])(
  "serializes a booking against capacity reduction at %s, %s first",
  async (isolation, firstAction) => {
    const w = await world();
    const first = await begin(
      firstAction === "book" ? w.owner : w.sitter,
      isolation,
    );
    const second = await begin(
      firstAction === "book" ? w.sitter : w.owner,
      isolation,
    );
    const firstPid = await pid(first),
      secondPid = await pid(second);
    const book = (c: PoolClient) =>
      c.query("SELECT request_booking($1)", [{ ...w.input, dogIds: w.dogs }]);
    const reduce = (c: PoolClient) =>
      c.query("SELECT save_sitter($1)", [{ ...profile, capacity: 1 }]);
    await (firstAction === "book" ? book(first) : reduce(first));
    const contender = outcome(
      firstAction === "book" ? reduce(second) : book(second),
    );
    try {
      await blocked(secondPid, firstPid);
      await first.query("COMMIT");
      const result = await contender;
      expect(result.code).toBe(
        isolation !== "READ COMMITTED"
          ? "40001"
          : firstAction === "book"
            ? "P0001"
            : "22023",
      );
      expect(
        (await db.query("SELECT capacity FROM sitters WHERE id=$1", [w.sid]))
          .rows[0].capacity,
      ).toBe(firstAction === "book" ? 2 : 1);
      expect((await occupied(w.sid)).map((x) => x.n)).toEqual(
        firstAction === "book" ? [2, 2, 2] : [],
      );
    } finally {
      await first.query("ROLLBACK");
      await contender;
      await finish(first, second);
    }
  },
);

it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "serializes concurrent capacity reductions at %s",
  async (isolation) => {
    const w = await world(3);
    const first = await begin(w.sitter, isolation),
      second = await begin(w.sitter, isolation);
    const firstPid = await pid(first),
      secondPid = await pid(second);
    await first.query("SELECT save_sitter($1)", [profile]);
    const contender = outcome(
      second.query("SELECT save_sitter($1)", [{ ...profile, capacity: 1 }]),
    );
    try {
      await blocked(secondPid, firstPid, "advisory");
      await first.query("COMMIT");
      expect((await contender).code).toBe(
        isolation === "READ COMMITTED" ? null : "40001",
      );
      await second.query(
        isolation === "READ COMMITTED" ? "COMMIT" : "ROLLBACK",
      );
      expect(
        (await db.query("SELECT capacity FROM sitters WHERE id=$1", [w.sid]))
          .rows[0].capacity,
      ).toBe(isolation === "READ COMMITTED" ? 1 : 2);
      expect(await occupied(w.sid)).toEqual([]);
    } finally {
      await first.query("ROLLBACK");
      await contender;
      await finish(first, second);
    }
  },
);

it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])(
  "makes concurrent approvals idempotent with retry at %s",
  async (isolation) => {
    const w = await world();
    const bid = (
      await run(w.owner, "SELECT request_booking($1) AS id", [w.input])
    ).rows[0].id;
    const first = await begin(w.sitter, isolation),
      second = await begin(w.sitter, isolation);
    const firstPid = await pid(first),
      secondPid = await pid(second);
    await first.query("SELECT decide_booking($1,'confirmed',0)", [bid]);
    const contender = outcome(
      second.query("SELECT decide_booking($1,'confirmed',0)", [bid]),
    );
    try {
      await blocked(secondPid, firstPid);
      await first.query("COMMIT");
      expect((await contender).code).toBe(
        isolation === "READ COMMITTED" ? null : "40001",
      );
      await second.query(
        isolation === "READ COMMITTED" ? "COMMIT" : "ROLLBACK",
      );
      await run(
        w.sitter,
        "SELECT decide_booking($1,'confirmed',0)",
        [bid],
        isolation,
      );
      expect(
        (
          await db.query("SELECT status,revision FROM bookings WHERE id=$1", [
            bid,
          ])
        ).rows[0],
      ).toEqual({ status: "confirmed", revision: 1 });
      expect((await occupied(w.sid)).map((x) => x.n)).toEqual([1, 1, 1]);
    } finally {
      await first.query("ROLLBACK");
      await contender;
      await finish(first, second);
    }
  },
);

it.each(["REPEATABLE READ", "SERIALIZABLE"])(
  "rejects stale schedule reads in both write directions at %s",
  async (isolation) => {
    const w = await world();
    const booker = await begin(w.owner, isolation);
    try {
      await booker.query("SELECT * FROM bookings");
      await run(w.sitter, "SELECT set_availability($1,$2,false)", [
        w.start,
        w.end,
      ]);
      expect(
        (await outcome(booker.query("SELECT request_booking($1)", [w.input])))
          .code,
      ).toBe("40001");
      expect(await occupied(w.sid)).toEqual([]);
    } finally {
      await finish(booker);
    }
    await run(w.sitter, "SELECT set_availability($1,$2,true)", [
      w.start,
      w.end,
    ]);
    const closer = await begin(w.sitter, isolation);
    try {
      await closer.query("SELECT * FROM availability");
      await run(w.owner, "SELECT request_booking($1)", [w.input]);
      expect(
        (
          await outcome(
            closer.query("SELECT set_availability($1,$2,false)", [
              w.start,
              w.end,
            ]),
          )
        ).code,
      ).toBe("40001");
      expect((await occupied(w.sid)).map((x) => x.n)).toEqual([1, 1, 1]);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM availability WHERE sitter_id=$1",
            [w.sid],
          )
        ).rows[0].n,
      ).toBe(3);
    } finally {
      await finish(closer);
    }
  },
);
