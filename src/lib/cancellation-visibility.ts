export const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export function cancellationVisibleUntil(cancelledAt?: string | null) {
  const timestamp = cancelledAt ? Date.parse(cancelledAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp + CANCELLATION_WINDOW_MS : null;
}
export function showInUpcoming(
  booking: { status: string; cancelledAt?: string | null },
  now: number,
) {
  if (booking.status !== "cancelled") return true;
  const until = cancellationVisibleUntil(booking.cancelledAt);
  return until !== null && now >= until - CANCELLATION_WINDOW_MS && now < until;
}
