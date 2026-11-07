import {
  createBooking as create,
  type BookingInput,
} from "@/lib/booking-service";
import type { Actor } from "@/lib/access";
/** Existing scenarios get explicit valid times; validation tests call the real service directly. */
export function createBooking(actor: Actor, input: BookingInput) {
  return create(actor, { arrivalTime: "10:00", pickupTime: "18:00", ...input });
}
