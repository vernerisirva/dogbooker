import { describe, it, expect } from "vitest";
import {
  showInUpcoming,
  cancellationVisibleUntil,
  CANCELLATION_WINDOW_MS,
} from "@/lib/cancellation-visibility";
describe("24-hour cancellation visibility", () => {
  it.each([
    "2026-11-05T12:00:00Z",
    "2027-03-27T12:00:00Z",
    "2026-10-24T12:00:00Z",
  ])("uses elapsed hours across midnight and DST: %s", (cancelledAt) => {
    const start = Date.parse(cancelledAt),
      b = { status: "cancelled", cancelledAt };
    expect(showInUpcoming(b, start)).toBe(true);
    expect(showInUpcoming(b, start + CANCELLATION_WINDOW_MS - 1)).toBe(true);
    expect(showInUpcoming(b, start + CANCELLATION_WINDOW_MS)).toBe(false);
    expect(showInUpcoming(b, start + CANCELLATION_WINDOW_MS + 1)).toBe(false);
    expect(showInUpcoming(b, start - 1)).toBe(false);
  });
  it.each([null, undefined, "invalid"])(
    "does not guess unreliable timestamps: %s",
    (cancelledAt) => {
      expect(cancellationVisibleUntil(cancelledAt)).toBeNull();
      expect(
        showInUpcoming({ status: "cancelled", cancelledAt }, Date.now()),
      ).toBe(false);
    },
  );
  it.each(["pending", "confirmed", "declined"])(
    "leaves %s visibility unchanged",
    (status) => {
      expect(showInUpcoming({ status }, Date.now())).toBe(true);
    },
  );
});
