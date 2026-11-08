export function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
