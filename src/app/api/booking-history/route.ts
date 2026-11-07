import { requireActor } from "@/lib/access";
import { bookingHistory } from "@/lib/booking-service";
import { handle, json } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () =>
    json(
      await bookingHistory(
        await requireActor(request.headers),
        Number(new URL(request.url).searchParams.get("offset") ?? 0),
      ),
    ),
  );
}
