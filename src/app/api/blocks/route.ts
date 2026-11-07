import { requireActor } from "@/lib/access";
import {
  bookingSchema,
  rangeSchema,
  createBlock,
  unblockDates,
} from "@/lib/booking-service";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    return json(
      await createBlock(
        await requireActor(request.headers),
        bookingSchema.parse(await readJson(request)),
      ),
      201,
    );
  });
}
export async function DELETE(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    return json(
      await unblockDates(
        await requireActor(request.headers),
        rangeSchema.parse(await readJson(request)),
      ),
    );
  });
}
