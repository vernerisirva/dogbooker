import { z } from "zod";
import type { PoolClient } from "pg";
import { requireAdmin, type Actor } from "./access";
import { transaction } from "./booking-service";
import { arrivalTimeSchema } from "./arrival-validation";
import {
  applicableWindow,
  timeWithinWindow,
  type TimeWindows,
  type WindowSettings,
} from "./time-windows";
import { AppError } from "./errors";
import { isDate, formatDate } from "./dates";
const time = arrivalTimeSchema.unwrap();
export const windowsSchema = z
  .object({
    arrivalStart: time,
    arrivalEnd: time,
    pickupStart: time,
    pickupEnd: time,
  })
  .strict()
  .refine(
    (w) => w.arrivalStart <= w.arrivalEnd && w.pickupStart <= w.pickupEnd,
    "Fönstrets sluttid måste vara samma som eller senare än starttiden.",
  );
export const windowUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().max(2147483646),
    date: z.string().refine(isDate).optional(),
    windows: windowsSchema.nullable(),
  })
  .strict()
  .refine((v) => v.date || v.windows, "Standardtiderna kan inte tas bort.");
const cols = `left(arrival_start::text,5) AS "arrivalStart",left(arrival_end::text,5) AS "arrivalEnd",left(pickup_start::text,5) AS "pickupStart",left(pickup_end::text,5) AS "pickupEnd"`;
export async function getTimeWindows(
  client?: PoolClient,
): Promise<WindowSettings> {
  if (!client) return transaction((c) => getTimeWindows(c));
  const c = client;
  // All writers lock the singleton first; readers in a booking transaction hold
  // a share lock through validation/commit, serializing concurrent window edits.
  const {
    rows: [settings],
  } = await c.query<TimeWindows & { revision: number }>(
    `SELECT revision,${cols} FROM time_window_settings WHERE id=true${client ? " FOR SHARE" : ""}`,
  );
  const { rows: overrides } = await c.query<TimeWindows & { date: string }>(
    `SELECT date::text,${cols} FROM time_window_overrides ORDER BY date`,
  );
  const { revision, ...defaults } = settings;
  return { revision, defaults, overrides };
}
export async function updateTimeWindows(
  actor: Actor,
  input: z.infer<typeof windowUpdateSchema>,
) {
  requireAdmin(actor);
  const data = windowUpdateSchema.parse(input);
  return transaction(async (c) => {
    const {
      rows: [row],
    } = await c.query(
      "SELECT revision FROM time_window_settings WHERE id=true FOR UPDATE",
    );
    if (row.revision !== data.expectedRevision)
      throw new AppError(
        "Tidsfönstren har ändrats. Uppdatera och försök igen.",
        409,
      );
    const values = data.windows
      ? [
          data.windows.arrivalStart,
          data.windows.arrivalEnd,
          data.windows.pickupStart,
          data.windows.pickupEnd,
        ]
      : [];
    if (data.date) {
      if (data.windows)
        await c.query(
          `INSERT INTO time_window_overrides(date,arrival_start,arrival_end,pickup_start,pickup_end) VALUES($5,$1::time,$2::time,$3::time,$4::time)
    ON CONFLICT(date) DO UPDATE SET arrival_start=EXCLUDED.arrival_start,arrival_end=EXCLUDED.arrival_end,pickup_start=EXCLUDED.pickup_start,pickup_end=EXCLUDED.pickup_end`,
          [...values, data.date],
        );
      else
        await c.query("DELETE FROM time_window_overrides WHERE date=$1", [
          data.date,
        ]);
      await c.query(
        "UPDATE time_window_settings SET revision=revision+1 WHERE id=true",
      );
    } else
      await c.query(
        "UPDATE time_window_settings SET arrival_start=$1::time,arrival_end=$2::time,pickup_start=$3::time,pickup_end=$4::time,revision=revision+1 WHERE id=true",
        values,
      );
    return getTimeWindows(c);
  });
}
export async function assertOwnerWindows(
  c: PoolClient,
  start: string,
  end: string,
  arrival: string | null,
  pickup: string | null,
  checkArrival = true,
  checkPickup = true,
) {
  const settings = await getTimeWindows(c);
  for (const [check, date, kind, time, label] of [
    [checkArrival, start, "arrival", arrival, "Lämning"],
    [checkPickup, end, "pickup", pickup, "Hämtning"],
  ] as const) {
    const window = applicableWindow(settings, date, kind);
    if (check && !timeWithinWindow(time, window))
      throw new AppError(
        `${label} den ${formatDate(date)} måste vara mellan ${window.start} och ${window.end}, i steg om 15 minuter.`,
      );
  }
}
