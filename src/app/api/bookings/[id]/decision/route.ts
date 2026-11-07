import { z } from "zod";
import { requireActor } from "@/lib/access";
import { decideBooking } from "@/lib/booking-service";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { dispatchNotifications } from "@/lib/dispatch-notifications";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await requireActor(request.headers);
    const { decision, expectedRevision } = z
      .object({
        decision: z.enum(["confirmed", "declined"]),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await readJson(request));
    const result = await decideBooking(
      actor,
      z.uuid().parse((await ctx.params).id),
      decision,
      expectedRevision,
    );
    dispatchNotifications();
    return json(result);
  });
}
