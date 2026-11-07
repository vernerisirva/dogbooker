import { it, expect, vi } from "vitest";
import { bookingTimesChangeSchema } from "@/lib/arrival-validation";
import {
  arrivalOptions,
  bookingTimesError,
  canEditArrival,
} from "@/lib/arrival-time";
import { todayStockholm } from "@/lib/dates";
import { notificationContent } from "@/lib/notification-content";
it("offers 06:00 through 23:00 inclusive in quarter hours", () => {
  expect(arrivalOptions).toHaveLength(69);
  expect(arrivalOptions[0]).toBe("06:00");
  expect(arrivalOptions.at(-1)).toBe("23:00");
  for (const time of [...arrivalOptions, null])
    expect(
      bookingTimesChangeSchema.parse({ pickupTime: time, expectedRevision: 0 })
        .pickupTime,
    ).toBe(time);
});
it.each(["05:45", "23:15", "06:01", "24:00", "6:00", "18:00Z"])(
  "rejects pickup %s",
  (pickupTime) => {
    expect(
      bookingTimesChangeSchema.safeParse({ pickupTime, expectedRevision: 0 })
        .success,
    ).toBe(false);
  },
);
it("requires a time field and rejects clock, deadline and revision overrides", () => {
  expect(
    bookingTimesChangeSchema.safeParse({ expectedRevision: 0 }).success,
  ).toBe(false);
  for (const extra of [
    { endDate: "2099-01-01" },
    { role: "admin" },
    { now: "2000-01-01" },
    { expectedRevision: -1 },
  ])
    expect(
      bookingTimesChangeSchema.safeParse({
        pickupTime: "18:00",
        expectedRevision: 0,
        ...extra,
      }).success,
    ).toBe(false);
});
it("requires later pickup only when both same-day times are known", () => {
  expect(
    bookingTimesError("2026-11-01", "2026-11-01", "10:00", "10:00"),
  ).toContain("senare");
  expect(
    bookingTimesError("2026-11-01", "2026-11-01", "10:00", "09:45"),
  ).toContain("senare");
  for (const [arrival, pickup] of [
    ["10:00", "10:15"],
    [null, "06:00"],
    ["23:00", null],
    [null, null],
  ])
    expect(
      bookingTimesError("2026-11-01", "2026-11-01", arrival, pickup),
    ).toBeNull();
  expect(
    bookingTimesError("2026-11-01", "2026-11-02", "23:00", "06:00"),
  ).toBeNull();
});
it.each([
  ["2026-11-05", "2026-11-05T22:59:59.999Z", true],
  ["2026-11-05", "2026-11-05T23:00:00Z", false],
  ["2027-03-28", "2027-03-28T21:59:59.999Z", true],
  ["2027-03-28", "2027-03-28T22:00:00Z", false],
  ["2026-10-25", "2026-10-25T22:59:59.999Z", true],
  ["2026-10-25", "2026-10-25T23:00:00Z", false],
] as const)(
  "uses pickup-day Stockholm boundary %s %s",
  (end, instant, editable) => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const today = todayStockholm(new Date(instant));
      expect(canEditArrival("owner", "confirmed", end, today)).toBe(editable);
      expect(canEditArrival("admin", "confirmed", end, today)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);
it("includes both times in requests/confirmations and all previous/new values in edit mail", () => {
  const payload = {
    dogName: "Luna",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    status: "confirmed" as const,
    arrivalTime: "10:15",
    pickupTime: "19:30",
    previousArrivalTime: "09:15",
    previousPickupTime: "18:30",
  };
  for (const event of ["requested", "approved", "times_changed"] as const) {
    const mail = notificationContent(
      event,
      payload,
      "https://dogbooker.example.test",
    );
    expect(mail.text).toContain("Lämning: 1 november 2026, kl. 10:15");
    expect(mail.text).toContain("Hämtning: 2 november 2026, kl. 19:30");
    expect(mail.text).toContain("Status: Godkänd");
    expect(mail.text).toContain("Länken kräver inloggning");
    if (event === "times_changed")
      for (const text of [
        "Tidigare lämningstid: kl. 09:15",
        "Ny lämningstid: kl. 10:15",
        "Tidigare hämtningstid: kl. 18:30",
        "Ny hämtningstid: kl. 19:30",
      ])
        expect(mail.text).toContain(text);
  }
});
