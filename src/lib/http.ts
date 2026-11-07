import { AppError } from "./errors";
import { ZodError } from "zod";
import { validationMessage } from "./validation-message";
export function assertOrigin(request: Request) {
  const expected = process.env.BETTER_AUTH_URL;
  if (!expected || request.headers.get("origin") !== new URL(expected).origin)
    throw new AppError("Åtgärden är inte tillåten.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Förfrågan har fel format. Försök igen.", 415);
}
export async function readJson(request: Request) {
  const raw = await request.text();
  if (raw.length > 16384) throw new AppError("Förfrågan är för stor.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Förfrågan är ogiltig.", 400);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function handle(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: validationMessage(error),
        },
        400,
      );
    // Never serialize database/auth errors or request bodies to the browser/logs.
    console.error("DogBooker request failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Något gick fel. Försök igen." }, 500);
  }
}
