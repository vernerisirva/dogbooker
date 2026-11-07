import { describe, it, expect } from "vitest";
import { calendarDay, sharedStays } from "@/lib/calendar-availability";
import type { CalendarEntry } from "@/lib/booking-service";
const day = "2027-01-31";
const luna: CalendarEntry = {
  startDate: day,
  endDate: "2027-02-02",
  state: "mine",
  id: "luna-booking",
  dogName: "Luna",
  status: "confirmed",
};
const milo: CalendarEntry = {
  startDate: day,
  endDate: "2027-02-04",
  state: "companion",
  dogName: "Milo",
};
describe("dog-specific calendar", () => {
  it("shows a companion without preventing a request", () => {
    expect(calendarDay([milo], day, { admin: false })).toMatchObject({
      label: "Milo kommer",
      unavailable: false,
    });
  });
  it("combines confirmed stays independently of their order", () => {
    for (const entries of [
      [luna, milo],
      [milo, luna],
    ])
      expect(calendarDay(entries, day, { admin: false })).toMatchObject({
        label: "2 hundar kommer",
        style: "both",
        unavailable: true,
      });
  });
  it("reserves the owner's pending dates without claiming approval", () => {
    expect(
      calendarDay([{ ...luna, status: "pending" }, milo], day, {
        admin: false,
      }),
    ).toMatchObject({
      label: "Milo kommer. Luna: väntar på godkännande",
      unavailable: true,
    });
  });
  it("checks the selected dog for admin bookings, all dogs for blocks", () => {
    const entries: CalendarEntry[] = [
      { ...luna, state: "booking", ownerId: "luna" },
    ];
    expect(
      calendarDay(entries, day, { admin: true, ownerId: "milo" }).unavailable,
    ).toBe(false);
    expect(
      calendarDay(entries, day, { admin: true, ownerId: "luna" }).unavailable,
    ).toBe(true);
    expect(
      calendarDay(entries, day, { admin: true, action: "block" }).unavailable,
    ).toBe(true);
    expect(
      calendarDay(entries, day, {
        admin: true,
        ownerId: "luna",
        editingId: luna.id,
      }).unavailable,
    ).toBe(false);
  });
  it("blocks both dogs and only lets administrators select blocked dates for release", () => {
    const entries: CalendarEntry[] = [
      { startDate: day, endDate: day, state: "block" },
    ];
    for (const admin of [true, false])
      expect(calendarDay(entries, day, { admin })).toMatchObject({
        label: "Ej tillgänglig",
        unavailable: true,
      });
    expect(
      calendarDay(entries, day, { admin: true, action: "unblock" }).unavailable,
    ).toBe(false);
  });
  it("shows only confirmed shared dates, clipped to a selection spanning months", () => {
    expect(
      sharedStays(
        [{ ...luna, status: "pending" }, milo],
        "2027-01-30",
        "2027-02-01",
      ),
    ).toEqual([{ dogName: "Milo", startDate: day, endDate: "2027-02-01" }]);
  });
});

it("counts three confirmed dogs, including dogs with identical names", () => {
  const entries: CalendarEntry[] = [luna, milo, { ...milo, dogName: "Luna" }];
  expect(calendarDay(entries, day, { admin: false })).toMatchObject({
    label: "3 hundar kommer",
    shortLabel: "3 hundar kommer",
    style: "both",
  });
});
