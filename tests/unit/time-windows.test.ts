import { it, expect } from "vitest";
import {
  applicableWindow,
  defaultWindows,
  windowOptions,
  timeWithinWindow,
} from "@/lib/time-windows";
import { windowsSchema, windowUpdateSchema } from "@/lib/time-window-service";
import {
  notificationContent,
  type NotificationEvent,
} from "@/lib/notification-content";
const windows = {
  arrivalStart: "07:00",
  arrivalEnd: "10:00",
  pickupStart: "16:00",
  pickupEnd: "20:00",
};
it("chooses defaults or the exact date exception independently for arrival and pickup", () => {
  const s = {
    revision: 1,
    defaults: windows,
    overrides: [
      { date: "2026-11-05", ...defaultWindows, arrivalStart: "08:00" },
    ],
  };
  expect(applicableWindow(s, "2026-11-04", "arrival")).toEqual({
    start: "07:00",
    end: "10:00",
  });
  expect(applicableWindow(s, "2026-11-05", "arrival").start).toBe("08:00");
  expect(applicableWindow(s, "2026-11-06", "pickup")).toEqual({
    start: "16:00",
    end: "20:00",
  });
  expect(windowOptions({ start: "07:00", end: "07:30" })).toEqual([
    "07:00",
    "07:15",
    "07:30",
  ]);
  expect(timeWithinWindow("10:00", { start: "07:00", end: "10:00" })).toBe(
    true,
  );
  expect(timeWithinWindow("10:15", { start: "07:00", end: "10:00" })).toBe(
    false,
  );
});
it("validates ranges, increments, dates and stale-version input", () => {
  expect(windowsSchema.safeParse(windows).success).toBe(true);
  for (const arrivalStart of ["05:45", "23:15", "07:01", "11:00"])
    expect(windowsSchema.safeParse({ ...windows, arrivalStart }).success).toBe(
      false,
    );
  expect(
    windowUpdateSchema.safeParse({ expectedRevision: 0, windows: null })
      .success,
  ).toBe(false);
  expect(
    windowUpdateSchema.safeParse({
      expectedRevision: 0,
      date: "2026-02-30",
      windows,
    }).success,
  ).toBe(false);
  expect(
    windowUpdateSchema.safeParse({
      expectedRevision: 0,
      date: "2026-11-05",
      windows: null,
    }).success,
  ).toBe(true);
});
it.each([
  "time_change_requested",
  "time_change_approved",
  "time_change_declined",
  "time_change_proposed",
  "time_change_accepted",
  "time_change_rejected",
  "time_change_direct",
] as NotificationEvent[])(
  "renders Swedish current/proposed times and secure login link for %s",
  (event) => {
    const mail = notificationContent(
      event,
      {
        dogName: "Luna",
        status: "confirmed",
        startDate: "2026-11-05",
        endDate: "2026-11-06",
        arrivalTime: "07:00",
        pickupTime: "18:00",
        previousArrivalTime: "07:00",
        previousPickupTime: "18:00",
        proposedArrivalTime: "08:15",
        proposedPickupTime: "19:15",
      },
      "https://dogbooker.example.test",
    );
    expect(mail.text).toContain("Tidigare gällande lämningstid: kl. 07:00");
    expect(mail.text).toContain("Föreslagen hämtningstid: kl. 19:15");
    expect(mail.text).toContain("5 november 2026");
    expect(mail.text).toContain("Status: Godkänd");
    expect(mail.text).toContain("https://dogbooker.example.test/");
    expect(mail.text).toContain("kräver inloggning");
    expect(mail.text).not.toMatch(/token=|approve=/);
  },
);
