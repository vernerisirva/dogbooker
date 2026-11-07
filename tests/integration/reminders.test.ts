import { beforeEach, afterAll, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import { enqueueDueReminders } from "@/lib/reminder-service";
import { deliverNotifications, DeliveryError } from "@/lib/notifications";
import { changeBookingTimes, decideTimeProposal } from "@/lib/arrival-service";
import { calendar } from "@/lib/booking-service";
import { addDays, todayStockholm } from "@/lib/dates";
import { stockholmNine } from "@/lib/reminder-policy";
import type { Actor } from "@/lib/access";
vi.mock("workflow/api", () => ({ start: vi.fn(), getRun: vi.fn() }));
import { GET, POST } from "@/app/api/reminders/route";
let admin: Actor, a: Actor, b: Actor;
const day = addDays(todayStockholm(), 30),
  now = stockholmNine(day),
  start = addDays(day, 2);
beforeEach(async () => {
  [admin, a, b] = (await seedTestDatabase()).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role as Actor["role"],
    dogName: p.dog,
  }));
  vi.stubEnv("GMAIL_USER", "sender@example.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://dogbooker.example.test");
});
afterAll(() => {
  vi.unstubAllEnvs();
  return pool.end();
});
async function fixture(end = start) {
  return (
    await pool.query(
      `INSERT INTO entries(kind,owner_id,start_date,end_date,booking_status) VALUES('booking',$1,$2,$3,'confirmed') RETURNING id`,
      [a.id, start, end],
    )
  ).rows[0].id as string;
}
async function queue() {
  for (const event of ["dropoff_reminder", "pickup_reminder"] as const)
    await enqueueDueReminders(event, day, { now });
}
const send = vi.fn(async () => "<test-message>");
it.each([0, 1, 5])(
  "schedules separate reminders across %i days",
  async (length) => {
    await fixture(addDays(start, length));
    await queue();
    expect(
      (
        await pool.query("SELECT event FROM notification_jobs ORDER BY event")
      ).rows.map((r) => r.event),
    ).toEqual(
      length === 0
        ? ["dropoff_reminder", "pickup_reminder"]
        : ["dropoff_reminder"],
    );
    if (length) {
      const pickupDay = addDays(day, length);
      await enqueueDueReminders("pickup_reminder", pickupDay, {
        now: stockholmNine(pickupDay),
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM notification_jobs WHERE event LIKE '%reminder'",
          )
        ).rows[0].n,
      ).toBe(2);
    }
  },
);
it("deduplicates concurrent schedulers, workers and replays independently", async () => {
  await fixture();
  await Promise.all(Array.from({ length: 5 }, () => queue()));
  send.mockClear();
  await Promise.all(
    Array.from({ length: 3 }, () => deliverNotifications({ send, now })),
  );
  await queue();
  await deliverNotifications({ send, now });
  expect(send).toHaveBeenCalledTimes(2);
  expect(
    (await pool.query("SELECT event,attempts,state FROM notification_jobs"))
      .rows,
  ).toEqual(
    expect.arrayContaining([
      { event: "dropoff_reminder", attempts: 1, state: "sent" },
      { event: "pickup_reminder", attempts: 1, state: "sent" },
    ]),
  );
});
it("suppresses only the proposed field, then supports rejected unchanged resubmission", async () => {
  const id = await fixture();
  const p = await changeBookingTimes(a, id, {
    arrivalTime: "08:00",
    expectedRevision: 0,
  });
  await queue();
  expect(
    (
      await pool.query(
        "SELECT event FROM notification_jobs WHERE event LIKE '%reminder'",
      )
    ).rows,
  ).toEqual([{ event: "pickup_reminder" }]);
  await decideTimeProposal(admin, id, {
    action: "decline",
    proposalId: p.proposalId!,
    expectedRevision: 1,
  });
  await queue();
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM notification_jobs WHERE event LIKE '%reminder'",
      )
    ).rows[0].n,
  ).toBe(2);
  await changeBookingTimes(admin, id, {
    arrivalTime: "08:00",
    expectedRevision: 2,
  });
  const q = await changeBookingTimes(a, id, {
    arrivalTime: "09:00",
    expectedRevision: 3,
  });
  await decideTimeProposal(admin, id, {
    action: "decline",
    proposalId: q.proposalId!,
    expectedRevision: 4,
  });
  const repeat = await changeBookingTimes(a, id, {
    arrivalTime: "08:00",
    expectedRevision: 5,
  });
  expect(
    (
      await pool.query(
        "SELECT requests_arrival FROM booking_time_proposals WHERE id=$1",
        [repeat.proposalId],
      )
    ).rows[0].requests_arrival,
  ).toBe(true);
  await decideTimeProposal(admin, id, {
    action: "approve",
    proposalId: repeat.proposalId!,
    expectedRevision: 6,
  });
  expect(
    (
      await pool.query(
        "SELECT arrival_time,arrival_resubmission_required,booking_status FROM entries WHERE id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({
    arrival_time: "08:00:00",
    arrival_resubmission_required: false,
    booking_status: "confirmed",
  });
});
it.each(["proposal", "cancel", "time", "date"])(
  "rechecks %s changes after queueing",
  async (change) => {
    const id = await fixture();
    await queue();
    if (change === "proposal")
      await changeBookingTimes(a, id, {
        arrivalTime: "08:00",
        pickupTime: "18:00",
        expectedRevision: 0,
      });
    if (change === "cancel")
      await pool.query(
        "UPDATE entries SET status='cancelled',booking_status='cancelled' WHERE id=$1",
        [id],
      );
    if (change === "time")
      await changeBookingTimes(admin, id, {
        arrivalTime: "08:00",
        pickupTime: "18:00",
        expectedRevision: 0,
      });
    if (change === "date")
      await pool.query(
        "UPDATE entries SET start_date=start_date+5,end_date=end_date+5 WHERE id=$1",
        [id],
      );
    send.mockClear();
    await deliverNotifications({
      send,
      now,
      reminderEvent: "dropoff_reminder",
    });
    await deliverNotifications({ send, now, reminderEvent: "pickup_reminder" });
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          "SELECT state FROM notification_jobs WHERE event LIKE '%reminder' ",
        )
      ).rows.every((r) => r.state === "skipped"),
    ).toBe(true);
  },
);
it("retries definite failures and never retries uncertain SMTP delivery", async () => {
  await fixture();
  await queue();
  const failing = vi.fn(async () => {
    throw new DeliveryError("smtp_retryable_451", false);
  });
  await deliverNotifications({
    send: failing,
    reminderEvent: "dropoff_reminder",
    limit: 1,
    now,
  });
  expect(
    (
      await pool.query(
        "SELECT state,attempts FROM notification_jobs WHERE event='dropoff_reminder'",
      )
    ).rows[0],
  ).toEqual({ state: "pending", attempts: 1 });
  await pool.query(
    "UPDATE notification_jobs SET available_at=now() WHERE event='dropoff_reminder'",
  );
  await deliverNotifications({ send, reminderEvent: "dropoff_reminder", now });
  await deliverNotifications({
    send: async () => {
      throw new DeliveryError("smtp_delivery_uncertain", true);
    },
    reminderEvent: "pickup_reminder",
    now,
  });
  await deliverNotifications({ send, reminderEvent: "pickup_reminder", now });
  expect(
    (
      await pool.query(
        "SELECT state,attempts FROM notification_jobs WHERE event='pickup_reminder'",
      )
    ).rows[0],
  ).toEqual({ state: "needs_review", attempts: 1 });
});
it("keeps resubmission flags private and protects scheduler endpoints", async () => {
  const id = await fixture();
  await pool.query(
    "UPDATE entries SET arrival_resubmission_required=true WHERE id=$1",
    [id],
  );
  const other = JSON.stringify(await calendar(b, start.slice(0, 7)));
  expect(other).not.toContain("Resubmission");
  const origin = process.env.BETTER_AUTH_URL!;
  expect((await GET(new Request(`${origin}/api/reminders`))).status).toBe(401);
  expect(
    (
      await POST(
        new Request(`${origin}/api/reminders`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ action: "health" }),
        }),
      )
    ).status,
  ).toBe(401);
});
