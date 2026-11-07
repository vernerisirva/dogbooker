import { createBooking } from "../helpers/bookings";
import { beforeEach, afterAll, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import {
  calendar,
  bookingHistory,
  cancelBooking,
  createBlock,
  unblockDates,
  decideBooking,
} from "@/lib/booking-service";
import * as notifications from "@/lib/notifications";
import { addDays, todayStockholm } from "@/lib/dates";
import type { Actor } from "@/lib/access";
import { auth } from "@/lib/auth";
import { GET as historyGet } from "@/app/api/booking-history/route";
let admin: Actor, a: Actor, b: Actor, password: string;
const startDate = addDays(todayStockholm(), 35),
  month = startDate.slice(0, 7),
  range = { startDate, endDate: startDate };
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
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
});
async function row(id: string) {
  return (
    await pool.query(
      "SELECT booking_status,cancelled_at FROM entries WHERE id=$1",
      [id],
    )
  ).rows[0];
}
async function fixture(owner = a, age: string | null = null, date = startDate) {
  return (
    await pool.query(
      "INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status,cancelled_at,note,arrival_time) VALUES('booking',$1,$2,$2,'cancelled',CASE WHEN $3::text IS NULL THEN NULL ELSE clock_timestamp()-$3::interval END,'PRIVATE','16:45') RETURNING id",
      [owner.id, date, age],
    )
  ).rows[0].id as string;
}
it("timestamps concurrent/repeated cancellations once and keeps a single notification", async () => {
  const x = await createBooking(a, range);
  await Promise.all([cancelBooking(a, x.id), cancelBooking(a, x.id)]);
  const first = await row(x.id);
  expect(first.cancelled_at).toBeInstanceOf(Date);
  await cancelBooking(a, x.id);
  expect(await row(x.id)).toEqual(first);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM notification_jobs WHERE booking_id=$1 AND event='owner_cancelled'",
        [x.id],
      )
    ).rows[0].n,
  ).toBe(1);
  for (const actor of [a, admin])
    expect((await calendar(actor, month)).bookings).toContainEqual(
      expect.objectContaining({
        id: x.id,
        status: "cancelled",
        cancelledAt: first.cancelled_at.toISOString(),
      }),
    );
  expect((await calendar(b, month)).bookings).toHaveLength(0);
  await createBooking(a, range);
});
it("shows only recent cancellations for both roles, regardless of original stay dates", async () => {
  const recent = await fixture(a, "23 hours 59 minutes");
  const pastRecent = await fixture(a, "1 hour", addDays(todayStockholm(), -90));
  const expired = await fixture(a, "24 hours"),
    legacy = await fixture(),
    future = await fixture(a, "-1 hour");
  for (const actor of [a, admin]) {
    const ids = (await calendar(actor, month)).bookings.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([recent, pastRecent]));
    for (const id of [expired, legacy, future]) expect(ids).not.toContain(id);
    const history = (await bookingHistory(actor)).bookings.map((x) => x.id);
    expect(history).toEqual(
      expect.arrayContaining([recent, pastRecent, expired, legacy, future]),
    );
  }
  await cancelBooking(a, legacy);
  expect((await row(legacy)).cancelled_at).toBeNull();
  expect(
    (await pool.query("SELECT count(*)::int n FROM entries")).rows[0].n,
  ).toBe(5);
});
it("keeps pending/confirmed stays, leaves declined timestamps empty and records admin cancellation", async () => {
  const x = await createBooking(a, range),
    y = await createBooking(b, range);
  await decideBooking(admin, y.id, "confirmed");
  expect((await calendar(admin, month)).bookings.map((x) => x.status)).toEqual([
    "pending",
    "confirmed",
  ]);
  await cancelBooking(admin, y.id);
  expect((await row(y.id)).cancelled_at).toBeInstanceOf(Date);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM notification_jobs WHERE booking_id=$1 AND event='admin_cancelled'",
        [y.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await decideBooking(admin, x.id, "declined");
  expect((await row(x.id)).cancelled_at).toBeNull();
});
it("rolls back timestamp and cancellation when notification persistence fails", async () => {
  const x = await createBooking(a, range);
  const spy = vi
    .spyOn(notifications, "enqueueNotification")
    .mockRejectedValueOnce(new Error("fixture outbox failure"));
  try {
    await expect(cancelBooking(a, x.id)).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }
  expect(await row(x.id)).toEqual({
    booking_status: "pending",
    cancelled_at: null,
  });
});
it("timestamps old-version SQL cancellations but never admin blocks", async () => {
  const x = await createBooking(a, range);
  await pool.query("UPDATE entries SET status='cancelled' WHERE id=$1", [x.id]);
  const first = await row(x.id);
  expect(first.booking_status).toBe("cancelled");
  expect(first.cancelled_at).toBeInstanceOf(Date);
  await pool.query(
    "UPDATE entries SET booking_status='cancelled',cancelled_at=clock_timestamp()+interval '1 day' WHERE id=$1",
    [x.id],
  );
  expect(await row(x.id)).toEqual(first);
  const block = await createBlock(admin, range);
  await unblockDates(admin, range);
  expect((await row(block.id)).cancelled_at).toBeNull();
});
it("paginates permanent history without exposing another owner or private notes", async () => {
  for (let i = 0; i < 52; i++) await fixture(a, null, addDays(startDate, i));
  const other = await fixture(b);
  const page = await bookingHistory(a);
  expect(page.bookings).toHaveLength(50);
  expect(page.nextOffset).toBe(50);
  const last = await bookingHistory(a, 50);
  expect(last.bookings).toHaveLength(2);
  expect(last.nextOffset).toBeNull();
  expect(
    new Set([...page.bookings, ...last.bookings].map((x) => x.id)).size,
  ).toBe(52);
  expect(JSON.stringify(page)).not.toContain("PRIVATE");
  expect(page.bookings.map((x) => x.id)).not.toContain(other);
  expect(
    (await bookingHistory(admin)).bookings.some(
      (x) => "note" in x && x.note === "PRIVATE",
    ),
  ).toBe(true);
  await expect(bookingHistory(a, -1)).rejects.toMatchObject({ status: 400 });
});
it("authenticates history and ignores forged owner selectors", async () => {
  const own = await fixture(),
    other = await fixture(b);
  const url = `http://localhost:3000/api/booking-history?ownerId=${b.id}`;
  expect((await historyGet(new Request(url))).status).toBe(401);
  const login = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: a.email, password }),
    }),
  );
  const cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const response = await historyGet(new Request(url, { headers: { cookie } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const data = await response.json();
  expect(data.bookings.map((x: { id: string }) => x.id)).toEqual([own]);
  expect(JSON.stringify(data)).not.toContain(other);
  expect(
    (
      await historyGet(
        new Request(url + "&offset=NaN", { headers: { cookie } }),
      )
    ).status,
  ).toBe(400);
});
