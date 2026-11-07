import type { CalendarEntry } from "./booking-service";

export type CalendarAction = "booking" | "block" | "unblock";
export function comingLabel(names: string[]) {
  const dogs = [...names].sort();
  return dogs.length > 1
    ? `${dogs.length} hundar kommer`
    : `${dogs[0] ?? "Hunden"} kommer`;
}

export function calendarDay(
  entries: CalendarEntry[],
  day: string,
  options: {
    admin: boolean;
    ownerId?: string;
    action?: CalendarAction;
    editingId?: string;
  },
) {
  const stays = entries.filter((e) => e.startDate <= day && e.endDate >= day);
  const block = stays.some(
    (e) => e.state === "block" || e.state === "unavailable",
  );
  const confirmed = stays.filter(
    (e) => e.state === "companion" || e.status === "confirmed",
  );
  const names = confirmed.map((e) => e.dogName ?? "Hunden");
  const pending = stays.filter((e) => e.status === "pending");
  const labels = [
    ...(names.length ? [comingLabel(names)] : []),
    ...pending.map((e) => `${e.dogName ?? "Hunden"}: väntar på godkännande`),
  ];
  const unavailable =
    options.action === "unblock" && options.admin
      ? false
      : block ||
        stays.some((e) => {
          if (e.id === options.editingId && options.editingId) return false;
          if (!options.admin) return e.state === "mine";
          if (options.action === "block") return e.state === "booking";
          return e.state === "booking" && e.ownerId === options.ownerId;
        });
  return {
    unavailable,
    label: block ? "Ej tillgänglig" : labels.join(". ") || "Tillgänglig",
    shortLabel: block
      ? "Ej tillgänglig"
      : [
          names.length > 1
            ? `${names.length} hundar kommer`
            : names.length
              ? `${names[0]} kommer`
              : "",
          ...pending.map((e) => `${e.dogName ?? "Hunden"} väntar`),
        ]
          .filter(Boolean)
          .join(" · "),
    style: block
      ? "unavailable"
      : names.length > 1
        ? "both"
        : pending.length
          ? "pending"
          : stays.some((e) => e.state === "mine")
            ? "mine"
            : stays.length
              ? "companion"
              : "available",
  };
}

// Only confirmed dates enter this list. Other owners' entries have already
// been reduced to dates + dog name by the server's privacy projection.
export function sharedStays(
  entries: CalendarEntry[],
  start: string,
  end: string,
) {
  if (!start || !end || end < start) return [];
  return entries
    .filter(
      (e) =>
        (e.state === "companion" || e.status === "confirmed") &&
        e.startDate <= end &&
        e.endDate >= start,
    )
    .map((e) => ({
      dogName: e.dogName ?? "Hunden",
      startDate: e.startDate < start ? start : e.startDate,
      endDate: e.endDate > end ? end : e.endDate,
    }));
}
