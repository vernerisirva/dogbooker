import { sleep } from "workflow";
import type { ReminderEvent } from "@/lib/reminder-policy";
import { enqueueDueReminders } from "@/lib/reminder-service";
import { deliverNotifications } from "@/lib/notifications";
import { pool } from "@/db";

async function enqueue(event: ReminderEvent, day: string) {
  "use step";
  return enqueueDueReminders(event, day);
}
async function deliver(event: ReminderEvent, day: string) {
  "use step";
  const result = await deliverNotifications({ reminderEvent: event });
  if (!result.configured)
    throw new Error("Gmail reminder delivery is not configured");
  const {
    rows: [row],
  } = await pool.query<{ next: Date | null }>(
    `SELECT min(GREATEST(COALESCE(locked_until,available_at),clock_timestamp()+interval '2 seconds')) AS next
     FROM notification_jobs WHERE event=$1 AND payload->>'reminderDate'=$2 AND state IN ('pending','sending')`,
    [event, day],
  );
  return row.next?.toISOString() ?? null;
}
/** Separate durable run for each type. No owner information is stored in workflow inputs. */
export async function timeReminderWorkflow(
  event: ReminderEvent,
  day: string,
  wakeAt: string,
) {
  "use workflow";
  await sleep(new Date(wakeAt));
  const queued = await enqueue(event, day);
  // Bounded retries; SMTP uncertainty remains held for manual review by the outbox.
  for (let attempt = 0; attempt < 20; attempt++) {
    const next = await deliver(event, day);
    if (!next) return queued;
    await sleep(new Date(next));
  }
  throw new Error("Reminder retry budget exhausted; inspect notification jobs");
}
async function checkDatabase() {
  "use step";
  await pool.query("SELECT 1");
  return { healthy: true, completedAt: new Date().toISOString() };
}
/** Administrator-only deployment probe; sends no mail and changes no booking. */
export async function reminderHealthWorkflow() {
  "use workflow";
  await sleep("5s");
  return checkDatabase();
}
