import { createBooking } from "../helpers/bookings";
import { beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { seedTestDatabase } from "../../scripts/test-database";
import { pool } from "@/db";
import {
  decideBooking,
  cancelBooking,
  createBlock,
  calendar,
} from "@/lib/booking-service";
import * as notificationModule from "@/lib/notifications";
import { deliverNotifications, DeliveryError } from "@/lib/notifications";
import { addDays, todayStockholm } from "@/lib/dates";
import type { Actor } from "@/lib/access";
let admin: Actor, a: Actor, b: Actor;
const range = {
  startDate: addDays(todayStockholm(), 100),
  endDate: addDays(todayStockholm(), 102),
};
beforeEach(async () => {
  const people = await seedTestDatabase();
  [admin, a, b] = people.map((p) => ({
    id: p.id,
    email: p.email,
    name: p.name,
    role: p.role as Actor["role"],
    dogName: p.dog,
  }));
  vi.stubEnv("GMAIL_USER", "test@example.test");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
  vi.stubEnv("BETTER_AUTH_URL", "https://dogbooker.example.test");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
});
async function jobs() {
  return (
    await pool.query("SELECT * FROM notification_jobs ORDER BY created_at,id")
  ).rows;
}
describe("atomic approvals and durable notifications", () => {
  it("reserves a pending request and exposes its Swedish status without private notes", async () => {
    const x = await createBooking(a, { ...range, note: "DO NOT EMAIL" });
    expect(
      (await calendar(a, range.startDate.slice(0, 7))).bookings[0].status,
    ).toBe("pending");
    await expect(createBooking(a, range)).rejects.toMatchObject({
      status: 409,
    });
    await expect(createBlock(admin, range)).rejects.toMatchObject({
      status: 409,
    });
    const [job] = await jobs();
    expect(job.booking_id).toBe(x.id);
    expect(job.event).toBe("requested");
    expect(job.recipient_email).toBe(admin.email);
    expect(JSON.stringify(job.payload)).not.toContain("DO NOT EMAIL");
  });
  it("rolls back the booking if its notification cannot be persisted", async () => {
    const spy = vi
      .spyOn(notificationModule, "enqueueNotification")
      .mockRejectedValueOnce(new Error("storage failure"));
    try {
      await expect(createBooking(a, range)).rejects.toBeDefined();
      expect(
        (await pool.query("SELECT id FROM entries WHERE kind='booking'")).rows,
      ).toHaveLength(0);
      expect(await jobs()).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
  it("authorizes decisions and serializes repeated approval", async () => {
    const x = await createBooking(a, range);
    await expect(decideBooking(a, x.id, "confirmed")).rejects.toMatchObject({
      status: 403,
    });
    await Promise.all([
      decideBooking(admin, x.id, "confirmed"),
      decideBooking(admin, x.id, "confirmed"),
    ]);
    expect((await jobs()).filter((j) => j.event === "approved")).toHaveLength(
      1,
    );
    await expect(createBooking(a, range)).rejects.toMatchObject({
      status: 409,
    });
    await expect(decideBooking(admin, x.id, "declined")).rejects.toMatchObject({
      status: 409,
    });
  });
  it("admits one of simultaneous approve/decline decisions", async () => {
    const x = await createBooking(a, range);
    const r = await Promise.allSettled([
      decideBooking(admin, x.id, "confirmed"),
      decideBooking(admin, x.id, "declined"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await jobs()).filter((j) => ["approved", "declined"].includes(j.event)),
    ).toHaveLength(1);
  });
  it("decline is idempotent, releases dates and cannot be approved later", async () => {
    const x = await createBooking(a, range);
    await Promise.all([
      decideBooking(admin, x.id, "declined"),
      decideBooking(admin, x.id, "declined"),
    ]);
    await createBooking(a, range);
    await expect(decideBooking(admin, x.id, "confirmed")).rejects.toMatchObject(
      { status: 409 },
    );
    expect((await jobs()).filter((j) => j.event === "declined")).toHaveLength(
      1,
    );
  });
  it("cancellation is idempotent, authorized and routes notifications to the correct person", async () => {
    const x = await createBooking(a, range);
    await expect(cancelBooking(b, x.id)).rejects.toMatchObject({ status: 404 });
    await Promise.all([cancelBooking(a, x.id), cancelBooking(a, x.id)]);
    const [cancel] = (await jobs()).filter(
      (j) => j.event === "owner_cancelled",
    );
    expect(cancel.recipient_id).toBe(admin.id);
    const y = await createBooking(b, range);
    await decideBooking(admin, y.id, "confirmed");
    await Promise.all([cancelBooking(admin, y.id), cancelBooking(admin, y.id)]);
    expect(
      (await jobs())
        .filter((j) => j.event === "admin_cancelled")
        .map((j) => j.recipient_id),
    ).toEqual([b.id]);
  });
  it("handles approval/cancellation races without reviving cancelled reservations", async () => {
    const x = await createBooking(a, range);
    await Promise.allSettled([
      decideBooking(admin, x.id, "confirmed"),
      cancelBooking(a, x.id),
    ]);
    expect(
      (
        await pool.query(
          "SELECT booking_status,status FROM entries WHERE id=$1",
          [x.id],
        )
      ).rows[0],
    ).toEqual({ booking_status: "cancelled", status: "cancelled" });
    await createBooking(a, range);
  });
  it("keeps legacy active bookings confirmed with database overlap protection", async () => {
    const x = await pool.query(
      "INSERT INTO entries(kind,owner_id,start_date,end_date) VALUES('booking',$1,$2,$3) RETURNING booking_status",
      [a.id, range.startDate, range.endDate],
    );
    expect(x.rows[0].booking_status).toBe("confirmed");
    await expect(createBooking(a, range)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("commits reservation when email fails and retries identical payload/key", async () => {
    await createBooking(a, range);
    const calls: { mail: unknown; key: string }[] = [];
    const fail = vi.fn(async (mail, key) => {
      calls.push({ mail, key });
      throw new DeliveryError("smtp_retryable_451", false);
    });
    await deliverNotifications({ send: fail });
    expect((await jobs())[0]).toMatchObject({
      state: "pending",
      attempts: 1,
      last_error: "smtp_retryable_451",
    });
    expect(
      (await calendar(a, range.startDate.slice(0, 7))).bookings[0].status,
    ).toBe("pending");
    await pool.query("UPDATE notification_jobs SET available_at=now()");
    vi.stubEnv("BETTER_AUTH_URL", "https://changed.example.test");
    await deliverNotifications({
      send: async (mail, key) => {
        expect({ mail, key }).toEqual(calls[0]);
        return "email-accepted";
      },
    });
    expect((await jobs())[0]).toMatchObject({
      state: "sent",
      provider_id: "email-accepted",
      attempts: 2,
    });
  });
  it("concurrent workers send a notification only once", async () => {
    await createBooking(a, range);
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "email-accepted";
    });
    await Promise.all([
      deliverNotifications({ send }),
      deliverNotifications({ send }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not resend an interrupted SMTP attempt, even with the same Message-ID", async () => {
    await createBooking(a, range);
    const [job] = await jobs();
    await pool.query(
      "UPDATE notification_jobs SET state='sending',locked_until=now()-interval '1 minute',first_attempt_at=now()-interval '1 hour',attempts=1 WHERE id=$1",
      [job.id],
    );
    const send = vi.fn(async (_mail, key) => {
      expect(key).toBe(`dogbooker/${job.id}`);
      return "existing-email-id";
    });
    await deliverNotifications({ send });
    expect(send).not.toHaveBeenCalled();
    expect((await jobs())[0].state).toBe("needs_review");
  });
  it("does not resend legacy provider attempts after a transport change", async () => {
    await createBooking(a, range);
    await pool.query(
      "UPDATE notification_jobs SET first_attempt_at=now()-interval '25 hours',attempts=1",
    );
    const send = vi.fn(async () => "must-not-send");
    await deliverNotifications({ send });
    expect(send).not.toHaveBeenCalled();
    expect((await jobs())[0].state).toBe("needs_review");
  });
  it("leaves unconfigured jobs pending and isolates permanent failures", async () => {
    await createBooking(a, range);
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    expect(await deliverNotifications()).toEqual({
      configured: false,
      sent: 0,
    });
    expect((await jobs())[0].attempts).toBe(0);
    await deliverNotifications({
      send: async () => {
        throw new DeliveryError("smtp_rejected_535", true);
      },
    });
    expect((await jobs())[0].state).toBe("needs_review");
  });
  it("holds ambiguous SMTP failures without losing the booking or sending again", async () => {
    const booking = await createBooking(a, range);
    const send = vi.fn(async () => {
      throw new Error("socket closed after DATA: private credentials");
    });
    await deliverNotifications({ send });
    await deliverNotifications({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0]).toMatchObject({
      state: "needs_review",
      last_error: "smtp_delivery_uncertain",
    });
    expect(
      (
        await pool.query("SELECT booking_status FROM entries WHERE id=$1", [
          booking.id,
        ])
      ).rows[0].booking_status,
    ).toBe("pending");
  });
  it("retries explicit temporary failures after 24h, then caps attempts", async () => {
    await createBooking(a, range);
    await deliverNotifications({
      send: async () => {
        throw new DeliveryError("smtp_retryable_450", false);
      },
    });
    await pool.query(
      "UPDATE notification_jobs SET available_at=now(), first_attempt_at=now()-interval '2 days'",
    );
    const send = vi.fn(async () => "accepted");
    await deliverNotifications({ send });
    expect(send).toHaveBeenCalledTimes(1);
    await pool.query(
      "UPDATE notification_jobs SET state='pending',attempts=8,last_error='smtp_retryable_450',available_at=now()",
    );
    await deliverNotifications({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0].last_error).toBe("smtp_retry_exhausted");
  });
  it("recovers a lease when no SMTP attempt ever started", async () => {
    await createBooking(a, range);
    await pool.query(
      "UPDATE notification_jobs SET state='sending',locked_until=now()-interval '1 minute'",
    );
    const send = vi.fn(async () => "accepted");
    await deliverNotifications({ send });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not send again when SMTP accepted but the completion write failed", async () => {
    await createBooking(a, range);
    const send = vi.fn(async () => {
      // Replace only the completion query; all actual SQL before/after still hits PostgreSQL.
      const query = pool.query.bind(pool);
      vi.spyOn(pool, "query").mockImplementationOnce(
        (...args: Parameters<typeof pool.query>) => {
          if (String(args[0]).includes("state='sent'"))
            throw new Error("Database write unavailable");
          return query(...args);
        },
      );
      return "accepted";
    });
    try {
      await deliverNotifications({ send });
      await deliverNotifications({ send });
      expect(send).toHaveBeenCalledTimes(1);
      expect((await jobs())[0].state).toBe("needs_review");
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("does not send stored messages to a changed email address", async () => {
    await createBooking(a, range);
    await pool.query(
      "UPDATE users SET email='changed@example.test' WHERE id=$1",
      [admin.id],
    );
    const send = vi.fn(async () => "must-not-send");
    await deliverNotifications({ send });
    expect(send).not.toHaveBeenCalled();
    expect((await jobs())[0].last_error).toBe("recipient_changed");
  });
});
