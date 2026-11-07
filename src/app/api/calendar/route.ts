import { requireActor } from "@/lib/access";
import { calendar } from "@/lib/booking-service";
import { handle, json } from "@/lib/http";
import { todayStockholm } from "@/lib/dates";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () =>
    json(
      await calendar(
        await requireActor(request.headers),
        new URL(request.url).searchParams.get("month") ??
          todayStockholm().slice(0, 7),
      ),
    ),
  );
}
