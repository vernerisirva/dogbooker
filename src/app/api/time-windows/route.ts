import { requireActor } from "@/lib/access";
import {
  getTimeWindows,
  updateTimeWindows,
  windowUpdateSchema,
} from "@/lib/time-window-service";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
export async function GET(request: Request) {
  return handle(async () => {
    await requireActor(request.headers);
    return json(await getTimeWindows());
  });
}
export async function PUT(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await requireActor(request.headers);
    return json(
      await updateTimeWindows(
        actor,
        windowUpdateSchema.parse(await readJson(request)),
      ),
    );
  });
}
