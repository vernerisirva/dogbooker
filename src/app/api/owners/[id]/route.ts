import { requireActor } from "@/lib/access";
import { ownerSchema, updateOwner, reissueInvite } from "@/lib/invitations";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { z } from "zod";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, ctx: Context) {
  return handle(async () => {
    assertOrigin(request);
    return json(
      await updateOwner(
        await requireActor(request.headers),
        z.uuid().parse((await ctx.params).id),
        ownerSchema
          .extend({ isActive: z.boolean() })
          .parse(await readJson(request)),
      ),
    );
  });
}
export async function POST(request: Request, ctx: Context) {
  return handle(async () => {
    assertOrigin(request);
    return json(
      await reissueInvite(
        await requireActor(request.headers),
        z.uuid().parse((await ctx.params).id),
      ),
    );
  });
}
