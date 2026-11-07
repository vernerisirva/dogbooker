import { requireActor } from "@/lib/access";
import {
  decideTimeProposal,
  proposalActionSchema,
} from "@/lib/arrival-service";
import { dispatchNotifications } from "@/lib/dispatch-notifications";
import { assertOrigin, handle, json, readJson } from "@/lib/http";
import { z } from "zod";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    assertOrigin(request);
    const actor = await requireActor(request.headers);
    const result = await decideTimeProposal(
      actor,
      z.uuid().parse((await ctx.params).id),
      proposalActionSchema.parse(await readJson(request)),
    );
    dispatchNotifications();
    return json(result);
  });
}
