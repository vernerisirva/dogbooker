import { todayStockholm } from "./dates";
import { reservesDates } from "./booking-status";

export const arrivalOptions = Array.from(
  { length: 69 },
  (_, i) =>
    `${String(6 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);
export function canEditArrival(
  role: "admin" | "owner",
  status: string,
  startDate: string,
  today = todayStockholm(),
) {
  return reservesDates(status) && (role === "admin" || startDate >= today);
}
export function arrivalTimeLabel(time: string | null | undefined) {
  return time ? `kl. ${time}` : "Tid inte angiven";
}

export function bookingTimesError(
  startDate: string,
  endDate: string,
  arrival: string | null,
  pickup: string | null,
) {
  return startDate === endDate &&
    arrival !== null &&
    pickup !== null &&
    pickup <= arrival
    ? "Hämtningstiden måste vara senare än lämningstiden för en vistelse samma dag."
    : null;
}
