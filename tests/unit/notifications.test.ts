import { describe, it, expect } from "vitest";
import {
  notificationContent,
  type NotificationEvent,
} from "@/lib/notification-content";
import { reservesDates, bookingStatusLabel } from "@/lib/booking-status";
describe("booking status and Swedish email content", () => {
  it("reserves pending/confirmed dates and releases final states", () => {
    expect(
      ["pending", "confirmed", "declined", "cancelled"].map(reservesDates),
    ).toEqual([true, true, false, false]);
  });
  it.each([
    "requested",
    "approved",
    "declined",
    "owner_cancelled",
    "admin_cancelled",
  ] as NotificationEvent[])(
    "renders a private authenticated %s notification",
    (event) => {
      const mail = notificationContent(
        event,
        {
          dogName: "Luna\r\nBcc: intruder",
          startDate: "2026-11-05",
          endDate: "2026-11-07",
          status:
            event === "requested"
              ? "pending"
              : event === "approved"
                ? "confirmed"
                : event === "declined"
                  ? "declined"
                  : "cancelled",
        },
        "https://dogbooker.example.test",
      );
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.text).toContain("5 november – 7 november 2026");
      expect(mail.text).toContain(
        "https://dogbooker.example.test/",
      );
      expect(mail.text).toContain("kräver inloggning");
      expect(mail.text).not.toMatch(
        /token=|approve=|\/decision|Privat anteckning/,
      );
      expect(
        Object.values(bookingStatusLabel).some((s) => mail.subject.includes(s)),
      ).toBe(true);
    },
  );
  it("refuses insecure notification links", () => {
    expect(() =>
      notificationContent(
        "requested",
        {
          dogName: "Luna",
          startDate: "2026-11-05",
          endDate: "2026-11-05",
          status: "pending",
        },
        "http://insecure.test",
      ),
    ).toThrow();
  });
});
