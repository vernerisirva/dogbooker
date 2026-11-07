import { dispatchNotifications } from "@/lib/dispatch-notifications";
import { requireActor } from "@/lib/access";
import {
  bookingEditSchema,
  cancelBooking,
  modifyBooking,
} from "@/lib/booking-service";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { z } from "zod";
type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, ctx: Context) {
  return handle(async () => {
    assertOrigin(request);
    const result = await cancelBooking(
      await requireActor(request.headers),
      z.uuid().parse((await ctx.params).id),
    );
    dispatchNotifications();
    return json(result);
  });
}
export async function PATCH(request: Request, ctx: Context) {
  return handle(async () => {
    assertOrigin(request);
    return json(
      await modifyBooking(
        await requireActor(request.headers),
        z.uuid().parse((await ctx.params).id),
        bookingEditSchema.parse(await readJson(request)),
      ),
    );
  });
}
