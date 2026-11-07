import { dispatchNotifications } from "@/lib/dispatch-notifications";
import { requireActor } from "@/lib/access";
import { bookingSchema, createBooking } from "@/lib/booking-service";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await requireActor(request.headers);
    const result = await createBooking(
      actor,
      bookingSchema.parse(await readJson(request)),
    );
    dispatchNotifications();
    return json(result, 201);
  });
}
