import { it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  runs: new Map<string, string>(),
  starts: 0,
}));
vi.mock("workflow/api", () => ({
  start: vi.fn(async () => ({
    runId: `run-${++state.starts}`,
    status: Promise.resolve("running"),
  })),
  getRun: vi.fn(() => ({ status: Promise.resolve("running") })),
}));
vi.mock("@/workflows/time-reminders", () => ({
  timeReminderWorkflow: vi.fn(),
}));
vi.mock("@/lib/booking-service", () => ({
  transaction: async (work: (c: unknown) => unknown) =>
    work({
      query: async (sql: string, args: unknown[]) => {
        if (sql.startsWith("SELECT run_id")) {
          const value = state.runs.get(`${args[0]}:${args[1]}`);
          return { rows: value ? [{ run_id: value }] : [] };
        }
        if (sql.startsWith("INSERT INTO reminder_schedule_runs"))
          state.runs.set(`${args[0]}:${args[1]}`, String(args[3]));
        return { rows: [] };
      },
    }),
}));
import { ensureDailyReminderRuns } from "@/lib/reminder-scheduler";
beforeEach(() => {
  state.runs.clear();
  state.starts = 0;
});
it("persists separate durable runs and reuses them on repeated cron calls", async () => {
  const first = await ensureDailyReminderRuns(),
    second = await ensureDailyReminderRuns();
  expect(first.runs.map((r) => r.event)).toEqual([
    "dropoff_reminder",
    "pickup_reminder",
  ]);
  expect(first.runs[0].runId).not.toBe(first.runs[1].runId);
  expect(first.runs[0].wakeAt).toBe(first.runs[1].wakeAt);
  expect(second).toEqual(first);
  expect(state.starts).toBe(2);
});
