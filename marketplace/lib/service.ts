import { z } from "zod";
import { transaction } from "./db";
import {
  rankSitters,
  type Candidate,
  type Dog,
  type MatchingDog,
  type Sitter,
} from "./matching";
import {
  bookingSchema,
  decisionSchema,
  dogSchema,
  rangeSchema,
  searchSchema,
  sitterSchema,
} from "./validation";
import { todayStockholm } from "./dates";
export class MarketError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function saveDog(actor: string, input: unknown) {
  const p = dogSchema.parse(input);
  return transaction(
    actor,
    async (c) => (await c.query("SELECT save_dog($1) AS id", [p])).rows[0],
  );
}
export async function saveSitter(actor: string, input: unknown) {
  const p = sitterSchema.parse(input);
  return transaction(
    actor,
    async (c) => (await c.query("SELECT save_sitter($1) AS id", [p])).rows[0],
  );
}
export async function setAvailability(actor: string, input: unknown) {
  const p = rangeSchema.safeExtend({ available: z.boolean() }).parse(input);
  return transaction(actor, async (c) => {
    await c.query("SELECT set_availability($1,$2,$3)", [
      p.startDate,
      p.endDate,
      p.available,
    ]);
    return { ok: true };
  });
}
export async function search(actor: string, input: unknown) {
  const p = searchSchema.parse(input);
  return transaction(actor, async (c) => {
    await c.query("SELECT reconcile_actor_holds()");
    const dogs = (
      await c.query<MatchingDog>(
        "SELECT id,size,social,requirements,preferences FROM dogs WHERE id=ANY($1::uuid[])",
        [p.dogIds],
      )
    ).rows;
    if (dogs.length !== p.dogIds.length)
      throw new MarketError("Hunden kunde inte hittas.", 404);
    const overlap = await c.query(
      "SELECT 1 FROM booking_dogs WHERE dog_id=ANY($1::uuid[]) AND active AND daterange(start_date,end_date,'[]') && daterange($2::date,$3::date,'[]') LIMIT 1",
      [p.dogIds, p.startDate, p.endDate],
    );
    if (overlap.rowCount)
      throw new MarketError(
        "En av hundarna har redan en aktiv bokning under dessa datum. Avboka den eller välj andra datum.",
        409,
      );
    const candidates = (
      await c.query<Candidate>("SELECT * FROM public_sitters($1,$2,$3,$4)", [
        p.startDate,
        p.endDate,
        dogs.length,
        dogs.some((d) => !d.social),
      ])
    ).rows.filter((c) => c.profile.id !== undefined);
    const own = (
      await c.query<{ id: string }>("SELECT id FROM sitters")
    ).rows.map((s) => s.id);
    return rankSitters(
      candidates.filter((c) => !own.includes(c.profile.id)),
      dogs,
      p,
    );
  });
}
export async function requestBooking(actor: string, input: unknown) {
  const p = bookingSchema.parse(input);
  p.dogIds.sort();
  return transaction(
    actor,
    async (c) =>
      (await c.query<{ id: string }>("SELECT request_booking($1) AS id", [p]))
        .rows[0],
  );
}
export async function decideBooking(actor: string, input: unknown) {
  const p = decisionSchema.parse(input);
  const result = await transaction(actor, async (c) => {
    await c.query("SELECT decide_booking($1,$2,$3)", [
      p.id,
      p.decision,
      p.revision,
    ]);
    return (
      await c.query<{ status: Booking["status"] }>(
        "SELECT status FROM bookings WHERE id=$1",
        [p.id],
      )
    ).rows[0];
  });
  if (result.status === "expired")
    throw new MarketError(
      "Förfrågan har gått ut. Du kan skicka en ny förfrågan om hundvakten fortfarande är tillgänglig.",
      409,
    );
  return { ok: true };
}
export type Booking = {
  id: string;
  sitter_id: string;
  sitterName: string;
  start_date: string;
  end_date: string;
  status: "pending" | "confirmed" | "declined" | "cancelled" | "expired";
  expires_at: string | null;
  expired_at: string | null;
  approval_closed: boolean;
  daily_price: number;
  total_price: number;
  revision: number;
  canDecide: boolean;
  dogs: Dog[];
};
export async function dashboard(actor: string, id?: string) {
  if (id) z.uuid().parse(id);
  return transaction(actor, async (c) => {
    await c.query("SELECT reconcile_actor_holds()");
    const dogs = (
      await c.query<Dog>(
        "SELECT id,name,size,age_years,breed,social,requirements,preferences,care_notes FROM dogs ORDER BY name",
      )
    ).rows;
    const sitter =
      (
        await c.query<Sitter>(
          "SELECT id,name,area,latitude,longitude,radius_km,description,sizes,experience_years,daily_price,capacity,resident_dogs,services,preferences,published FROM sitters",
        )
      ).rows[0] ?? null;
    const availability = (
      await c.query<{ day: string }>(
        "SELECT day::text FROM availability WHERE day >= $1 ORDER BY day",
        [todayStockholm()],
      )
    ).rows.map((x) => x.day);
    const catalog = (
      await c.query<Candidate>("SELECT * FROM public_sitters($1,$1,1,false)", [
        todayStockholm(),
      ])
    ).rows;
    const rows = (
      await c.query<Omit<Booking, "dogs" | "sitterName">>(
        `SELECT id,sitter_id,start_date::text,end_date::text,status,expires_at::text,expired_at::text,(start_date::timestamp AT TIME ZONE 'Europe/Stockholm'<=clock_timestamp()) AS approval_closed,daily_price,total_price,revision,EXISTS(SELECT 1 FROM sitters s WHERE s.id=bookings.sitter_id) AS "canDecide" FROM bookings WHERE ($1::uuid IS NULL OR id=$1) ORDER BY start_date DESC,id LIMIT 200`,
        [id ?? null],
      )
    ).rows;
    if (id && !rows.length)
      throw new MarketError("Bokningen kunde inte hittas.", 404);
    const care = (
      await c.query<{ booking_id: string; snapshot: Dog }>(
        "SELECT booking_id,snapshot FROM booking_dogs WHERE booking_id=ANY($1::uuid[])",
        [rows.map((r) => r.id)],
      )
    ).rows;
    const bookings: Booking[] = rows.map((b) => ({
      ...b,
      sitterName:
        catalog.find((s) => s.profile.id === b.sitter_id)?.profile.name ??
        "Hundvakt",
      dogs: care.filter((d) => d.booking_id === b.id).map((d) => d.snapshot),
    }));
    return { dogs, sitter, availability, bookings };
  });
}
