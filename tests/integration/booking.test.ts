import { createBooking } from "../helpers/bookings";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import {
  createBlock,
  cancelBooking,
  modifyBooking,
  unblockDates,
  calendar,
} from "@/lib/booking-service";
import {
  acceptInvitation,
  reissueInvite,
  updateOwner,
  inviteOwner,
} from "@/lib/invitations";
import { addDays, todayStockholm } from "@/lib/dates";
import type { Actor } from "@/lib/access";
import { requireActor } from "@/lib/access";
import { auth } from "@/lib/auth";
import { GET as getCalendar } from "@/app/api/calendar/route";
import { POST as postBooking } from "@/app/api/bookings/route";
import { POST as postDecision } from "@/app/api/bookings/[id]/decision/route";
import {
  GET as getNotifications,
  POST as postNotifications,
} from "@/app/api/notifications/route";
import { POST as postBlock } from "@/app/api/blocks/route";
let admin: Actor, a: Actor, b: Actor, password: string;
const day = (n: number) => addDays(todayStockholm(), n);
const range = (n: number, len = 1) => ({
  startDate: day(n),
  endDate: day(n + len - 1),
});
async function login(email: string, pass = password) {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-real-ip": "127.0.0.1",
      },
      body: JSON.stringify({ email, password: pass }),
    }),
  );
}
beforeAll(async () => {
  const users = await seedTestDatabase();
  [admin, a, b] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Actor["role"],
    dogName: u.dog,
  }));
  password = users[0].password;
});
afterAll(() => pool.end());
describe("real PostgreSQL booking lifecycle", () => {
  it("reserves inclusive consecutive dates, hides personal details and persists", async () => {
    const booking = await createBooking(a, {
      ...range(10, 3),
      note: "ignored owner note",
      ownerId: b.id,
    });
    const state = await calendar(a, day(10).slice(0, 7));
    expect(state.bookings).toContainEqual(
      expect.objectContaining({
        id: booking.id,
        startDate: day(10),
        endDate: day(12),
      }),
    );
    const other = await calendar(b, day(10).slice(0, 7));
    expect(other.bookings).toEqual([]);
    expect(JSON.stringify(other.entries)).not.toContain(a.id);
    expect(JSON.stringify(other.entries)).not.toContain("Alice");
    expect(other.owners).toEqual([]);
    await expect(createBooking(a, range(12))).rejects.toMatchObject({
      status: 409,
    });
    await expect(cancelBooking(b, booking.id)).rejects.toMatchObject({
      status: 404,
    });
    await cancelBooking(a, booking.id);
    await expect(createBooking(b, range(12))).resolves.toHaveProperty("id");
  });
  it("admits exactly one of two concurrent overlapping requests", async () => {
    const results = await Promise.allSettled([
      createBooking(a, range(20, 3)),
      createBooking(a, range(21, 3)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const failure = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason.status).toBe(409);
  });
  it("rejects blocks over bookings and bookings over blocks", async () => {
    await createBlock(admin, { ...range(30, 5), note: "Private travel plan" });
    await expect(createBooking(a, range(31))).rejects.toMatchObject({
      status: 409,
    });
    await createBooking(a, range(40));
    await expect(createBlock(admin, range(40))).rejects.toMatchObject({
      status: 409,
    });
    const visible = await calendar(a, day(30).slice(0, 7));
    expect(JSON.stringify(visible)).not.toContain("Private travel plan");
  });
  it("partially unblocks a range without releasing its edges", async () => {
    await unblockDates(admin, range(31, 2));
    await createBooking(a, range(31, 2));
    await expect(createBooking(b, range(30))).rejects.toMatchObject({
      status: 409,
    });
    await expect(createBooking(b, range(33))).rejects.toMatchObject({
      status: 409,
    });
  });
  it("rolls back a conflicting edit and releases old dates after a valid edit", async () => {
    const first = await createBooking(a, range(50, 2));
    await createBlock(admin, range(55));
    await expect(
      modifyBooking(admin, first.id, range(55)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(createBooking(a, range(50))).rejects.toMatchObject({
      status: 409,
    });
    await modifyBooking(admin, first.id, {
      ...range(58, 2),
      note: "Admin only",
    });
    await createBooking(b, range(50));
    const state = await calendar(a, day(58).slice(0, 7));
    expect(JSON.stringify(state)).not.toContain("Admin only");
  });
  it("enforces roles, valid dates and future cancellation rules", async () => {
    await expect(createBlock(a, range(60))).rejects.toMatchObject({
      status: 403,
    });
    await expect(unblockDates(a, range(60))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      modifyBooking(a, crypto.randomUUID(), range(60)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createBooking(a, { startDate: day(-1), endDate: day(1) }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createBooking(a, { startDate: "2026-02-30", endDate: "2026-02-30" }),
    ).rejects.toMatchObject({ status: 400 });
    const today = await createBooking(a, range(0));
    await expect(cancelBooking(a, today.id)).rejects.toMatchObject({
      status: 400,
    });
    await cancelBooking(admin, today.id);
  });
});
describe("authentication, authorization and invitations", () => {
  it("denies anonymous and cross-origin requests", async () => {
    expect(
      (await getCalendar(new Request("http://localhost:3000/api/calendar")))
        .status,
    ).toBe(401);
    expect(
      (
        await postBooking(
          new Request("http://localhost:3000/api/bookings", {
            method: "POST",
            headers: {
              origin: "https://evil.example",
              "content-type": "application/json",
            },
            body: JSON.stringify(range(70)),
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("disables public registration", async () => {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Intruder",
          email: "intruder@example.test",
          password,
        }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it("signs in with Better Auth and enforces owner role on HTTP routes", async () => {
    const response = await login(a.email);
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");
    const actor = await requireActor(new Headers({ cookie }));
    expect(actor.id).toBe(a.id);
    const blocked = await postBlock(
      new Request("http://localhost:3000/api/blocks", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify(range(70)),
      }),
    );
    expect(blocked.status).toBe(403);
    const headers = {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    };
    const decision = await postDecision(
      new Request("http://localhost:3000/api/bookings/id/decision", {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "confirmed", expectedRevision: 0 }),
      }),
      { params: Promise.resolve({ id: crypto.randomUUID() }) },
    );
    expect(decision.status).toBe(403);
    expect(
      (
        await postNotifications(
          new Request("http://localhost:3000/api/notifications", {
            method: "POST",
            headers,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await getNotifications(
          new Request("http://localhost:3000/api/notifications"),
        )
      ).status,
    ).toBe(401);
  });
  it("enforces an explicitly configured two-owner limit", async () => {
    vi.stubEnv("MAX_OWNERS", "2");
    try {
      await expect(
        inviteOwner(admin, {
          name: "Third",
          email: "third@example.test",
          dogName: "Third dog",
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(reissueInvite(a, b.id)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("consumes an invitation exactly once and revokes previous sessions", async () => {
    const response = await login(b.email);
    expect(response.status).toBe(200);
    const oldCookie = response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const invite = await reissueInvite(admin, b.id);
    const token = invite.url.split("#")[1];
    const results = await Promise.allSettled([
      acceptInvitation({ token, password: password + "new" }),
      acceptInvitation({ token, password: password + "other" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await expect(
      requireActor(new Headers({ cookie: oldCookie })),
    ).rejects.toMatchObject({ status: 401 });
    expect((await login(b.email)).status).toBeGreaterThanOrEqual(400);
  });
  it("rejects expired invitations and paused accounts", async () => {
    const invite = await reissueInvite(admin, a.id);
    await pool.query(
      "UPDATE invitations SET expires_at=now()-interval '1 hour' WHERE user_id=$1",
      [a.id],
    );
    await expect(
      acceptInvitation({ token: invite.url.split("#")[1], password }),
    ).rejects.toMatchObject({ status: 400 });
    await updateOwner(admin, a.id, {
      name: a.name,
      email: a.email,
      dogName: "Luna",
      isActive: false,
    });
    expect((await login(a.email)).status).toBeGreaterThanOrEqual(400);
    await expect(createBooking(a, range(75))).rejects.toMatchObject({
      status: 400,
    });
  });
});
