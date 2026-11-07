import { requireActor } from "@/lib/access";
import { changeBookingTimes } from "@/lib/arrival-service";
import { bookingTimesChangeSchema } from "@/lib/arrival-validation";
import { dispatchNotifications } from "@/lib/dispatch-notifications";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { z } from "zod";
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await requireActor(request.headers);
    const result = await changeBookingTimes(
      actor,
      z.uuid().parse((await ctx.params).id),
      bookingTimesChangeSchema.parse(await readJson(request)),
    );
    dispatchNotifications();
    return json(result);
  });
}
