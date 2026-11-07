import { pool } from "../src/db";
import { todayStockholm } from "../src/lib/dates";
import { reminderEvents } from "../src/lib/reminder-policy";
import { enqueueDueReminders } from "../src/lib/reminder-service";
import { deliverNotifications } from "../src/lib/notifications";
/** Run once per minute via your process scheduler; the database fences competing workers. */
async function main() {
  const day = todayStockholm();
  for (const event of reminderEvents) await enqueueDueReminders(event, day);
  console.log(await deliverNotifications());
}
main()
  .catch(() => {
    console.error(
      "Notification worker failed; inspect pending jobs without logging payloads.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
