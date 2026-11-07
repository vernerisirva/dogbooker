import { beforeEach, afterAll, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import { createBooking } from "../helpers/bookings";
import {
  createBooking as createRaw,
  calendar,
  cancelBooking,
  decideBooking,
  modifyBooking,
} from "@/lib/booking-service";
import { changeBookingTimes, decideTimeProposal } from "@/lib/arrival-service";
import { addDays, todayStockholm } from "@/lib/dates";
import type { Actor } from "@/lib/access";
let admin: Actor, a: Actor, b: Actor;
const range = {
  startDate: addDays(todayStockholm(), 65),
  endDate: addDays(todayStockholm(), 67),
};
beforeEach(async () => {
  [admin, a, b] = (await seedTestDatabase()).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role as Actor["role"],
    dogName: p.dog,
  }));
  vi.stubEnv("BETTER_AUTH_URL", "https://dogbooker.example.test");
  vi.stubEnv("GMAIL_USER", "admin@example.test");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
});
async function row(id: string) {
  return (
    await pool.query(
      "SELECT left(arrival_time::text,5) AS arrival,left(pickup_time::text,5) AS pickup,arrival_revision AS revision,booking_status AS status FROM entries WHERE id=$1",
      [id],
    )
  ).rows[0];
}
async function proposal(id: string) {
  return (
    await pool.query(
      "SELECT id,revision FROM booking_time_proposals WHERE booking_id=$1 AND status='pending'",
      [id],
    )
  ).rows[0];
}
async function answer(
  actor: Actor,
  id: string,
  action: "approve" | "decline" = "approve",
) {
  const p = await proposal(id);
  return decideTimeProposal(actor, id, {
    action,
    proposalId: p.id,
    expectedRevision: p.revision,
  });
}

it("requires both times on new requests and validates range and same-day ordering", async () => {
  await expect(createRaw(a, range)).rejects.toMatchObject({ status: 400 });
  for (const arrivalTime of ["05:45", "23:15", "10:01"])
    await expect(createBooking(a, { ...range, arrivalTime })).rejects.toThrow();
  for (const pickupTime of ["09:45", "10:00"])
    await expect(
      createBooking(a, { ...range, endDate: range.startDate, pickupTime }),
    ).rejects.toMatchObject({ status: 400 });
  const x = await createBooking(a, {
    ...range,
    endDate: range.startDate,
    pickupTime: "11:00",
  });
  await expect(
    changeBookingTimes(a, x.id, { arrivalTime: "12:00", expectedRevision: 0 }),
  ).rejects.toMatchObject({ status: 400 });
  await changeBookingTimes(a, x.id, {
    arrivalTime: "12:00",
    pickupTime: "13:00",
    expectedRevision: 0,
  });
  await answer(admin, x.id);
  expect(await row(x.id)).toMatchObject({ arrival: "12:00", pickup: "13:00" });
});
it("enforces database checks even for direct SQL and date edits", async () => {
  const x = await createBooking(a, { ...range, endDate: range.startDate });
  for (const [field, time] of [
    ["arrival_time", "05:45"],
    ["arrival_time", "23:15"],
    ["pickup_time", "05:45"],
    ["pickup_time", "23:15"],
    ["pickup_time", "12:01"],
    ["pickup_time", "12:15:01"],
    ["pickup_time", "10:00"],
  ])
    await expect(
      pool.query(`UPDATE entries SET ${field}=$2::time WHERE id=$1`, [
        x.id,
        time,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  const y = await createBooking(b, {
    ...range,
    arrivalTime: "23:00",
    pickupTime: "06:00",
  });
  await expect(
    modifyBooking(admin, y.id, {
      startDate: range.startDate,
      endDate: range.startDate,
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("checks independent arrival/pickup deadlines on the Stockholm dates and permits admin edits later", async () => {
  const x = await createBooking(a, range);
  await pool.query("UPDATE entries SET start_date=$2,end_date=$3 WHERE id=$1", [
    x.id,
    addDays(todayStockholm(), -1),
    todayStockholm(),
  ]);
  expect(
    (await calendar(a, todayStockholm().slice(0, 7))).bookings[0],
  ).toMatchObject({ canEditArrival: false, canEditPickup: true });
  await expect(
    changeBookingTimes(a, x.id, {
      arrivalTime: "11:00",
      pickupTime: "19:00",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await changeBookingTimes(a, x.id, {
    pickupTime: "19:00",
    expectedRevision: 1,
  });
  await answer(admin, x.id);
  expect((await row(x.id)).pickup).toBe("19:00");
  await pool.query("UPDATE entries SET end_date=start_date WHERE id=$1", [
    x.id,
  ]);
  await expect(
    changeBookingTimes(a, x.id, { pickupTime: "20:00", expectedRevision: 4 }),
  ).rejects.toMatchObject({ status: 403 });
  await changeBookingTimes(admin, x.id, {
    arrivalTime: "11:00",
    pickupTime: "20:00",
    expectedRevision: 4,
  });
  expect(await row(x.id)).toMatchObject({
    arrival: "11:00",
    pickup: "20:00",
    status: "pending",
  });
});
it("rechecks the deadline after a competing row lock instead of trusting client time", async () => {
  const x = await createBooking(a, {
    startDate: todayStockholm(),
    endDate: todayStockholm(),
  });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("UPDATE entries SET start_date=$2,end_date=$2 WHERE id=$1", [
      x.id,
      addDays(todayStockholm(), -1),
    ]);
    const work = changeBookingTimes(a, x.id, {
      pickupTime: "19:00",
      expectedRevision: 0,
    }).then(
      () => 200,
      (e) => e.status,
    );
    await c.query("COMMIT");
    expect(await work).toBe(403);
    expect((await row(x.id)).pickup).toBe("18:00");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
it("serializes different concurrent requests and direct edits without lost updates", async () => {
  const x = await createBooking(a, range);
  const outcomes = await Promise.allSettled([
    changeBookingTimes(a, x.id, { arrivalTime: "11:00", expectedRevision: 0 }),
    changeBookingTimes(a, x.id, { pickupTime: "19:00", expectedRevision: 0 }),
  ]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find((x) => x.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  const p = await proposal(x.id);
  const race = await Promise.allSettled([
    decideTimeProposal(admin, x.id, {
      action: "approve",
      proposalId: p.id,
      expectedRevision: 1,
    }),
    changeBookingTimes(admin, x.id, {
      arrivalTime: "12:00",
      expectedRevision: 1,
    }),
  ]);
  expect(race.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect((await row(x.id)).revision).toBe(2);
});
it("prevents any time editing after cancellation or decline, including racing requests", async () => {
  const x = await createBooking(a, range);
  await Promise.allSettled([
    changeBookingTimes(a, x.id, { pickupTime: "19:00", expectedRevision: 0 }),
    cancelBooking(a, x.id),
  ]);
  expect(await proposal(x.id)).toBeUndefined();
  const y = await createBooking(a, range);
  await decideBooking(admin, y.id, "declined");
  for (const id of [x.id, y.id])
    for (const actor of [a, admin])
      await expect(
        changeBookingTimes(actor, id, {
          pickupTime: "20:00",
          expectedRevision: 0,
        }),
      ).rejects.toMatchObject({ status: 403 });
});
it("preserves missing legacy times and unchanged legacy arrivals outside the new interval", async () => {
  const x = await createBooking(a, range);
  await pool.query(
    "UPDATE entries SET arrival_time=NULL,pickup_time=NULL WHERE id=$1",
    [x.id],
  );
  await changeBookingTimes(a, x.id, {
    pickupTime: "19:00",
    expectedRevision: 0,
  });
  await answer(admin, x.id);
  expect(await row(x.id)).toMatchObject({ arrival: null, pickup: "19:00" });
  await changeBookingTimes(admin, x.id, {
    pickupTime: null,
    expectedRevision: 2,
  });
  expect((await row(x.id)).pickup).toBeNull();
});
it("includes effective arrival and pickup times in requests and booking confirmations", async () => {
  const x = await createBooking(a, {
    ...range,
    arrivalTime: "07:15",
    pickupTime: "22:45",
  });
  await decideBooking(admin, x.id, "confirmed");
  const jobs = (
    await pool.query(
      "SELECT payload FROM notification_jobs WHERE booking_id=$1",
      [x.id],
    )
  ).rows;
  expect(jobs).toHaveLength(2);
  for (const j of jobs)
    expect(j.payload).toMatchObject({
      arrivalTime: "07:15",
      pickupTime: "22:45",
    });
});
