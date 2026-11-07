import { it, expect } from "vitest";
import {
  reminderDueAt,
  reminderDate,
  nextReminderWake,
  reminderEligible,
  type ReminderBooking,
} from "@/lib/reminder-policy";
import { notificationContent } from "@/lib/notification-content";
const b: ReminderBooking = {
  status: "confirmed",
  startDate: "2026-11-05",
  endDate: "2026-11-07",
  arrivalTime: null,
  pickupTime: null,
  arrivalResubmissionRequired: false,
  pickupResubmissionRequired: false,
  awaitingArrivalApproval: false,
  awaitingPickupApproval: false,
  activeOwner: true,
};
it.each([
  ["2026-03-30", "2026-03-28T08:00:00.000Z"],
  ["2026-03-31", "2026-03-29T07:00:00.000Z"],
  ["2026-10-26", "2026-10-24T07:00:00.000Z"],
  ["2026-10-27", "2026-10-25T08:00:00.000Z"],
  ["2027-01-01", "2026-12-30T08:00:00.000Z"],
])("uses two calendar days and Stockholm 09:00 for %s", (date, due) =>
  expect(reminderDueAt(date).toISOString()).toBe(due),
);
it.each([0, 1, 2, 7])(
  "keeps independent start/end schedules for a %i-day difference",
  (offset) => {
    const end = new Date("2026-11-05T12:00Z");
    end.setUTCDate(end.getUTCDate() + offset);
    const x = { ...b, endDate: end.toISOString().slice(0, 10) };
    for (const event of ["dropoff_reminder", "pickup_reminder"] as const) {
      const date = event === "dropoff_reminder" ? x.startDate : x.endDate,
        day = reminderDate(date);
      expect(reminderEligible(x, event, day, reminderDueAt(date))).toBe(true);
    }
  },
);
it("excludes early, stale-day, inactive and final bookings", () => {
  const day = "2026-11-03",
    now = new Date("2026-11-03T08:00:00Z");
  expect(
    reminderEligible(b, "dropoff_reminder", day, new Date(now.getTime() - 1)),
  ).toBe(false);
  expect(
    reminderEligible(b, "dropoff_reminder", day, new Date("2026-11-03T23:00Z")),
  ).toBe(false);
  for (const status of ["cancelled", "declined"])
    expect(
      reminderEligible({ ...b, status }, "dropoff_reminder", day, now),
    ).toBe(false);
  expect(
    reminderEligible(
      { ...b, activeOwner: false },
      "dropoff_reminder",
      day,
      now,
    ),
  ).toBe(false);
});
it("suppresses only the corresponding pending proposal and reminds after rejection", () => {
  const x = {
      ...b,
      endDate: b.startDate,
      arrivalTime: "08:00",
      arrivalResubmissionRequired: true,
      awaitingArrivalApproval: true,
    },
    now = reminderDueAt(b.startDate),
    day = reminderDate(b.startDate);
  expect(reminderEligible(x, "dropoff_reminder", day, now)).toBe(false);
  expect(reminderEligible(x, "pickup_reminder", day, now)).toBe(true);
  expect(
    reminderEligible(
      { ...x, awaitingArrivalApproval: false },
      "dropoff_reminder",
      day,
      now,
    ),
  ).toBe(true);
  expect(
    reminderEligible(
      {
        ...x,
        awaitingArrivalApproval: false,
        arrivalResubmissionRequired: false,
      },
      "dropoff_reminder",
      day,
      now,
    ),
  ).toBe(false);
});
it("selects the next local 09:00 wake without drift", () => {
  expect(nextReminderWake(new Date("2026-10-24T07:00Z"))).toEqual({
    day: "2026-10-25",
    wakeAt: "2026-10-25T08:00:00.000Z",
  });
  expect(nextReminderWake(new Date("2026-11-03T07:59:59Z")).day).toBe(
    "2026-11-03",
  );
});
it("renders two separate Swedish requests with authenticated links", () => {
  const p = {
    dogName: "Luna",
    startDate: b.startDate,
    endDate: b.startDate,
    status: "confirmed" as const,
  };
  const a = notificationContent(
      "dropoff_reminder",
      p,
      "https://dogbooker.example.test",
    ),
    z = notificationContent(
      "pickup_reminder",
      p,
      "https://dogbooker.example.test",
    );
  expect(a.subject).toContain("lämningstid");
  expect(a.text).not.toContain("hämtningstid");
  expect(z.subject).toContain("hämtningstid");
  expect(z.text).not.toContain("lämningstid");
  for (const mail of [a, z]) {
    expect(mail.text).toContain("5 november 2026");
    expect(mail.text).toContain("kräver inloggning");
    expect(mail.text).not.toMatch(/token=|approve=/);
  }
});
