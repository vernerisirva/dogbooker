import { describe, it, expect } from "vitest";
import {
  todayStockholm,
  isDate,
  addDays,
  dayCount,
  validateRange,
  monthBounds,
  formatDate,
  formatRange,
} from "@/lib/dates";
describe("calendar dates in Stockholm", () => {
  it("formats Swedish dates, months and weekdays without shifting the calendar day", () => {
    expect(formatDate("2026-11-05")).toBe("5 november 2026");
    expect(formatDate("2026-11-05", { weekday: "long" })).toBe("torsdag");
    expect(formatDate("2026-11-01", { month: "long", year: "numeric" })).toBe(
      "november 2026",
    );
    expect(formatRange("2026-11-05", "2026-11-05")).toBe("5 november 2026");
    expect(formatRange("2026-11-05", "2026-11-07")).toBe(
      "5 november – 7 november 2026",
    );
    expect(formatRange("2026-12-31", "2027-01-02")).toBe(
      "31 december 2026 – 2 januari 2027",
    );
    expect(formatDate("2026-03-29")).toBe("29 mars 2026");
    expect(formatDate("2026-10-25")).toBe("25 oktober 2026");
  });
  it("uses Stockholm midnight, not UTC midnight", () => {
    expect(todayStockholm(new Date("2026-10-28T23:30:00Z"))).toBe("2026-10-29");
    expect(todayStockholm(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });
  it("rejects malformed and rolled-over dates", () => {
    for (const d of [
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-1-2",
      "2026-01-01T00:00:00Z",
      "hello",
    ])
      expect(isDate(d)).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
  });
  it("counts both endpoints and ignores DST transitions", () => {
    expect(dayCount("2026-03-28", "2026-03-30")).toBe(3);
    expect(dayCount("2026-10-24", "2026-10-26")).toBe(3);
    expect(dayCount("2026-10-28", "2026-10-28")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("validates past, reversed, excessive, and distant ranges", () => {
    const today = "2026-10-28";
    expect(validateRange(today, today, today)).toBe(null);
    expect(validateRange("2026-10-27", today, today)).toMatch(/senare datum/);
    expect(validateRange(today, "2026-10-27", today)).toMatch(/Slutdatumet/);
    expect(validateRange(today, "2027-11-01", today)).toMatch(/366/);
    expect(validateRange("2029-01-01", "2029-01-02", today)).toMatch(
      /två åren/,
    );
  });
  it("handles month lengths and leap years", () => {
    expect(monthBounds("2028-02").end).toBe("2028-02-29");
    expect(monthBounds("2026-12").end).toBe("2026-12-31");
    expect(() => monthBounds("2026-13")).toThrow();
  });
});
