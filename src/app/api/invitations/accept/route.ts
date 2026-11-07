import { acceptInvitation, acceptSchema } from "@/lib/invitations";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { limitInvitation } from "@/lib/rate-limit";
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    await limitInvitation(request);
    return json(
      await acceptInvitation(acceptSchema.parse(await readJson(request))),
    );
  });
}
