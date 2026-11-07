import { pool } from "@/db";
import type { PoolClient } from "pg";
import { transaction } from "./booking-service";
import { enqueueNotification } from "./notifications";
import { isDate } from "./dates";
import {
  reminderEligible,
  isReminderEvent,
  reminderEvents,
  type ReminderEvent,
  type ReminderBooking,
} from "./reminder-policy";
export const reminderColumns = `e.booking_status AS status,e.start_date::text AS "startDate",e.end_date::text AS "endDate",
 left(e.arrival_time::text,5) AS "arrivalTime",left(e.pickup_time::text,5) AS "pickupTime",
 e.arrival_resubmission_required AS "arrivalResubmissionRequired",e.pickup_resubmission_required AS "pickupResubmissionRequired",
 u.is_active AS "activeOwner",
 EXISTS(SELECT 1 FROM booking_time_proposals p WHERE p.booking_id=e.id AND p.status='pending' AND p.proposer_role='owner' AND p.requests_arrival) AS "awaitingArrivalApproval",
 EXISTS(SELECT 1 FROM booking_time_proposals p WHERE p.booking_id=e.id AND p.status='pending' AND p.proposer_role='owner' AND p.requests_pickup) AS "awaitingPickupApproval"`;
/** Internal clock/scope overrides are for isolated tests, never accepted from HTTP clients. */
export async function enqueueDueReminders(
  event: ReminderEvent,
  day: string,
  options: { now?: Date; bookingIds?: string[] } = {},
) {
  if (!reminderEvents.includes(event) || !isDate(day))
    throw new Error("Invalid reminder schedule");
  return transaction(async (c) => {
    const rows = await c.query<ReminderBooking & { id: string }>(
      `SELECT e.id,${reminderColumns} FROM entries e JOIN users u ON u.id=e.owner_id
   WHERE e.kind='booking' AND e.booking_status IN ('pending','confirmed') AND
   (CASE WHEN $1='dropoff_reminder' THEN e.start_date ELSE e.end_date END)=$2::date+2
   AND ($3::uuid[] IS NULL OR e.id=ANY($3::uuid[])) ORDER BY e.id FOR UPDATE OF e`,
      [event, day, options.bookingIds ?? null],
    );
    const now =
      options.now ??
      (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]
        .now;
    let queued = 0;
    for (const b of rows.rows) {
      if (!reminderEligible(b, event, day, now)) continue;
      queued +=
        (await enqueueNotification(c, b.id, event, undefined, day)) ?? 0;
    }
    return { event, day, queued };
  });
}
/** Lock the booking through the durable attempt marker. The caller commits BEFORE SMTP. */
export async function lockReminderForDelivery(
  bookingId: string,
  event: string,
  day: unknown,
  now?: Date,
): Promise<{ client: PoolClient; eligible: boolean }> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [b],
    } = await c.query<ReminderBooking>(
      `SELECT ${reminderColumns} FROM entries e JOIN users u ON u.id=e.owner_id WHERE e.id=$1 FOR UPDATE OF e`,
      [bookingId],
    );
    const at =
      now ??
      (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]
        .now;
    return {
      client: c,
      eligible:
        !!b &&
        isReminderEvent(event) &&
        typeof day === "string" &&
        isDate(day) &&
        reminderEligible(b, event, day, at),
    };
  } catch (e) {
    await c.query("ROLLBACK");
    c.release();
    throw e;
  }
}
