import { ownerLimit } from "./installation";
import { pool } from "@/db";
import type { PoolClient } from "pg";
import { type Actor, requireAdmin } from "./access";
import { AppError, databaseError } from "./errors";
import { addDays, monthBounds, todayStockholm, validateRange } from "./dates";
import { z } from "zod";
import { enqueueNotification } from "./notifications";
import type { BookingStatus } from "./booking-status";
import { canEditArrival, bookingTimesError } from "./arrival-time";
import { getTimeWindows, assertOwnerWindows } from "./time-window-service";
import type { TimeProposal } from "./time-windows";
import { arrivalTimeSchema } from "./arrival-validation";
export const rangeSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});
export const bookingSchema = rangeSchema.extend({
  ownerId: z.uuid().optional(),
  note: z.string().max(1000).optional(),
  arrivalTime: arrivalTimeSchema.optional(),
  pickupTime: arrivalTimeSchema.optional(),
});
export const bookingEditSchema = bookingSchema
  .omit({ arrivalTime: true, pickupTime: true })
  .strict();
export type BookingInput = z.infer<typeof bookingSchema>;
export type Entry = {
  id: string;
  kind: "booking" | "block";
  ownerId: string | null;
  startDate: string;
  endDate: string;
  note: string | null;
  status: BookingStatus | "active";
  ownerName?: string;
  dogName?: string;
  arrivalTime?: string | null;
  pickupTime?: string | null;
  arrivalRevision?: number;
  cancelledAt?: Date | null;
  timeProposal?: TimeProposal | null;
  arrivalResubmissionRequired?: boolean;
  pickupResubmissionRequired?: boolean;
};
export type CalendarEntry = {
  startDate: string;
  endDate: string;
  state: "unavailable" | "mine" | "booking" | "block" | "companion";
  status?: "pending" | "confirmed";
  ownerId?: string;
  id?: string;
  dogName?: string;
  ownerName?: string;
  note?: string | null;
};
const columns = `e.id,e.kind,e.owner_id AS "ownerId",e.start_date::text AS "startDate",e.end_date::text AS "endDate",e.note,CASE WHEN e.kind='booking' THEN e.booking_status ELSE e.status END AS status,u.name AS "ownerName",u.dog_name AS "dogName",left(e.arrival_time::text,5) AS "arrivalTime",e.arrival_revision AS "arrivalRevision",left(e.pickup_time::text,5) AS "pickupTime",e.cancelled_at AS "cancelledAt",e.arrival_resubmission_required AS "arrivalResubmissionRequired",e.pickup_resubmission_required AS "pickupResubmissionRequired",(SELECT json_build_object('id',p.id,'revision',p.revision,'proposerRole',p.proposer_role,'arrivalTime',left(p.proposed_arrival::text,5),'pickupTime',left(p.proposed_pickup::text,5)) FROM booking_time_proposals p WHERE p.booking_id=e.id AND p.status='pending') AS "timeProposal"`;
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    databaseError(error);
  } finally {
    c.release();
  }
}
function assertRange(input: { startDate: string; endDate: string }) {
  const error = validateRange(input.startDate, input.endDate);
  if (error) throw new AppError(error);
}
export function visibleCalendarEntry(
  entry: Entry,
  actor: Actor,
): CalendarEntry | null {
  if (
    entry.status !== "active" &&
    entry.status !== "pending" &&
    entry.status !== "confirmed"
  )
    return null;
  if (actor.role === "admin")
    return {
      id: entry.id,
      startDate: entry.startDate,
      endDate: entry.endDate,
      state: entry.kind,
      ownerId: entry.ownerId ?? undefined,
      status:
        entry.kind === "booking"
          ? (entry.status as "pending" | "confirmed")
          : undefined,
      dogName: entry.dogName,
      ownerName: entry.ownerName,
      note: entry.note,
    };
  if (entry.ownerId === actor.id && entry.kind === "booking")
    return {
      id: entry.id,
      startDate: entry.startDate,
      endDate: entry.endDate,
      state: "mine",
      dogName: entry.dogName,
      status: entry.status as "pending" | "confirmed",
    };
  if (entry.kind === "booking")
    return entry.status === "confirmed"
      ? {
          startDate: entry.startDate,
          endDate: entry.endDate,
          state: "companion",
          dogName: entry.dogName,
        }
      : null;
  return {
    startDate: entry.startDate,
    endDate: entry.endDate,
    state: "unavailable",
  };
}
type BookingEntry = Omit<Entry, "status"> & { status: BookingStatus };
function bookingDetails(e: BookingEntry, actor: Actor) {
  const details = {
    id: e.id,
    startDate: e.startDate,
    endDate: e.endDate,
    status: e.status,
    dogName: e.dogName,
    arrivalTime: e.arrivalTime ?? null,
    pickupTime: e.pickupTime ?? null,
    arrivalRevision: e.arrivalRevision ?? 0,
    timeProposal: e.timeProposal ?? null,
    arrivalResubmissionRequired: e.arrivalResubmissionRequired ?? false,
    pickupResubmissionRequired: e.pickupResubmissionRequired ?? false,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
    canEditArrival: canEditArrival(actor.role, e.status, e.startDate),
    canEditPickup: canEditArrival(actor.role, e.status, e.endDate),
  };
  return actor.role === "admin" ? { ...e, ...details } : details;
}
/** Permanent history; owner identity is always taken from the authenticated actor. */
export async function bookingHistory(actor: Actor, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
    throw new AppError("Välj en giltig sida i bokningshistoriken.");
  const result = await pool.query<BookingEntry>(
    `SELECT ${columns} FROM entries e LEFT JOIN users u ON u.id=e.owner_id
     WHERE e.kind='booking' AND ($1::boolean OR e.owner_id=$2::uuid)
     AND (e.booking_status IN ('cancelled','declined') OR
       (e.booking_status='confirmed' AND e.end_date < (statement_timestamp() AT TIME ZONE 'Europe/Stockholm')::date))
     ORDER BY e.start_date DESC,e.created_at DESC,e.id DESC LIMIT 51 OFFSET $3`,
    [actor.role === "admin", actor.id, offset],
  );
  return {
    bookings: result.rows.slice(0, 50).map((e) => bookingDetails(e, actor)),
    nextOffset: result.rows.length > 50 ? offset + 50 : null,
  };
}
export async function calendar(actor: Actor, month: string) {
  let bounds;
  try {
    bounds = monthBounds(month);
  } catch {
    throw new AppError("Välj en giltig månad.");
  }
  const serverNow = (
    await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")
  ).rows[0].now;
  const results = await Promise.all([
    pool.query<Entry>(
      // Include future reservations so date inputs spanning other months have
      // the same shared-stay information as the visible calendar. Filter in SQL
      // and in the DTO: another owner's pending request is never public.
      `SELECT ${columns} FROM entries e LEFT JOIN users u ON u.id=e.owner_id WHERE e.status='active' AND ((e.start_date <= $2::date AND e.end_date >= $1::date) OR e.end_date >= $3::date) AND ($4::boolean OR e.kind='block' OR e.owner_id=$5::uuid OR e.booking_status='confirmed') ORDER BY e.start_date,e.created_at`,
      [
        bounds.start,
        bounds.end,
        todayStockholm(),
        actor.role === "admin",
        actor.id,
      ],
    ),
    pool.query<BookingEntry>(
      `SELECT ${columns} FROM entries e LEFT JOIN users u ON u.id=e.owner_id WHERE ($1::boolean OR e.owner_id=$2::uuid) AND e.kind='booking' AND ((e.booking_status='cancelled' AND e.cancelled_at > $6::timestamptz - interval '24 hours' AND e.cancelled_at <= $6::timestamptz) OR (e.booking_status<>'cancelled' AND (e.end_date >= $3::date OR e.booking_status='pending' OR EXISTS(SELECT 1 FROM booking_time_proposals p WHERE p.booking_id=e.id AND p.status='pending') OR ($1::boolean AND e.start_date <= $5::date AND e.end_date >= $4::date)))) ORDER BY e.start_date,e.created_at`,
      [
        actor.role === "admin",
        actor.id,
        todayStockholm(),
        bounds.start,
        bounds.end,
        serverNow,
      ],
    ),
    actor.role === "admin"
      ? pool.query(
          `SELECT id,name,email,dog_name AS "dogName",is_active AS "isActive",EXISTS(SELECT 1 FROM auth_accounts a WHERE a.user_id=users.id AND a.provider_id='credential') AS "hasPassword" FROM users WHERE role='owner' ORDER BY created_at`,
        )
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    actor,
    serverNow: serverNow.toISOString(),
    today: todayStockholm(),
    month,
    entries: results[0].rows.flatMap((e) => {
      const visible = visibleCalendarEntry(e, actor);
      return visible ? [visible] : [];
    }),
    bookings: results[1].rows.map((e) => bookingDetails(e, actor)),
    owners: results[2].rows,
    ownerLimit: actor.role === "admin" ? ownerLimit() : 0,
    timeWindows: await getTimeWindows(),
  };
}
export async function createBooking(actor: Actor, input: BookingInput) {
  assertRange(input);
  const arrivalTime = arrivalTimeSchema.parse(input.arrivalTime ?? null);
  const pickupTime = arrivalTimeSchema.parse(input.pickupTime ?? null);
  if (!arrivalTime || !pickupTime)
    throw new AppError("Välj både lämningstid och hämtningstid.");
  const timeError = bookingTimesError(
    input.startDate,
    input.endDate,
    arrivalTime,
    pickupTime,
  );
  if (timeError) throw new AppError(timeError);
  const ownerId = actor.role === "admin" ? input.ownerId : actor.id;
  if (!ownerId) throw new AppError("Välj en hund för bokningen.");
  return transaction(async (c) => {
    if (actor.role === "owner")
      await assertOwnerWindows(
        c,
        input.startDate,
        input.endDate,
        arrivalTime,
        pickupTime,
      );
    const owner = await c.query(
      "SELECT id FROM users WHERE id=$1 AND role='owner' AND is_active=true FOR SHARE",
      [ownerId],
    );
    if (!owner.rowCount)
      throw new AppError("Hundägarens konto är inte tillgängligt.", 400);
    const result = await c.query(
      `INSERT INTO entries(kind,owner_id,start_date,end_date,note,booking_status,arrival_time,pickup_time) VALUES('booking',$1,$2,$3,$4,$5,$6::time,$7::time) RETURNING id`,
      [
        ownerId,
        input.startDate,
        input.endDate,
        actor.role === "admin" ? (input.note ?? null) : null,
        actor.role === "admin" ? "confirmed" : "pending",
        arrivalTime,
        pickupTime,
      ],
    );
    await enqueueNotification(
      c,
      result.rows[0].id,
      actor.role === "admin" ? "approved" : "requested",
    );
    return { id: result.rows[0].id };
  });
}
export async function modifyBooking(
  actor: Actor,
  id: string,
  input: BookingInput,
) {
  requireAdmin(actor);
  assertRange(input);
  return transaction(async (c) => {
    const old = await c.query(
      "SELECT id FROM entries WHERE id=$1 AND kind='booking' AND status='active' FOR UPDATE",
      [id],
    );
    if (!old.rowCount) throw new AppError("Bokningen kunde inte hittas.", 404);
    if (input.ownerId) {
      const owner = await c.query(
        "SELECT id FROM users WHERE id=$1 AND role='owner' AND is_active=true FOR SHARE",
        [input.ownerId],
      );
      if (!owner.rowCount) throw new AppError("Välj en aktiv hundägare.");
    }
    await c.query(
      `UPDATE entries SET start_date=$2,end_date=$3,owner_id=COALESCE($4,owner_id),note=$5 WHERE id=$1`,
      [
        id,
        input.startDate,
        input.endDate,
        input.ownerId ?? null,
        input.note ?? null,
      ],
    );
    return { id };
  });
}
export async function decideBooking(
  actor: Actor,
  id: string,
  decision: "confirmed" | "declined",
  expectedRevision?: number,
) {
  requireAdmin(actor);
  if (!["confirmed", "declined"].includes(decision))
    throw new AppError("Välj ett giltigt beslut.");
  return transaction(async (c) => {
    const {
      rows: [entry],
    } = await c.query(
      "SELECT booking_status,arrival_revision FROM entries WHERE id=$1 AND kind='booking' FOR UPDATE",
      [id],
    );
    if (!entry) throw new AppError("Bokningen kunde inte hittas.", 404);
    if (entry.booking_status === decision) return { id, status: decision };
    if (entry.booking_status !== "pending")
      throw new AppError(
        "Bokningen har redan behandlats. Uppdatera kalendern.",
        409,
      );
    if (
      expectedRevision !== undefined &&
      entry.arrival_revision !== expectedRevision
    )
      throw new AppError(
        "Tiderna har ändrats. Uppdatera innan du godkänner bokningen.",
        409,
      );
    if (
      decision === "confirmed" &&
      (
        await c.query(
          "SELECT id FROM booking_time_proposals WHERE booking_id=$1 AND status='pending'",
          [id],
        )
      ).rowCount
    )
      throw new AppError(
        "Behandla tidsförslaget innan du godkänner bokningen.",
        409,
      );
    await c.query("UPDATE entries SET booking_status=$2 WHERE id=$1", [
      id,
      decision,
    ]);
    await enqueueNotification(
      c,
      id,
      decision === "confirmed" ? "approved" : "declined",
    );
    return { id, status: decision };
  });
}
export async function cancelBooking(actor: Actor, id: string) {
  return transaction(async (c) => {
    const {
      rows: [entry],
    } = await c.query(
      "SELECT owner_id,start_date::text AS start_date,booking_status FROM entries WHERE id=$1 AND kind='booking' FOR UPDATE",
      [id],
    );
    if (!entry || (actor.role !== "admin" && entry.owner_id !== actor.id))
      throw new AppError("Bokningen kunde inte hittas.", 404);
    if (entry.booking_status === "cancelled") return { id };
    if (entry.booking_status === "declined")
      throw new AppError("En nekad bokning kan inte avbokas.", 409);
    if (actor.role !== "admin" && entry.start_date <= todayStockholm())
      throw new AppError(
        "Du kan bara avboka vistelser som börjar efter dagens datum. Kontakta din hundvakt om du behöver ändra en påbörjad vistelse.",
      );
    await c.query("UPDATE entries SET booking_status='cancelled' WHERE id=$1", [
      id,
    ]);
    if (actor.role !== "admin")
      await enqueueNotification(c, id, "owner_cancelled");
    else if (entry.booking_status === "confirmed")
      await enqueueNotification(c, id, "admin_cancelled");
    return { id };
  });
}
export async function createBlock(actor: Actor, input: BookingInput) {
  requireAdmin(actor);
  assertRange(input);
  return transaction(async (c) => {
    const result = await c.query(
      "INSERT INTO entries(kind,start_date,end_date,note) VALUES('block',$1,$2,$3) RETURNING id",
      [input.startDate, input.endDate, input.note ?? null],
    );
    return { id: result.rows[0].id };
  });
}
export async function unblockDates(
  actor: Actor,
  input: { startDate: string; endDate: string },
) {
  requireAdmin(actor);
  assertRange(input);
  return transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT id,start_date::text AS start_date,end_date::text AS end_date,note FROM entries WHERE kind='block' AND status='active' AND start_date <= $2 AND end_date >= $1 ORDER BY start_date FOR UPDATE",
      [input.startDate, input.endDate],
    );
    for (const row of rows) {
      await c.query("UPDATE entries SET status='cancelled' WHERE id=$1", [
        row.id,
      ]);
      if (row.start_date < input.startDate)
        await c.query(
          "INSERT INTO entries(kind,start_date,end_date,note) VALUES('block',$1,$2,$3)",
          [row.start_date, addDays(input.startDate, -1), row.note],
        );
      if (row.end_date > input.endDate)
        await c.query(
          "INSERT INTO entries(kind,start_date,end_date,note) VALUES('block',$1,$2,$3)",
          [addDays(input.endDate, 1), row.end_date, row.note],
        );
    }
    return { unblocked: rows.length };
  });
}
