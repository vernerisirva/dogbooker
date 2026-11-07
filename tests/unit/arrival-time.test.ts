import { describe, expect, it, vi } from "vitest";
import {
  arrivalChangeSchema,
  arrivalTimeSchema,
} from "@/lib/arrival-validation";
import {
  arrivalOptions,
  arrivalTimeLabel,
  canEditArrival,
} from "@/lib/arrival-time";
import { todayStockholm } from "@/lib/dates";
import { notificationContent } from "@/lib/notification-content";
describe("Stockholm arrival times", () => {
  it("accepts optional quarter hours without shifting the local clock time", () => {
    expect(arrivalOptions).toHaveLength(69);
    for (const time of [...arrivalOptions, null])
      expect(arrivalTimeSchema.parse(time)).toBe(time);
    expect(arrivalTimeLabel("09:15")).toBe("kl. 09:15");
    expect(arrivalTimeLabel(null)).toBe("Tid inte angiven");
  });
  it.each([
    "24:00",
    "00:00",
    "05:45",
    "23:15",
    "23:45",
    "9:15",
    "12:05",
    "10:30:00",
    "10:15Z",
    "10:15+02:00",
    "",
    42,
  ])("rejects malformed or non-quarter-hour time %s", (time) => {
    expect(arrivalTimeSchema.safeParse(time).success).toBe(false);
  });
  it("rejects attempts to supply a date, clock, role, status or invalid revision", () => {
    for (const extra of [
      { startDate: "2099-01-01" },
      { now: "2000-01-01" },
      { role: "admin" },
      { status: "confirmed" },
      { expectedRevision: -1 },
    ])
      expect(
        arrivalChangeSchema.safeParse({
          arrivalTime: "10:00",
          expectedRevision: 0,
          ...extra,
        }).success,
      ).toBe(false);
  });
  it.each([
    ["2026-11-05", "2026-11-05T22:59:59.999Z", true],
    ["2026-11-05", "2026-11-05T23:00:00Z", false],
    ["2026-06-05", "2026-06-05T21:59:59.999Z", true],
    ["2026-06-05", "2026-06-05T22:00:00Z", false],
    ["2027-03-28", "2027-03-28T21:59:59.999Z", true],
    ["2027-03-28", "2027-03-28T22:00:00Z", false],
    ["2026-10-25", "2026-10-25T22:59:59.999Z", true],
    ["2026-10-25", "2026-10-25T23:00:00Z", false],
  ])("first day %s, instant %s: editable=%s", (start, instant, expected) => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    try {
      const today = todayStockholm(new Date(instant));
      for (const status of ["pending", "confirmed"])
        expect(canEditArrival("owner", status, start, today)).toBe(expected);
      expect(canEditArrival("admin", "confirmed", start, today)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("keeps declined/cancelled times read-only for both roles", () => {
    for (const role of ["owner", "admin"] as const)
      for (const status of ["declined", "cancelled"])
        expect(canEditArrival(role, status, "2027-01-01", "2026-01-01")).toBe(
          false,
        );
  });
  it.each([
    [null, "10:15"],
    ["10:15", "11:30"],
    ["11:30", null],
  ])(
    "emails previous %s and new %s time privately",
    (previousArrivalTime, arrivalTime) => {
      const mail = notificationContent(
        "arrival_changed",
        {
          dogName: "Luna",
          startDate: "2026-11-05",
          endDate: "2026-11-07",
          status: "confirmed",
          arrivalTime,
          previousArrivalTime,
        },
        "https://dogbooker.example.test",
      );
      expect(mail.subject).toBe("DogBooker: Ändrad ankomsttid – Luna");
      expect(mail.text).toContain(
        `Tidigare ankomsttid: ${arrivalTimeLabel(previousArrivalTime)}`,
      );
      expect(mail.text).toContain(
        `Ny ankomsttid: ${arrivalTimeLabel(arrivalTime)}`,
      );
      expect(mail.text).toContain("Ankomstdag: 5 november 2026");
      expect(mail.text).toContain("Status: Godkänd");
      expect(mail.text).toContain("Länken kräver inloggning");
      expect(mail.text).not.toMatch(
        /token=|\/decision|ownerId|Privat anteckning/,
      );
    },
  );
});
