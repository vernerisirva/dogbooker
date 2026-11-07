import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { adminPool, migrate } from "../scripts/migrate";
import { pool, transaction } from "../lib/db";
import { searchSchema } from "../lib/validation";
import { auth, authPool } from "../lib/auth";
import {
  dashboard,
  requestBooking,
  decideBooking,
  saveDog,
  saveSitter,
  setAvailability,
  search,
} from "../lib/service";
import { addDays, todayStockholm } from "../lib/dates";
import { GET, POST } from "../app/api/marketplace/[resource]/route";
const admin = adminPool(),
  day = (n: number) => addDays(todayStockholm(), n);
async function person() {
  const id = randomUUID();
  await admin.query(
    "INSERT INTO \"user\"(id,name,email) VALUES($1,'Synthetic test',$2)",
    [id, `${id}@example.test`],
  );
  return id;
}
const profile = {
  name: "Test sitter",
  area: "Stockholm",
  latitude: 59.33,
  longitude: 18.07,
  radiusKm: 20,
  description: "Synthetic",
  sizes: ["small", "medium", "large"],
  experienceYears: 5,
  dailyPrice: 40000,
  capacity: 2,
  residentDogs: false,
  services: ["medication", "puppy", "senior"],
  preferences: ["quiet"],
};
const dog = {
  name: "Synthetic dog",
  size: "small",
  ageYears: 4,
  breed: "",
  social: true,
  requirements: [],
  preferences: [],
  careNotes: "PRIVATE CARE",
};
async function world(offset = 10) {
  const sitter = await person(),
    otherSitter = await person(),
    owner = await person(),
    otherOwner = await person();
  const { id: sid } = await saveSitter(sitter, profile);
  await saveSitter(otherSitter, { ...profile, name: "Other tenant" });
  const { id: dog1 } = await saveDog(owner, dog),
    { id: dog2 } = await saveDog(owner, { ...dog, name: "Second dog" }),
    { id: otherDog } = await saveDog(otherOwner, dog);
  await setAvailability(sitter, {
    startDate: day(offset),
    endDate: day(offset + 5),
    available: true,
  });
  return {
    sitter,
    otherSitter,
    owner,
    otherOwner,
    sid,
    dog1,
    dog2,
    otherDog,
    input: {
      sitterId: sid,
      requestKey: randomUUID(),
      expectedDailyPrice: 40000,
      startDate: day(offset),
      endDate: day(offset + 2),
      latitude: 59.33,
      longitude: 18.07,
      dogIds: [dog1],
    },
  };
}
beforeAll(async () => {
  await migrate();
  expect(
    (await admin.query("SELECT current_database() AS db")).rows[0].db,
  ).toBe("dogbooker_marketplace");
});
afterAll(async () => {
  await Promise.all([admin.end(), pool.end(), authPool.end()]);
});
describe("database security and lifecycle", () => {
  it("runs idempotent migrations without changing rows", async () => {
    const before = (await admin.query('SELECT count(*) FROM "user"')).rows;
    await migrate();
    expect((await admin.query('SELECT count(*) FROM "user"')).rows).toEqual(
      before,
    );
  });
  it("runs as a restricted non-owner role and denies direct writes/auth reads", async () => {
    const r = (
      await pool.query(
        "SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    expect(r).toEqual({
      name: "marketplace_app",
      rolsuper: false,
      rolbypassrls: false,
    });
    await expect(
      pool.query("INSERT INTO reservations DEFAULT VALUES"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query('SELECT * FROM "user"')).rejects.toMatchObject({
      code: "42501",
    });
    await expect(pool.query("SET ROLE marketplace_auth")).rejects.toMatchObject(
      { code: "42501" },
    );
    expect((await pool.query("SELECT * FROM dogs")).rows).toEqual([]);
  });
  it("isolates two owners and two sitters in list, read, care and writes", async () => {
    const w = await world();
    const b = await requestBooking(w.owner, w.input);
    for (const who of [w.otherOwner, w.otherSitter]) {
      expect((await dashboard(who)).bookings).toEqual([]);
      await expect(dashboard(who, b.id)).rejects.toMatchObject({ status: 404 });
      await expect(
        decideBooking(who, { id: b.id, decision: "confirmed", revision: 0 }),
      ).rejects.toMatchObject({ code: "P0002" });
      await expect(
        decideBooking(who, { id: b.id, decision: "cancelled", revision: 0 }),
      ).rejects.toMatchObject({ code: "P0002" });
      const rows = await transaction(
        who,
        async (c) =>
          (
            await c.query("SELECT * FROM booking_dogs WHERE booking_id=$1", [
              b.id,
            ])
          ).rows,
      );
      expect(rows).toEqual([]);
    }
    expect(
      (await dashboard(w.sitter, b.id)).bookings[0].dogs[0].care_notes,
    ).toBe("PRIVATE CARE");
    expect((await dashboard(w.sitter)).dogs).toEqual([]);
    await expect(
      decideBooking(w.owner, { id: b.id, decision: "confirmed", revision: 0 }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      saveDog(w.otherOwner, { ...dog, id: w.dog1, name: "Stolen" }),
    ).rejects.toMatchObject({ code: "P0002" });
    await expect(
      requestBooking(w.otherOwner, { ...w.input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "P0002" });
    const r = await search(
      w.otherOwner,
      searchSchema.strip().parse({ ...w.input, dogIds: [w.otherDog] }),
    );
    expect(JSON.stringify(r)).not.toContain(w.owner);
    expect(JSON.stringify(r)).not.toContain("PRIVATE CARE");
  });
  it("counts multiple dogs, freezes care/price and releases all capacity on decline", async () => {
    const w = await world(20);
    const b = await requestBooking(w.owner, {
      ...w.input,
      dogIds: [w.dog1, w.dog2],
    });
    const row = (await dashboard(w.owner, b.id)).bookings[0];
    expect(row.dogs).toHaveLength(2);
    expect(row.total_price).toBe(240000);
    await saveDog(w.owner, { ...dog, id: w.dog1, careNotes: "CHANGED" });
    expect(
      (await dashboard(w.sitter, b.id)).bookings[0].dogs.map(
        (d) => d.care_notes,
      ),
    ).not.toContain("CHANGED");
    await expect(
      requestBooking(w.otherOwner, {
        ...w.input,
        requestKey: randomUUID(),
        dogIds: [w.otherDog],
      }),
    ).rejects.toMatchObject({ code: "P0001" });
    await decideBooking(w.sitter, {
      id: b.id,
      decision: "declined",
      revision: 0,
    });
    expect((await dashboard(w.sitter, b.id)).bookings[0].dogs).toEqual([]);
    await expect(
      requestBooking(w.otherOwner, {
        ...w.input,
        requestKey: randomUUID(),
        dogIds: [w.otherDog],
      }),
    ).resolves.toHaveProperty("id");
  });
  it("rechecks size, requirements, geography, availability, price and self-booking", async () => {
    const w = await world(30);
    await expect(
      requestBooking(w.owner, { ...w.input, latitude: 0 }),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      requestBooking(w.owner, { ...w.input, expectedDailyPrice: 1 }),
    ).rejects.toBeDefined();
    await expect(
      requestBooking(w.owner, { ...w.input, expectedDailyPrice: 30000 }),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      requestBooking(w.owner, {
        ...w.input,
        startDate: day(45),
        endDate: day(45),
      }),
    ).rejects.toMatchObject({ code: "P0001" });
    await saveSitter(w.sitter, { ...profile, sizes: ["large"], services: [] });
    await expect(requestBooking(w.owner, w.input)).rejects.toMatchObject({
      code: "22023",
    });
    await saveDog(w.owner, {
      ...dog,
      id: w.dog1,
      size: "large",
      requirements: ["medication"],
    });
    await expect(requestBooking(w.owner, w.input)).rejects.toMatchObject({
      code: "22023",
    });
    const ownDog = await saveDog(w.sitter, { ...dog, size: "large" });
    await expect(
      requestBooking(w.sitter, { ...w.input, dogIds: [ownDog.id] }),
    ).rejects.toMatchObject({ code: "22023" });
  });
  it("isolates a non-social party and rejects resident dogs in both paths", async () => {
    const w = await world(40);
    await saveDog(w.owner, { ...dog, id: w.dog1, social: false });
    const query = searchSchema.strip().parse(w.input);
    await saveSitter(w.sitter, { ...profile, residentDogs: true });
    expect(
      (await search(w.owner, query)).matches.find((m) => m.sitter.id === w.sid),
    ).toBeUndefined();
    await expect(requestBooking(w.owner, w.input)).rejects.toMatchObject({
      code: "22023",
    });
    await saveSitter(w.sitter, profile);
    await requestBooking(w.owner, w.input);
    await expect(
      requestBooking(w.otherOwner, {
        ...w.input,
        requestKey: randomUUID(),
        dogIds: [w.otherDog],
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });
  it("prevents inclusive dog overlaps across sitters; permits the next day", async () => {
    const w = await world(50);
    const b = await requestBooking(w.owner, w.input);
    const other = (await dashboard(w.otherSitter)).sitter!;
    await setAvailability(w.otherSitter, {
      startDate: day(50),
      endDate: day(55),
      available: true,
    });
    await expect(
      requestBooking(w.owner, {
        ...w.input,
        requestKey: randomUUID(),
        sitterId: other.id,
        startDate: day(52),
      }),
    ).rejects.toMatchObject({ code: "23P01" });
    await expect(
      requestBooking(w.owner, {
        ...w.input,
        requestKey: randomUUID(),
        sitterId: other.id,
        startDate: day(53),
        endDate: day(53),
      }),
    ).resolves.toHaveProperty("id");
    await decideBooking(w.sitter, {
      id: b.id,
      decision: "confirmed",
      revision: 0,
    });
    await expect(
      decideBooking(w.owner, { id: b.id, decision: "cancelled", revision: 0 }),
    ).rejects.toMatchObject({ code: "P0001" });
    await decideBooking(w.owner, {
      id: b.id,
      decision: "cancelled",
      revision: 1,
    });
  });
  it("rejects capacity and availability edits that invalidate commitments", async () => {
    const w = await world(60);
    await requestBooking(w.owner, w.input);
    await expect(
      saveSitter(w.sitter, { ...profile, capacity: 1 }),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      setAvailability(w.sitter, {
        startDate: day(60),
        endDate: day(61),
        available: false,
      }),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      saveSitter(w.sitter, { ...profile, dailyPrice: 50000 }),
    ).resolves.toHaveProperty("id");
  });
  it("deduplicates concurrent retries and rejects changed retry payloads", async () => {
    const w = await world(70);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => requestBooking(w.owner, w.input)),
    );
    expect(new Set(results.map((b) => b.id)).size).toBe(1);
    await expect(
      requestBooking(w.owner, { ...w.input, endDate: day(74) }),
    ).rejects.toMatchObject({ code: "P0001" });
  });
  it("admits exactly two of 100 concurrent one-dog requests", async () => {
    const w = await world(80);
    const inputs = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const owner = await person();
        const d = await saveDog(owner, dog);
        return {
          owner,
          input: { ...w.input, requestKey: randomUUID(), dogIds: [d.id] },
        };
      }),
    );
    const results = await Promise.allSettled(
      inputs.map((x) => requestBooking(x.owner, x.input)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM reservations WHERE sitter_id=$1 AND active",
          [w.sid],
        )
      ).rows[0].n,
    ).toBe(6);
  });
  it("serializes cancellation versus approval and availability close versus request", async () => {
    const w = await world(90);
    const b = await requestBooking(w.owner, w.input);
    await Promise.allSettled([
      decideBooking(w.owner, { id: b.id, decision: "cancelled", revision: 0 }),
      decideBooking(w.sitter, { id: b.id, decision: "confirmed", revision: 0 }),
    ]);
    const row = (await dashboard(w.owner, b.id)).bookings[0];
    expect(["confirmed", "cancelled"]).toContain(row.status);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM reservations WHERE booking_id=$1 AND active",
          [b.id],
        )
      ).rows[0].n,
    ).toBe(row.status === "confirmed" ? 3 : 0);
    const w2 = await world(100);
    const r = await Promise.allSettled([
      setAvailability(w2.sitter, {
        startDate: day(100),
        endDate: day(102),
        available: false,
      }),
      requestBooking(w2.owner, w2.input),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("allocates capacity per day when free slots change during a stay", async () => {
    const w = await world(120);
    const a = await requestBooking(w.owner, { ...w.input, endDate: day(120) });
    await requestBooking(w.owner, {
      ...w.input,
      requestKey: randomUUID(),
      dogIds: [w.dog2],
      endDate: day(121),
    });
    await requestBooking(w.owner, {
      ...w.input,
      requestKey: randomUUID(),
      startDate: day(122),
      endDate: day(122),
    });
    const query = searchSchema.strip().parse({
      ...w.input,
      startDate: day(121),
      endDate: day(122),
      dogIds: [w.otherDog],
    });
    expect(
      (await search(w.otherOwner, query)).matches.some(
        (m) => m.sitter.id === w.sid,
      ),
    ).toBe(true);
    await expect(
      requestBooking(w.otherOwner, {
        ...w.input,
        ...query,
        requestKey: randomUUID(),
      }),
    ).resolves.toHaveProperty("id");
    expect((await dashboard(w.owner, a.id)).bookings[0].status).toBe("pending");
  });
  it("validates direct database function coordinates and absent actor", async () => {
    const w = await world(130);
    await expect(
      transaction(w.owner, async (c) =>
        c.query("SELECT request_booking($1)", [{ ...w.input, latitude: null }]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      pool.query("SELECT request_booking($1)", [w.input]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("excludes suspended sitters and dogs with existing overlapping stays", async () => {
    const w = await world(140);
    const query = searchSchema.strip().parse(w.input);
    await admin.query('UPDATE "user" SET "isActive"=false WHERE id=$1', [
      w.sitter,
    ]);
    expect(
      (await search(w.owner, query)).matches.some((m) => m.sitter.id === w.sid),
    ).toBe(false);
    await expect(requestBooking(w.owner, w.input)).rejects.toMatchObject({
      code: "P0002",
    });
    await admin.query('UPDATE "user" SET "isActive"=true WHERE id=$1', [
      w.sitter,
    ]);
    const b = await requestBooking(w.owner, w.input);
    await expect(search(w.owner, query)).rejects.toMatchObject({ status: 409 });
    for (const rev of [null, -1])
      await expect(
        transaction(w.sitter, (c) =>
          c.query("SELECT decide_booking($1,'confirmed',$2)", [b.id, rev]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
  });
  it("serializes first-time sitter profile creation without duplicate tenants", async () => {
    const who = await person();
    await Promise.all([
      saveSitter(who, profile),
      saveSitter(who, { ...profile, capacity: 1 }),
    ]);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM sitters WHERE user_id=$1",
          [who],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("signs up synthetic accounts transactionally and refuses real addresses", async () => {
    const signup = (email: string) =>
      auth.handler(
        new Request("http://127.0.0.1:3100/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            origin: "http://127.0.0.1:3100",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Synthetic signup",
            email,
            password: "Synthetic-example-only-123",
          }),
        }),
      );
    const result = await signup(`${randomUUID()}@example.test`);
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toBeTruthy();
    const email = `${randomUUID()}@example.com`;
    expect((await signup(email)).status).not.toBe(200);
    expect(
      (await admin.query('SELECT 1 FROM "user" WHERE email=$1', [email]))
        .rowCount,
    ).toBe(0);
  });
  it("clears pooled actor context after success and rollback", async () => {
    const w = await world(110);
    await dashboard(w.owner);
    await expect(
      transaction(w.owner, async () => {
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    for (let i = 0; i < 15; i++)
      expect((await pool.query("SELECT * FROM dogs")).rows).toHaveLength(0);
  });
  it("rejects unauthenticated routes, cross-origin writes, inactive sessions and leaks no database errors", async () => {
    const ctx = { params: Promise.resolve({ resource: "me" }) };
    expect(
      (await GET(new Request("http://127.0.0.1:3100/api/marketplace/me"), ctx))
        .status,
    ).toBe(401);
    const request = new Request("http://127.0.0.1:3100/api/marketplace/dogs", {
      method: "POST",
      headers: {
        origin: "https://evil.test",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(
      (await POST(request, { params: Promise.resolve({ resource: "dogs" }) }))
        .status,
    ).toBe(403);
    const demo = JSON.parse(await readFile(".local/demo-accounts.json", "utf8"))
      .people[0];
    const signIn = await auth.handler(
      new Request("http://127.0.0.1:3100/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3100",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: demo.email, password: demo.password }),
      }),
    );
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0];
    const req = new Request("http://127.0.0.1:3100/api/marketplace/me", {
      headers: { cookie },
    });
    expect((await GET(req, ctx)).status).toBe(200);
    await admin.query('UPDATE "user" SET "isActive"=false WHERE id=$1', [
      demo.id,
    ]);
    try {
      expect((await GET(req, ctx)).status).toBe(403);
    } finally {
      await admin.query('UPDATE "user" SET "isActive"=true WHERE id=$1', [
        demo.id,
      ]);
    }
  });
});
