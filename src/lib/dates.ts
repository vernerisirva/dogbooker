export const BOOKING_TIMEZONE = "Europe/Stockholm";
export const DATE_LOCALE = "sv-SE";
export function todayStockholm(now = new Date()): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    timeZone: BOOKING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function addDays(value: string, count: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function dayCount(start: string, end: string) {
  return (
    Math.round(
      (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
        86400000,
    ) + 1
  );
}
export function validateRange(
  start: string,
  end: string,
  today = todayStockholm(),
) {
  if (!isDate(start) || !isDate(end)) return "Välj giltiga datum.";
  if (end < start)
    return "Slutdatumet måste vara samma dag som startdatumet eller senare.";
  if (start < today) return "Välj dagens datum eller ett senare datum.";
  if (dayCount(start, end) > 366) return "Välj en period på högst 366 dagar.";
  if (end > addDays(today, 730)) return "Välj datum inom de närmaste två åren.";
  return null;
}
export function monthBounds(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDate(`${month}-01`))
    throw new Error("Ogiltig månad");
  const start = `${month}-01`;
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { start, end: d.toISOString().slice(0, 10) };
}
export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
  },
) {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    ...options,
    timeZone: BOOKING_TIMEZONE,
  }).format(new Date(`${value}T12:00:00Z`));
}
export function formatRange(start: string, end: string) {
  return start === end
    ? formatDate(start)
    : `${formatDate(start, { day: "numeric", month: "long", ...(start.slice(0, 4) !== end.slice(0, 4) ? { year: "numeric" } : {}) })} – ${formatDate(end)}`;
}
