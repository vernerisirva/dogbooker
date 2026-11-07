import { addDays, isDate, todayStockholm } from "./dates";
export const reminderEvents = ["dropoff_reminder", "pickup_reminder"] as const;
export type ReminderEvent = (typeof reminderEvents)[number];
export function isReminderEvent(event: string): event is ReminderEvent {
  return reminderEvents.some((e) => e === event);
}
/** 09:00 is unambiguous on both Stockholm DST transition dates. Subtract dates, not 48 hours. */
export function stockholmNine(date: string) {
  if (!isDate(date)) throw new Error("Invalid reminder date");
  const utc = new Date(`${date}T09:00:00.000Z`);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(utc),
  );
  return new Date(utc.getTime() - (hour - 9) * 3600000);
}
export function reminderDate(bookingDate: string) {
  return addDays(bookingDate, -2);
}
export function reminderDueAt(bookingDate: string) {
  return stockholmNine(reminderDate(bookingDate));
}
export function nextReminderWake(now = new Date()) {
  let day = todayStockholm(now);
  if (now >= stockholmNine(day)) day = addDays(day, 1);
  return { day, wakeAt: stockholmNine(day).toISOString() };
}
export type ReminderBooking = {
  status: string;
  startDate: string;
  endDate: string;
  arrivalTime: string | null;
  pickupTime: string | null;
  arrivalResubmissionRequired: boolean;
  pickupResubmissionRequired: boolean;
  awaitingArrivalApproval: boolean;
  awaitingPickupApproval: boolean;
  activeOwner: boolean;
};
export function reminderEligible(
  b: ReminderBooking,
  event: ReminderEvent,
  day: string,
  now: Date,
) {
  const arrival = event === "dropoff_reminder";
  return (
    b.activeOwner &&
    ["pending", "confirmed"].includes(b.status) &&
    reminderDate(arrival ? b.startDate : b.endDate) === day &&
    todayStockholm(now) === day &&
    now >= stockholmNine(day) &&
    ((arrival ? b.arrivalTime : b.pickupTime) === null ||
      (arrival
        ? b.arrivalResubmissionRequired
        : b.pickupResubmissionRequired)) &&
    !(arrival ? b.awaitingArrivalApproval : b.awaitingPickupApproval)
  );
}
