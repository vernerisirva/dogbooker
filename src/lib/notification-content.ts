import { formatDate, formatRange } from "./dates";
import { arrivalTimeLabel } from "./arrival-time";
import { bookingStatusLabel, type BookingStatus } from "./booking-status";
export type NotificationEvent =
  | "requested"
  | "approved"
  | "declined"
  | "owner_cancelled"
  | "admin_cancelled"
  | "arrival_changed"
  | "times_changed"
  | "time_change_requested"
  | "time_change_approved"
  | "time_change_declined"
  | "time_change_proposed"
  | "time_change_accepted"
  | "time_change_rejected"
  | "time_change_direct"
  | "dropoff_reminder"
  | "pickup_reminder";
export type NotificationPayload = {
  reminderDate?: string | null;
  dogName: string;
  startDate: string;
  endDate: string;
  status: BookingStatus;
  arrivalTime?: string | null;
  previousArrivalTime?: string | null;
  pickupTime?: string | null;
  previousPickupTime?: string | null;
  proposedArrivalTime?: string | null;
  proposedPickupTime?: string | null;
};
const introductions: Record<NotificationEvent, string> = {
  dropoff_reminder:
    "Lämningsdagen närmar sig. Logga in i DogBooker och ange din önskade lämningstid, eller skicka ett nytt förslag om det tidigare har nekats. Hundvakten behöver godkänna tiden.",
  pickup_reminder:
    "Hämtningsdagen närmar sig. Logga in i DogBooker och ange din önskade hämtningstid, eller skicka ett nytt förslag om det tidigare har nekats. Hundvakten behöver godkänna tiden.",
  time_change_requested:
    "Hundägaren önskar ändra tiderna. Nuvarande tider gäller tills du godkänner förslaget. Logga in för att svara.",
  time_change_approved:
    "Din ändring av tiderna har godkänts. De nya tiderna gäller nu. Bokningens status och datum är oförändrade.",
  time_change_declined:
    "Din ändring av tiderna har nekats. Nuvarande tider gäller fortfarande. Bokningens status och datum är oförändrade.",
  time_change_proposed:
    "Hundvakten föreslår andra tider. Nuvarande tider gäller tills du accepterar förslaget i DogBooker. Bokningens status är oförändrad.",
  time_change_accepted:
    "Hundägaren har accepterat ditt tidsförslag. De nya tiderna gäller nu. Bokningens status och datum är oförändrade.",
  time_change_rejected:
    "Hundägaren har tackat nej till ditt tidsförslag. Nuvarande tider gäller fortfarande.",
  time_change_direct:
    "Hundvakten har ändrat tiderna för vistelsen. De nya tiderna gäller nu. Bokningens status och datum är oförändrade.",
  requested:
    "Du har fått en ny bokningsförfrågan. Logga in i DogBooker för att godkänna eller neka den.",
  approved: "Din bokningsförfrågan har godkänts. Vi ser fram emot besöket!",
  declined:
    "Din bokningsförfrågan har nekats. Logga in i DogBooker om du vill välja andra datum.",
  owner_cancelled:
    "Hundägaren har avbokat vistelsen. Datumen är tillgängliga för den hunden igen.",
  admin_cancelled:
    "Din hundvakt har avbokat vistelsen. Kontakta hundvakten om du har frågor.",
  times_changed:
    "Tiderna för lämning eller hämtning har ändrats. Bokningens status och datum är oförändrade.",
  arrival_changed:
    "Den beräknade ankomsttiden har ändrats. Bokningens status och datum är oförändrade.",
};
export function notificationContent(
  event: NotificationEvent,
  payload: NotificationPayload,
  origin: string,
) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid mail origin");
  const status = bookingStatusLabel[payload.status];
  const dog = payload.dogName.replace(/[\r\n]/g, " ");
  if (event === "dropoff_reminder" || event === "pickup_reminder") {
    const arrival = event === "dropoff_reminder",
      label = arrival ? "lämningstid" : "hämtningstid",
      date = arrival ? payload.startDate : payload.endDate;
    return {
      subject: `DogBooker: Påminnelse om ${label} – ${dog}`,
      text: `${introductions[event]}\n\nHund: ${dog}\n${arrival ? "Lämningsdag" : "Hämtningsdag"}: ${formatDate(date)}\nStatus: ${status}\n\nVälj en tid inom det tillåtna tidsfönstret. Tiderna gäller svensk tid (Europe/Stockholm). En redan godkänd tid gäller tills en ändring har godkänts.\n\nÖppna DogBooker: ${url.origin}/\n\nLänken kräver inloggning.`,
    };
  }
  const times = `Lämning: ${formatDate(payload.startDate)}, ${arrivalTimeLabel(payload.arrivalTime)}\nHämtning: ${formatDate(payload.endDate)}, ${arrivalTimeLabel(payload.pickupTime)} (svensk tid)`;
  const changes = event.startsWith("time_change_")
    ? `\nTidigare gällande lämningstid: ${arrivalTimeLabel(payload.previousArrivalTime)}\nFöreslagen lämningstid: ${arrivalTimeLabel(payload.proposedArrivalTime)}\nTidigare gällande hämtningstid: ${arrivalTimeLabel(payload.previousPickupTime)}\nFöreslagen hämtningstid: ${arrivalTimeLabel(payload.proposedPickupTime)}`
    : event === "times_changed"
      ? `\nTidigare lämningstid: ${arrivalTimeLabel(payload.previousArrivalTime)}\nNy lämningstid: ${arrivalTimeLabel(payload.arrivalTime)}\nTidigare hämtningstid: ${arrivalTimeLabel(payload.previousPickupTime)}\nNy hämtningstid: ${arrivalTimeLabel(payload.pickupTime)}`
      : event === "arrival_changed"
        ? `\nAnkomstdag: ${formatDate(payload.startDate)}\nTidigare ankomsttid: ${arrivalTimeLabel(payload.previousArrivalTime)}\nNy ankomsttid: ${arrivalTimeLabel(payload.arrivalTime)}`
        : "";
  const arrival = `${times}${changes}\nTiderna gäller svensk tid (Europe/Stockholm).`;
  const titles: Partial<Record<NotificationEvent, string>> = {
    time_change_requested: "Önskemål om ändrade tider",
    time_change_approved: "Tidsändring godkänd",
    time_change_declined: "Tidsändring nekad",
    time_change_proposed: "Nytt tidsförslag",
    time_change_accepted: "Tidsförslag accepterat",
    time_change_rejected: "Tidsförslag avböjt",
    time_change_direct: "Tider ändrade av hundvakten",
  };
  return {
    subject: `DogBooker: ${titles[event] ?? (event === "times_changed" ? "Ändrade tider" : event === "arrival_changed" ? "Ändrad ankomsttid" : status)} – ${dog}`,
    text: `${introductions[event]}\n\nHund: ${dog}\nDatum: ${formatRange(payload.startDate, payload.endDate)}\n${arrival}\nStatus: ${status}\n\nÖppna DogBooker: ${url.origin}/\n\nLänken kräver inloggning. Beslut om bokningar fattas alltid inne i DogBooker.`,
  };
}
