import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ pool: {} }));
vi.mock("@/lib/access", () => ({
  requireAdmin: (a: { role: string }) => {
    if (a.role !== "admin") throw new Error("Forbidden");
  },
}));
import { visibleCalendarEntry } from "@/lib/booking-service";
import type { Actor } from "@/lib/access";
const owner: Actor = {
  id: "owner-a",
  role: "owner",
  name: "A",
  email: "a@example.test",
  dogName: "Luna",
};
const entry = {
  id: "private-id",
  kind: "booking" as const,
  ownerId: "owner-b",
  startDate: "2027-01-01",
  endDate: "2027-01-03",
  note: "PRIVATE",
  status: "confirmed" as const,
  ownerName: "Secret owner",
  dogName: "Milo",
};
describe("owner projections", () => {
  it("exposes only confirmed dates and the other dog’s name", () => {
    expect(visibleCalendarEntry(entry, owner)).toEqual({
      startDate: entry.startDate,
      endDate: entry.endDate,
      state: "companion",
      dogName: "Milo",
    });
  });
  it.each(["pending", "declined", "cancelled"] as const)(
    "hides another owner's %s booking",
    (status) => {
      expect(visibleCalendarEntry({ ...entry, status }, owner)).toBeNull();
    },
  );
  it("never includes private notes even on the owner’s own booking", () => {
    expect(
      visibleCalendarEntry({ ...entry, ownerId: owner.id }, owner),
    ).toEqual({
      id: "private-id",
      startDate: entry.startDate,
      endDate: entry.endDate,
      state: "mine",
      dogName: "Milo",
      status: "confirmed",
    });
  });
  it("treats blocks as unavailable without revealing reasons", () => {
    expect(
      visibleCalendarEntry({ ...entry, kind: "block", ownerId: null }, owner),
    ).toEqual({
      startDate: entry.startDate,
      endDate: entry.endDate,
      state: "unavailable",
    });
  });
  it("includes guest details and notes for administrators", () => {
    expect(
      visibleCalendarEntry(entry, { ...owner, role: "admin" }),
    ).toMatchObject({
      note: "PRIVATE",
      ownerName: "Secret owner",
      dogName: "Milo",
      state: "booking",
    });
  });
});
