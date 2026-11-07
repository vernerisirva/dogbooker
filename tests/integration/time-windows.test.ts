import { beforeEach, afterAll, it, expect } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import { getTimeWindows, updateTimeWindows } from "@/lib/time-window-service";
import { createBooking, decideBooking, calendar } from "@/lib/booking-service";
import { changeBookingTimes, decideTimeProposal } from "@/lib/arrival-service";
import { addDays, todayStockholm } from "@/lib/dates";
import type { Actor } from "@/lib/access";
import { auth } from "@/lib/auth";
import { PUT } from "@/app/api/time-windows/route";
import { POST } from "@/app/api/bookings/[id]/time-proposals/route";
let admin: Actor, a: Actor, b: Actor, password: string;
const range = {
  startDate: addDays(todayStockholm(), 90),
  endDate: addDays(todayStockholm(), 92),
  arrivalTime: "08:00",
  pickupTime: "18:00",
};
const windows = {
  arrivalStart: "07:00",
  arrivalEnd: "10:00",
  pickupStart: "16:00",
  pickupEnd: "20:00",
};
beforeEach(async () => {
  const people = await seedTestDatabase();
  password = people[1].password;
  [admin, a, b] = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role as Actor["role"],
    dogName: p.dog,
  }));
});
afterAll(() => pool.end());
it("authorizes settings and applies defaults and per-day overrides", async () => {
  await expect(
    updateTimeWindows(a, { expectedRevision: 0, windows }),
  ).rejects.toMatchObject({ status: 403 });
  await updateTimeWindows(admin, { expectedRevision: 0, windows });
  await expect(
    createBooking(a, { ...range, arrivalTime: "10:15" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    createBooking(a, { ...range, pickupTime: "15:45" }),
  ).rejects.toMatchObject({ status: 400 });
  await updateTimeWindows(admin, {
    expectedRevision: 1,
    date: range.startDate,
    windows: { ...windows, arrivalStart: "09:00" },
  });
  await expect(createBooking(a, range)).rejects.toMatchObject({ status: 400 });
  await updateTimeWindows(admin, {
    expectedRevision: 2,
    date: range.endDate,
    windows: { ...windows, pickupStart: "19:00" },
  });
  await expect(
    createBooking(a, { ...range, arrivalTime: "09:00" }),
  ).rejects.toMatchObject({ status: 400 });
  await createBooking(a, {
    ...range,
    arrivalTime: "09:00",
    pickupTime: "19:00",
  });
  await updateTimeWindows(admin, {
    expectedRevision: 3,
    date: range.startDate,
    windows: null,
  });
  expect((await getTimeWindows()).overrides).toHaveLength(1);
});
it("keeps already approved times effective after narrowing windows and checks only changed fields", async () => {
  const x = await createBooking(a, range);
  await decideBooking(admin, x.id, "confirmed");
  await updateTimeWindows(admin, {
    expectedRevision: 0,
    windows: { ...windows, arrivalStart: "09:00" },
  });
  expect(
    (await calendar(a, range.startDate.slice(0, 7))).bookings[0],
  ).toMatchObject({ arrivalTime: "08:00", status: "confirmed" });
  await changeBookingTimes(a, x.id, {
    pickupTime: "19:00",
    expectedRevision: 0,
  });
  await expect(
    changeBookingTimes(b, x.id, { pickupTime: "19:00", expectedRevision: 1 }),
  ).rejects.toMatchObject({ status: 404 });
  const p = (await calendar(a, range.startDate.slice(0, 7))).bookings[0]
    .timeProposal!;
  await decideTimeProposal(admin, x.id, {
    action: "approve",
    proposalId: p.id,
    expectedRevision: 1,
  });
  expect(
    (await calendar(a, range.startDate.slice(0, 7))).bookings[0],
  ).toMatchObject({
    arrivalTime: "08:00",
    pickupTime: "19:00",
    status: "confirmed",
  });
  await expect(
    changeBookingTimes(a, x.id, { arrivalTime: "08:15", expectedRevision: 2 }),
  ).rejects.toMatchObject({ status: 400 });
});
it("allows explicit administrator exceptions without relaxing owner validation", async () => {
  await updateTimeWindows(admin, { expectedRevision: 0, windows });
  const x = await createBooking(a, range);
  await decideTimeProposal(admin, x.id, {
    action: "propose",
    arrivalTime: "11:00",
    pickupTime: "21:00",
    expectedRevision: 0,
  });
  const p = (await calendar(a, range.startDate.slice(0, 7))).bookings[0]
    .timeProposal!;
  await decideTimeProposal(a, x.id, {
    action: "approve",
    proposalId: p.id,
    expectedRevision: 1,
  });
  expect(
    (await calendar(a, range.startDate.slice(0, 7))).bookings[0].arrivalTime,
  ).toBe("11:00");
  await changeBookingTimes(admin, x.id, {
    arrivalTime: "12:00",
    expectedRevision: 2,
  });
});
it("rejects stale settings writes and serializes competing date overrides", async () => {
  const r = await Promise.allSettled([
    updateTimeWindows(admin, { expectedRevision: 0, windows }),
    updateTimeWindows(admin, {
      expectedRevision: 0,
      date: range.startDate,
      windows,
    }),
  ]);
  expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(r.find((x) => x.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  expect((await getTimeWindows()).revision).toBe(1);
});
it("validates against a concurrent window change after waiting on its database lock", async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "UPDATE time_window_settings SET arrival_start='09:00',revision=revision+1 WHERE id=true",
    );
    const request = createBooking(a, range).then(
      () => 200,
      (e) => e.status,
    );
    await c.query("COMMIT");
    expect(await request).toBe(400);
    expect((await pool.query("SELECT id FROM entries")).rowCount).toBe(0);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
it("enforces SQL window bounds and quarter hours", async () => {
  for (const value of ["05:00", "23:15", "12:01"])
    await expect(
      pool.query("UPDATE time_window_settings SET arrival_start=$1::time", [
        value,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query(
      "UPDATE time_window_settings SET arrival_start='12:00',arrival_end='11:00'",
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it("protects APIs against anonymous access, owner settings writes, forged approval and cross-origin requests", async () => {
  const x = await createBooking(a, range);
  const p = await changeBookingTimes(a, x.id, {
    arrivalTime: "09:00",
    expectedRevision: 0,
  });
  const origin = process.env.BETTER_AUTH_URL!;
  const login = await auth.handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: a.email, password }),
    }),
  );
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const request = (
    path: string,
    body: unknown,
    signed = true,
    source = origin,
  ) =>
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: source,
        ...(signed ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  expect(
    (
      await PUT(
        request("/api/time-windows", { windows, expectedRevision: 0 }, false),
      )
    ).status,
  ).toBe(401);
  expect(
    (await PUT(request("/api/time-windows", { windows, expectedRevision: 0 })))
      .status,
  ).toBe(403);
  const decision = {
    action: "approve",
    proposalId: p.proposalId,
    expectedRevision: 1,
  };
  const ctx = { params: Promise.resolve({ id: x.id }) };
  expect(
    (await POST(request(`/api/bookings/${x.id}/time-proposals`, decision), ctx))
      .status,
  ).toBe(403);
  expect(
    (
      await POST(
        request(
          `/api/bookings/${x.id}/time-proposals`,
          decision,
          true,
          "https://evil.example",
        ),
        ctx,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        request(`/api/bookings/${x.id}/time-proposals`, {
          ...decision,
          role: "admin",
        }),
        ctx,
      )
    ).status,
  ).toBe(400);
});
