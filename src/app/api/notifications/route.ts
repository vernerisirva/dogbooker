import { timingSafeEqual } from "node:crypto";
import { requireActor, requireAdmin } from "@/lib/access";
import { assertOrigin, handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { deliverNotifications } from "@/lib/notifications";
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
    return json(await deliverNotifications());
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    requireAdmin(await requireActor(request.headers));
    return json(await deliverNotifications());
  });
}
