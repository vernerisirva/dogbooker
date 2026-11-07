import { requireActor } from "@/lib/access";
import { inviteOwner, ownerSchema } from "@/lib/invitations";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    assertOrigin(request);
    return json(
      await inviteOwner(
        await requireActor(request.headers),
        ownerSchema.parse(await readJson(request)),
      ),
      201,
    );
  });
}
