import { arrivalOptions } from "./arrival-time";
export type TimeWindows = {
  arrivalStart: string;
  arrivalEnd: string;
  pickupStart: string;
  pickupEnd: string;
};
export type WindowSettings = {
  revision: number;
  defaults: TimeWindows;
  overrides: (TimeWindows & { date: string })[];
};
export const defaultWindows: TimeWindows = {
  arrivalStart: "06:00",
  arrivalEnd: "23:00",
  pickupStart: "06:00",
  pickupEnd: "23:00",
};
export function applicableWindow(
  settings: WindowSettings,
  date: string,
  kind: "arrival" | "pickup",
) {
  const w =
    settings.overrides.find((w) => w.date === date) ?? settings.defaults;
  return {
    start: w[kind === "arrival" ? "arrivalStart" : "pickupStart"],
    end: w[kind === "arrival" ? "arrivalEnd" : "pickupEnd"],
  };
}
export function windowOptions(window: { start: string; end: string }) {
  return arrivalOptions.filter((t) => t >= window.start && t <= window.end);
}
export function timeWithinWindow(
  time: string | null,
  window: { start: string; end: string },
) {
  return time !== null && windowOptions(window).includes(time);
}
export type TimeProposal = {
  id: string;
  revision: number;
  proposerRole: "admin" | "owner";
  arrivalTime: string | null;
  pickupTime: string | null;
};
