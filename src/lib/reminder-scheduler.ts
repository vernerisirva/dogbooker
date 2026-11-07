import { start, getRun } from "workflow/api";
import { timeReminderWorkflow } from "@/workflows/time-reminders";
import { transaction } from "./booking-service";
import { nextReminderWake, reminderEvents } from "./reminder-policy";

export async function ensureDailyReminderRuns() {
  const { day, wakeAt } = nextReminderWake();
  const runs = [];
  for (const event of reminderEvents) {
    runs.push(
      await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `reminder:${day}:${event}`,
        ]);
        const {
          rows: [existing],
        } = await c.query<{ run_id: string }>(
          "SELECT run_id FROM reminder_schedule_runs WHERE reminder_date=$1 AND event=$2",
          [day, event],
        );
        if (existing) {
          const run = getRun(existing.run_id);
          const status = await run.status;
          if (status !== "failed" && status !== "cancelled")
            return { event, day, wakeAt, runId: existing.run_id, status };
        }
        // A crash between start and commit can produce duplicate runs; database job uniqueness
        // and the fenced SMTP attempt marker still prevent duplicate emails.
        const run = await start(timeReminderWorkflow, [event, day, wakeAt]);
        await c.query(
          `INSERT INTO reminder_schedule_runs(reminder_date,event,wake_at,run_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(reminder_date,event) DO UPDATE SET run_id=EXCLUDED.run_id,wake_at=EXCLUDED.wake_at`,
          [day, event, wakeAt, run.runId],
        );
        return {
          event,
          day,
          wakeAt,
          runId: run.runId,
          status: await run.status,
        };
      }),
    );
  }
  return { runs };
}
