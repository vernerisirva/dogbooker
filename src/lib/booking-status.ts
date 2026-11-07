export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled";
export const bookingStatusLabel: Record<BookingStatus, string> = {
  pending: "Väntar på godkännande",
  confirmed: "Godkänd",
  declined: "Nekad",
  cancelled: "Avbokad",
};
export function reservesDates(status: string) {
  return status === "pending" || status === "confirmed";
}
