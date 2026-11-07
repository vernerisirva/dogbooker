import type { Actor } from "./access";
import { requireAdmin } from "./access";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "./booking-service";
import { canEditArrival, bookingTimesError } from "./arrival-time";
import {
  arrivalChangeSchema,
  bookingTimesChangeSchema,
  arrivalTimeSchema,
  type ArrivalChange,
  type BookingTimesChange,
} from "./arrival-validation";
import { AppError } from "./errors";
import { enqueueNotification } from "./notifications";
import { assertOwnerWindows } from "./time-window-service";
const stale = () =>
  new AppError(
    "Bokningen eller tidsförslaget har ändrats. Uppdatera och försök igen.",
    409,
  );
const deadline = () =>
  new AppError(
    "Dagen för lämning eller hämtning har passerat. Bara hundvakten kan ändra den tiden nu.",
    403,
  );
type LockedBooking = {
  ownerId: string;
  startDate: string;
  endDate: string;
  status: string;
  arrivalTime: string | null;
  pickupTime: string | null;
  arrivalRevision: number;
  arrivalResubmissionRequired: boolean;
  pickupResubmissionRequired: boolean;
};
async function lockBooking(
  c: PoolClient,
  actor: Actor,
  id: string,
): Promise<LockedBooking> {
  const {
    rows: [b],
  } = await c.query<LockedBooking>(
    `SELECT owner_id AS "ownerId",start_date::text AS "startDate",end_date::text AS "endDate",booking_status AS status,
 left(arrival_time::text,5) AS "arrivalTime",left(pickup_time::text,5) AS "pickupTime",arrival_revision AS "arrivalRevision",arrival_resubmission_required AS "arrivalResubmissionRequired",pickup_resubmission_required AS "pickupResubmissionRequired" FROM entries WHERE id=$1 AND kind='booking' FOR UPDATE`,
    [id],
  );
  if (!b || (actor.role !== "admin" && b.ownerId !== actor.id))
    throw new AppError("Bokningen kunde inte hittas.", 404);
  if (!["pending", "confirmed"].includes(b.status))
    throw new AppError(
      "Tiderna kan bara ändras för väntande eller godkända bokningar.",
      403,
    );
  return b;
}
function validatePair(
  b: LockedBooking,
  arrival: string | null,
  pickup: string | null,
) {
  const error = bookingTimesError(b.startDate, b.endDate, arrival, pickup);
  if (error) throw new AppError(error);
}
async function pending(c: PoolClient, id: string) {
  return (
    await c.query(
      `SELECT id,revision,proposer_role,left(proposed_arrival::text,5) AS arrival,left(proposed_pickup::text,5) AS pickup FROM booking_time_proposals WHERE booking_id=$1 AND status='pending'`,
      [id],
    )
  ).rows[0];
}
async function supersede(c: PoolClient, id: string) {
  await c.query(
    "UPDATE booking_time_proposals SET status='superseded',resolved_at=clock_timestamp() WHERE booking_id=$1 AND status='pending'",
    [id],
  );
}
async function insertProposal(
  c: PoolClient,
  id: string,
  b: LockedBooking,
  role: Actor["role"],
  arrival: string | null,
  pickup: string | null,
  requestsArrival = arrival !== b.arrivalTime,
  requestsPickup = pickup !== b.pickupTime,
) {
  const revision = b.arrivalRevision + 1;
  await supersede(c, id);
  const {
    rows: [proposal],
  } = await c.query(
    `INSERT INTO booking_time_proposals(booking_id,revision,proposer_role,current_arrival,current_pickup,proposed_arrival,proposed_pickup,requests_arrival,requests_pickup)
 VALUES($1,$2,$3,$4::time,$5::time,$6::time,$7::time,$8,$9) RETURNING id`,
    [
      id,
      revision,
      role,
      b.arrivalTime,
      b.pickupTime,
      arrival,
      pickup,
      requestsArrival,
      requestsPickup,
    ],
  );
  // Recheck the real clock at the write, including waits on window locks.
  const updated = await c.query(
    `UPDATE entries SET arrival_revision=$2 WHERE id=$1 AND ($3::boolean OR (
 (NOT $4::boolean OR start_date >= (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date) AND
 (NOT $5::boolean OR end_date >= (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date))) RETURNING id`,
    [id, revision, role === "admin", requestsArrival, requestsPickup],
  );
  if (!updated.rowCount) throw deadline();
  await enqueueNotification(
    c,
    id,
    role === "admin" ? "time_change_proposed" : "time_change_requested",
    {
      version: revision,
      previousArrivalTime: b.arrivalTime,
      previousPickupTime: b.pickupTime,
      proposedArrivalTime: arrival,
      proposedPickupTime: pickup,
    },
  );
  return {
    id,
    proposalId: proposal.id,
    arrivalRevision: revision,
    arrivalTime: b.arrivalTime,
    pickupTime: b.pickupTime,
  };
}
/** The legacy route follows the same approval workflow. */
export async function changeArrivalTime(
  actor: Actor,
  id: string,
  input: ArrivalChange,
) {
  return changeBookingTimes(actor, id, arrivalChangeSchema.parse(input));
}
export async function changeBookingTimes(
  actor: Actor,
  id: string,
  input: BookingTimesChange,
): Promise<{
  id: string;
  proposalId?: string;
  arrivalRevision: number;
  arrivalTime: string | null;
  pickupTime: string | null;
}> {
  const change = bookingTimesChangeSchema.parse(input);
  return transaction(async (c) => {
    const b = await lockBooking(c, actor, id);
    const arrival =
      change.arrivalTime === undefined ? b.arrivalTime : change.arrivalTime;
    const pickup =
      change.pickupTime === undefined ? b.pickupTime : change.pickupTime;
    const arrivalChanged =
        arrival !== b.arrivalTime ||
        (change.arrivalTime !== undefined && b.arrivalResubmissionRequired),
      pickupChanged =
        pickup !== b.pickupTime ||
        (change.pickupTime !== undefined && b.pickupResubmissionRequired);
    const proposal = await pending(c, id);
    if (
      actor.role === "owner" &&
      proposal?.proposer_role === "owner" &&
      proposal.arrival === arrival &&
      proposal.pickup === pickup &&
      [proposal.revision, proposal.revision - 1].includes(
        change.expectedRevision,
      )
    )
      return {
        id,
        proposalId: proposal.id,
        arrivalRevision: b.arrivalRevision,
        arrivalTime: b.arrivalTime,
        pickupTime: b.pickupTime,
      };
    if (!arrivalChanged && !pickupChanged && !proposal)
      return {
        id,
        arrivalTime: arrival,
        pickupTime: pickup,
        arrivalRevision: b.arrivalRevision,
      };
    const {
      rows: [clock],
    } = await c.query<{ today: string }>(
      "SELECT (clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date::text AS today",
    );
    if (
      (arrivalChanged &&
        !canEditArrival(actor.role, b.status, b.startDate, clock.today)) ||
      (pickupChanged &&
        !canEditArrival(actor.role, b.status, b.endDate, clock.today))
    )
      throw deadline();
    if (b.arrivalRevision !== change.expectedRevision) throw stale();
    validatePair(b, arrival, pickup);
    if (actor.role === "owner") {
      if (proposal)
        throw new AppError(
          "Ett tidsförslag väntar redan på svar. Behandla det innan du begär en ny ändring.",
          409,
        );
      await assertOwnerWindows(
        c,
        b.startDate,
        b.endDate,
        arrival,
        pickup,
        arrivalChanged,
        pickupChanged,
      );
      return insertProposal(
        c,
        id,
        b,
        "owner",
        arrival,
        pickup,
        arrivalChanged,
        pickupChanged,
      );
    }
    await supersede(c, id);
    const revision = b.arrivalRevision + 1;
    await c.query(
      "UPDATE entries SET arrival_time=$2::time,pickup_time=$3::time,arrival_revision=$4,arrival_resubmission_required=CASE WHEN $5 THEN false ELSE arrival_resubmission_required END,pickup_resubmission_required=CASE WHEN $6 THEN false ELSE pickup_resubmission_required END WHERE id=$1",
      [id, arrival, pickup, revision, arrivalChanged, pickupChanged],
    );
    await enqueueNotification(c, id, "time_change_direct", {
      version: revision,
      previousArrivalTime: b.arrivalTime,
      previousPickupTime: b.pickupTime,
      proposedArrivalTime: arrival,
      proposedPickupTime: pickup,
    });
    return {
      id,
      arrivalTime: arrival,
      pickupTime: pickup,
      arrivalRevision: revision,
    };
  });
}
export const proposalActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("propose"),
      arrivalTime: arrivalTimeSchema.optional(),
      pickupTime: arrivalTimeSchema.optional(),
      expectedRevision: z.number().int().nonnegative().max(2147483646),
    })
    .strict(),
  z
    .object({
      action: z.enum(["approve", "decline"]),
      proposalId: z.uuid(),
      expectedRevision: z.number().int().nonnegative().max(2147483646),
    })
    .strict(),
]);
export async function decideTimeProposal(
  actor: Actor,
  id: string,
  input: z.infer<typeof proposalActionSchema>,
) {
  const action = proposalActionSchema.parse(input);
  if (action.action === "propose") requireAdmin(actor);
  return transaction(async (c) => {
    const b = await lockBooking(c, actor, id);
    if (action.action === "propose") {
      if (action.arrivalTime === undefined && action.pickupTime === undefined)
        throw new AppError("Välj en tid att föreslå.");
      const arrival =
        action.arrivalTime === undefined ? b.arrivalTime : action.arrivalTime;
      const pickup =
        action.pickupTime === undefined ? b.pickupTime : action.pickupTime;
      const existing = await pending(c, id);
      if (
        existing?.proposer_role === "admin" &&
        existing.arrival === arrival &&
        existing.pickup === pickup &&
        [existing.revision, existing.revision - 1].includes(
          action.expectedRevision,
        )
      )
        return {
          id,
          proposalId: existing.id,
          arrivalRevision: b.arrivalRevision,
        };
      if (b.arrivalRevision !== action.expectedRevision) throw stale();
      validatePair(b, arrival, pickup);
      return insertProposal(
        c,
        id,
        b,
        "admin",
        arrival,
        pickup,
        arrival !== b.arrivalTime ||
          (action.arrivalTime !== undefined && b.arrivalResubmissionRequired),
        pickup !== b.pickupTime ||
          (action.pickupTime !== undefined && b.pickupResubmissionRequired),
      );
    }
    const {
      rows: [p],
    } = await c.query(
      `SELECT *,left(proposed_arrival::text,5) AS arrival,left(proposed_pickup::text,5) AS pickup FROM booking_time_proposals WHERE id=$1 AND booking_id=$2 FOR UPDATE`,
      [action.proposalId, id],
    );
    if (!p) throw new AppError("Tidsförslaget kunde inte hittas.", 404);
    if (p.proposer_role === actor.role)
      throw new AppError(
        "Den andra parten behöver svara på tidsförslaget.",
        403,
      );
    const target = action.action === "approve" ? "approved" : "declined";
    if (p.status === target && action.expectedRevision === p.revision)
      return { id, arrivalRevision: b.arrivalRevision };
    if (
      p.status !== "pending" ||
      b.arrivalRevision !== action.expectedRevision ||
      p.revision !== b.arrivalRevision
    )
      throw stale();
    validatePair(b, p.arrival, p.pickup);
    const revision = b.arrivalRevision + 1;
    await c.query(
      "UPDATE booking_time_proposals SET status=$2,resolved_at=clock_timestamp() WHERE id=$1",
      [p.id, target],
    );
    if (target === "approved")
      await c.query(
        "UPDATE entries SET arrival_time=$2::time,pickup_time=$3::time,arrival_revision=$4 WHERE id=$1",
        [id, p.arrival, p.pickup, revision],
      );
    else
      await c.query("UPDATE entries SET arrival_revision=$2 WHERE id=$1", [
        id,
        revision,
      ]);
    await enqueueNotification(
      c,
      id,
      actor.role === "admin"
        ? target === "approved"
          ? "time_change_approved"
          : "time_change_declined"
        : target === "approved"
          ? "time_change_accepted"
          : "time_change_rejected",
      {
        version: revision,
        previousArrivalTime: b.arrivalTime,
        previousPickupTime: b.pickupTime,
        proposedArrivalTime: p.arrival,
        proposedPickupTime: p.pickup,
      },
    );
    return { id, arrivalRevision: revision };
  });
}
