import { beforeEach, afterAll, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import { createBooking } from "../helpers/bookings";
import {
  calendar,
  cancelBooking,
  decideBooking,
  modifyBooking,
  createBlock,
} from "@/lib/booking-service";
import {
  changeBookingTimes,
  changeArrivalTime,
  decideTimeProposal,
} from "@/lib/arrival-service";
import * as notifications from "@/lib/notifications";
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

it("keeps effective times and confirmed status until the administrator approves", async () => {
  const x = await createBooking(a, range);
  await decideBooking(admin, x.id, "confirmed");
  const request = await changeArrivalTime(a, x.id, {
    arrivalTime: "11:15",
    expectedRevision: 0,
  });
  expect(await row(x.id)).toMatchObject({
    arrival: "10:00",
    pickup: "18:00",
    status: "confirmed",
    revision: 1,
  });
  await expect(answer(a, x.id)).rejects.toMatchObject({ status: 403 });
  await answer(admin, x.id);
  expect(await row(x.id)).toMatchObject({
    arrival: "11:15",
    status: "confirmed",
    revision: 2,
  });
  await decideTimeProposal(admin, x.id, {
    action: "approve",
    proposalId: request.proposalId!,
    expectedRevision: 1,
  });
  expect(
    (
      await pool.query(
        "SELECT event FROM notification_jobs WHERE event='time_change_approved' AND booking_id=$1",
        [x.id],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(createBooking(a, range)).rejects.toMatchObject({ status: 409 });
  await expect(createBlock(admin, range)).rejects.toMatchObject({
    status: 409,
  });
});
it("declines changes without changing effective times or booking approval", async () => {
  const x = await createBooking(a, range);
  await decideBooking(admin, x.id, "confirmed");
  await changeBookingTimes(a, x.id, {
    pickupTime: "19:00",
    expectedRevision: 0,
  });
  await answer(admin, x.id, "decline");
  expect(await row(x.id)).toMatchObject({
    arrival: "10:00",
    pickup: "18:00",
    status: "confirmed",
    revision: 2,
  });
  expect(await proposal(x.id)).toBeUndefined();
  const job = (
    await pool.query(
      "SELECT * FROM notification_jobs WHERE event='time_change_declined'",
      [],
    )
  ).rows[0];
  expect(job).toMatchObject({
    recipient_id: a.id,
    payload: {
      previousPickupTime: "18:00",
      proposedPickupTime: "19:00",
      pickupTime: "18:00",
    },
  });
});
it("counter-proposes atomically, rejects stale approval and requires owner acceptance", async () => {
  const x = await createBooking(a, range);
  const old = await changeBookingTimes(a, x.id, {
    arrivalTime: "11:00",
    expectedRevision: 0,
  });
  await decideTimeProposal(admin, x.id, {
    action: "propose",
    arrivalTime: "12:00",
    pickupTime: "20:00",
    expectedRevision: 1,
  });
  await expect(
    decideTimeProposal(admin, x.id, {
      action: "approve",
      proposalId: old.proposalId!,
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(answer(admin, x.id)).rejects.toMatchObject({ status: 403 });
  await expect(answer(b, x.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    decideBooking(admin, x.id, "confirmed", 2),
  ).rejects.toMatchObject({ status: 409 });
  await answer(a, x.id);
  expect(await row(x.id)).toMatchObject({
    arrival: "12:00",
    pickup: "20:00",
    status: "pending",
    revision: 3,
  });
  await expect(
    decideBooking(admin, x.id, "confirmed", 0),
  ).rejects.toMatchObject({ status: 409 });
  await decideBooking(admin, x.id, "confirmed", 3);
  expect((await row(x.id)).status).toBe("confirmed");
});
it("allows owners to reject admin proposals and admins to supersede with a direct edit", async () => {
  const x = await createBooking(a, range);
  await decideTimeProposal(admin, x.id, {
    action: "propose",
    arrivalTime: "12:00",
    pickupTime: "20:00",
    expectedRevision: 0,
  });
  await answer(a, x.id, "decline");
  expect((await row(x.id)).arrival).toBe("10:00");
  await changeBookingTimes(a, x.id, {
    arrivalTime: "11:00",
    expectedRevision: 2,
  });
  const p = await proposal(x.id);
  await changeBookingTimes(admin, x.id, {
    arrivalTime: "13:00",
    expectedRevision: 3,
  });
  expect(await proposal(x.id)).toBeUndefined();
  await expect(
    decideTimeProposal(admin, x.id, {
      action: "approve",
      proposalId: p.id,
      expectedRevision: 3,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await row(x.id)).arrival).toBe("13:00");
});
it("serializes duplicate requests and concurrent approve/reject decisions", async () => {
  const x = await createBooking(a, range);
  await Promise.all(
    [1, 2].map(() =>
      changeBookingTimes(a, x.id, {
        arrivalTime: "11:00",
        expectedRevision: 0,
      }),
    ),
  );
  expect(
    (
      await pool.query(
        "SELECT id FROM notification_jobs WHERE event='time_change_requested'",
      )
    ).rowCount,
  ).toBe(1);
  await expect(
    changeBookingTimes(a, x.id, { pickupTime: "19:00", expectedRevision: 1 }),
  ).rejects.toMatchObject({ status: 409 });
  const p = await proposal(x.id);
  const results = await Promise.allSettled(
    ["approve", "decline"].map((action) =>
      decideTimeProposal(admin, x.id, {
        action: action as "approve" | "decline",
        proposalId: p.id,
        expectedRevision: 1,
      }),
    ),
  );
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.find((x) => x.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
});
it("rolls back proposals and revisions on outbox failure and preserves retry payloads", async () => {
  const x = await createBooking(a, range);
  await notifications.deliverNotifications({ send: async () => "request" });
  const spy = vi
    .spyOn(notifications, "enqueueNotification")
    .mockRejectedValueOnce(new Error("fixture"));
  await expect(
    changeBookingTimes(a, x.id, { arrivalTime: "11:00", expectedRevision: 0 }),
  ).rejects.toThrow();
  spy.mockRestore();
  expect((await row(x.id)).revision).toBe(0);
  expect(await proposal(x.id)).toBeUndefined();
  await changeBookingTimes(a, x.id, {
    arrivalTime: "11:00",
    expectedRevision: 0,
  });
  const sent: unknown[] = [];
  await notifications.deliverNotifications({
    send: async (mail, key) => {
      sent.push({ mail, key });
      throw new notifications.DeliveryError("smtp_retryable_451", false);
    },
  });
  expect((await row(x.id)).arrival).toBe("10:00");
  await pool.query(
    "UPDATE notification_jobs SET available_at=now() WHERE event='time_change_requested'",
  );
  await notifications.deliverNotifications({
    send: async (mail, key) => {
      expect({ mail, key }).toEqual(sent[0]);
      return "delivered";
    },
  });
  const job = (
    await pool.query(
      "SELECT * FROM notification_jobs WHERE event='time_change_requested'",
    )
  ).rows[0];
  expect(job).toMatchObject({
    state: "sent",
    attempts: 2,
    recipient_id: admin.id,
  });
  await answer(admin, x.id);
  await notifications.deliverNotifications({
    send: async () => {
      throw new notifications.DeliveryError("smtp_delivery_uncertain");
    },
  });
  expect((await row(x.id)).arrival).toBe("11:00");
  expect(
    (
      await pool.query(
        "SELECT state FROM notification_jobs WHERE event='time_change_approved'",
      )
    ).rows[0].state,
  ).toBe("needs_review");
});
it("invalidates proposals after date edits, cancellation or decline without losing history", async () => {
  for (const action of ["dates", "cancel", "decline"]) {
    const x = await createBooking(a, range);
    const p = await changeBookingTimes(a, x.id, {
      arrivalTime: "11:00",
      expectedRevision: 0,
    });
    if (action === "dates")
      await modifyBooking(admin, x.id, {
        startDate: addDays(range.startDate, 1),
        endDate: range.endDate,
      });
    if (action === "cancel") await cancelBooking(a, x.id);
    if (action === "decline") await decideBooking(admin, x.id, "declined");
    expect(await proposal(x.id)).toBeUndefined();
    await expect(
      decideTimeProposal(admin, x.id, {
        action: "approve",
        proposalId: p.proposalId!,
        expectedRevision: 1,
      }),
    ).rejects.toBeDefined();
    if (action === "dates") await cancelBooking(a, x.id);
  }
  expect(
    (await pool.query("SELECT status FROM booking_time_proposals")).rows.map(
      (x) => x.status,
    ),
  ).toEqual(["superseded", "superseded", "superseded"]);
});
it("never exposes another owner’s effective times or proposals in calendar/history DTOs", async () => {
  const x = await createBooking(a, {
    ...range,
    arrivalTime: "08:45",
    pickupTime: "21:15",
  });
  await decideBooking(admin, x.id, "confirmed");
  await changeBookingTimes(a, x.id, {
    arrivalTime: "09:45",
    expectedRevision: 0,
  });
  const other = await calendar(b, range.startDate.slice(0, 7));
  expect(other.entries).toContainEqual({
    ...range,
    state: "companion",
    dogName: "Luna",
  });
  expect(JSON.stringify(other)).not.toMatch(/08:45|09:45|21:15|proposerRole/);
  const own = (await calendar(a, range.startDate.slice(0, 7))).bookings[0];
  expect(own).toMatchObject({
    arrivalTime: "08:45",
    timeProposal: { arrivalTime: "09:45", proposerRole: "owner" },
  });
  await expect(
    changeArrivalTime(b, x.id, { arrivalTime: "08:00", expectedRevision: 1 }),
  ).rejects.toMatchObject({ status: 404 });
});

it("keeps outstanding proposals visible after the stay and supports partial legacy counter-proposals", async () => {
  const x = await createBooking(a, range);
  await decideBooking(admin, x.id, "confirmed");
  await pool.query(
    "UPDATE entries SET start_date=$2,end_date=$2,arrival_time=NULL WHERE id=$1",
    [x.id, addDays(todayStockholm(), -40)],
  );
  await decideTimeProposal(admin, x.id, {
    action: "propose",
    pickupTime: "19:00",
    expectedRevision: 1,
  });
  for (const actor of [admin, a])
    expect(
      (await calendar(actor, todayStockholm().slice(0, 7))).bookings,
    ).toContainEqual(
      expect.objectContaining({
        id: x.id,
        arrivalTime: null,
        timeProposal: expect.objectContaining({ pickupTime: "19:00" }),
      }),
    );
  // The administrator already authorized this proposal; acceptance is not an owner-initiated late request.
  await answer(a, x.id);
  expect(await row(x.id)).toMatchObject({
    arrival: null,
    pickup: "19:00",
    status: "confirmed",
  });
});
