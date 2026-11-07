import { timingSafeEqual } from "node:crypto";
import { start, getRun } from "workflow/api";
import { z } from "zod";
import { requireActor, requireAdmin } from "@/lib/access";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { ensureDailyReminderRuns } from "@/lib/reminder-scheduler";
import { reminderHealthWorkflow } from "@/workflows/time-reminders";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      !secret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new AppError("Åtgärden är inte tillåten.", 401);
    return json(await ensureDailyReminderRuns());
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    requireAdmin(await requireActor(request.headers));
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("schedule") }).strict(),
        z.object({ action: z.literal("health") }).strict(),
        z
          .object({
            action: z.literal("status"),
            runId: z.string().min(1).max(200),
          })
          .strict(),
      ])
      .parse(await readJson(request));
    if (input.action === "schedule")
      return json(await ensureDailyReminderRuns());
    if (input.action === "health") {
      const run = await start(reminderHealthWorkflow, []);
      return json({ runId: run.runId });
    }
    const run = getRun(input.runId),
      status = await run.status;
    return json({
      status,
      ...(status === "completed" ? { result: await run.returnValue } : {}),
    });
  });
}
