import { beforeEach, expect, it, vi } from "vitest";
import { formatDeadline } from "../lib/hold-display";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn() }));
vi.mock("../lib/db", () => ({ transaction: mocks.transaction }));
import { expireHolds } from "../lib/expiration-worker";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (_actor, work) =>
    work({ query: mocks.query }),
  );
  mocks.query.mockResolvedValue({ rows: [{ count: 0 }] });
});
it("uses actor-free bounded transactions with statement and lock timeouts", async () => {
  expect(await expireHolds()).toEqual({
    expired: 0,
    batches: 1,
    limitReached: false,
  });
  expect(mocks.transaction.mock.calls[0][0]).toBe("");
  expect(mocks.query.mock.calls).toEqual([
    ["SET LOCAL lock_timeout='2s'"],
    ["SET LOCAL statement_timeout='10s'"],
    ["SELECT expire_booking_holds($1) AS count", [100]],
  ]);
});
it("caps the backlog at the configured number of separately committed batches", async () => {
  mocks.query.mockResolvedValue({ rows: [{ count: 2 }] });
  expect(await expireHolds(2, 3)).toEqual({
    expired: 6,
    batches: 3,
    limitReached: true,
  });
  expect(mocks.transaction).toHaveBeenCalledTimes(3);
});
it("propagates a failure without an outer unbounded retry and recovers on the next invocation", async () => {
  mocks.transaction.mockRejectedValueOnce({ code: "40001" });
  await expect(expireHolds()).rejects.toEqual({ code: "40001" });
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(await expireHolds()).toEqual({
    expired: 0,
    batches: 1,
    limitReached: false,
  });
});
it.each([
  [0, 1],
  [501, 1],
  [1, 0],
  [1, 21],
  [1.5, 1],
  [1, NaN],
])("rejects unsafe worker bounds %s / %s", async (size, batches) => {
  await expect(expireHolds(size, batches)).rejects.toThrow("limits");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it.each([
  ["2027-03-28T00:30:00Z", "01:30"],
  ["2027-03-28T01:30:00Z", "03:30"],
  ["2027-10-31T00:30:00Z", "02:30"],
  ["2027-10-31T02:30:00Z", "03:30"],
])("formats Stockholm deadline at DST %s", (instant, time) => {
  expect(formatDeadline(instant)).toContain(time);
});
