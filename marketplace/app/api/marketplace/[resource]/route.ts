import { actor, body, handle, json } from "../../../../lib/http";
import {
  dashboard,
  saveDog,
  saveSitter,
  setAvailability,
  search,
  requestBooking,
  decideBooking,
} from "../../../../lib/service";
type Context = { params: Promise<{ resource: string }> };
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const user = await actor(request);
    const { resource } = await params;
    if (resource !== "me") return json({ error: "Sidan finns inte." }, 404);
    return json({
      user,
      ...(await dashboard(
        user.id,
        new URL(request.url).searchParams.get("id") ?? undefined,
      )),
    });
  });
}
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const input = await body(request);
    const user = await actor(request);
    const { resource } = await params;
    switch (resource) {
      case "dogs":
        return json(await saveDog(user.id, input));
      case "sitter":
        return json(await saveSitter(user.id, input));
      case "availability":
        return json(await setAvailability(user.id, input));
      case "search":
        return json(await search(user.id, input));
      case "bookings":
        return json(await requestBooking(user.id, input));
      case "decisions":
        return json(await decideBooking(user.id, input));
      default:
        return json({ error: "Sidan finns inte." }, 404);
    }
  });
}
