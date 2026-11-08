import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { adminPool } from "../scripts/local-admin";
import { pool, transaction } from "../lib/db";
import { runtimePool, verifyRuntimeConnection } from "../lib/connection";
import { handle } from "../lib/http";
import { authPool } from "../lib/auth";
const admin = adminPool();
afterAll(async () => {
  await Promise.all([admin.end(), pool.end(), authPool.end()]);
});
async function person() {
  const id = randomUUID();
  await admin.query(
    "INSERT INTO \"user\"(id,name,email) VALUES($1,'Retry fixture',$2)",
    [id, `${id}@example.test`],
  );
  return id;
}
const dog = {
  name: "Retry dog",
  size: "small",
  ageYears: 4,
  breed: "",
  social: true,
  requirements: [],
  preferences: [],
  careNotes: "Synthetic",
};
const count = async (owner: string) =>
  (await transaction(owner, (c) => c.query("SELECT count(*)::int n FROM dogs")))
    .rows[0].n;

it("uses explicit Read Committed even when the borrowed session default differs", async () => {
  const owner = await person();
  const c = await pool.connect();
  await c.query("SET default_transaction_isolation='repeatable read'");
  c.release();
  try {
    const value = await transaction(
      owner,
      async (client) =>
        (await client.query("SHOW transaction_isolation")).rows[0]
          .transaction_isolation,
    );
    expect(value).toBe("read committed");
  } finally {
    await pool.query("SET default_transaction_isolation='read committed'");
  }
});

it.each(["40001", "40P01"])(
  "retries a PostgreSQL-aborted %s transaction from the beginning without duplicate writes",
  async (code) => {
    const owner = await person();
    let attempts = 0;
    await transaction(owner, async (c) => {
      attempts++;
      await c.query("SELECT save_dog($1)", [dog]);
      if (attempts < 3)
        await c.query(
          `DO $$ BEGIN RAISE EXCEPTION 'synthetic abort' USING ERRCODE='${code}'; END $$`,
        );
    });
    expect(attempts).toBe(3);
    expect(await count(owner)).toBe(1);
    expect(
      (await pool.query("SELECT actor_id() AS actor")).rows[0].actor,
    ).toBeNull();
  },
);

it("bounds retries and exposes a generic conflict after three aborted attempts", async () => {
  const owner = await person();
  let attempts = 0;
  const response = await handle(() =>
    transaction(owner, async (c) => {
      attempts++;
      await c.query("SELECT save_dog($1)", [dog]);
      await c.query(
        "DO $$ BEGIN RAISE EXCEPTION 'private internal detail' USING ERRCODE='40001'; END $$",
      );
      return Response.json({ ok: true });
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("private internal detail");
  expect(attempts).toBe(3);
  expect(await count(owner)).toBe(0);
});

it.each(["P0001", "23505", "08006"])(
  "does not retry business/constraint/uncertain connection error %s",
  async (code) => {
    const owner = await person();
    let attempts = 0;
    await expect(
      transaction(owner, async (c) => {
        attempts++;
        await c.query("SELECT save_dog($1)", [dog]);
        await c.query(
          `DO $$ BEGIN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='${code}'; END $$`,
        );
      }),
    ).rejects.toMatchObject({ code });
    expect(attempts).toBe(1);
    expect(await count(owner)).toBe(0);
  },
);

it("recovers from a real advisory-lock deadlock with exactly one rolled-back attempt", async () => {
  const owner = await person();
  const keys = [randomUUID(), randomUUID()];
  const attempts = [0, 0];
  let arrivals = 0;
  let ready!: () => void;
  const barrier = new Promise<void>((resolve) => {
    ready = resolve;
  });
  await Promise.all(
    [0, 1].map((index) =>
      transaction(owner, async (c) => {
        attempts[index]++;
        await c.query("SELECT save_dog($1)", [
          { ...dog, name: `Deadlock ${index}` },
        ]);
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          keys[index],
        ]);
        if (attempts[index] === 1) {
          if (++arrivals === 2) ready();
          await barrier;
        }
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          keys[1 - index],
        ]);
      }),
    ),
  );
  expect(attempts.reduce((a, b) => a + b, 0)).toBe(3);
  expect(await count(owner)).toBe(2);
});

it("discards a disconnected transaction instead of retrying or reusing its actor state", async () => {
  const owner = await person();
  let attempts = 0;
  await expect(
    transaction(owner, async (c) => {
      attempts++;
      c.on("error", () => {}); // The intentional termination can arrive between two queries.
      await c.query("SELECT save_dog($1)", [dog]);
      const pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await admin.query("SELECT pg_terminate_backend($1)", [pid]);
      await c.query("SELECT 1");
    }),
  ).rejects.toBeDefined();
  expect(attempts).toBe(1);
  expect(await count(owner)).toBe(0);
  expect(
    (await pool.query("SELECT actor_id() AS actor")).rows[0].actor,
  ).toBeNull();
});

it("checks real role privileges before a new runtime connection can execute application work", async () => {
  const administrator = await admin.connect();
  try {
    await expect(
      verifyRuntimeConnection(administrator, "marketplace_app"),
    ).rejects.toThrow("identity");
  } finally {
    administrator.release();
  }
  expect(
    (
      await admin.query(
        "SELECT rolcreatedb FROM pg_roles WHERE rolname='marketplace_app'",
      )
    ).rows[0].rolcreatedb,
  ).toBe(false);
  const guarded = runtimePool("marketplace_app", 1);
  try {
    await admin.query("ALTER ROLE marketplace_app CREATEDB");
    await expect(guarded.query("SELECT 1")).rejects.toThrow("privileges");
  } finally {
    await admin.query("ALTER ROLE marketplace_app NOCREATEDB");
    await guarded.end();
  }
  const restored = runtimePool("marketplace_app", 1);
  try {
    expect(
      (await restored.query("SELECT current_user AS name")).rows[0].name,
    ).toBe("marketplace_app");
  } finally {
    await restored.end();
  }
});
