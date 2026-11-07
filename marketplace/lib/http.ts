import { ZodError } from "zod";
import { auth, authPool } from "./auth";
import { MarketError } from "./service";
import { localOrigin } from "./config";
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function actor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new MarketError("Logga in för att fortsätta.", 401);
  const { rows } = await authPool.query(
    'SELECT "isActive" FROM "user" WHERE id=$1',
    [session.user.id],
  );
  if (!rows[0]?.isActive)
    throw new MarketError("Kontot är inte tillgängligt.", 403);
  return { id: session.user.id, name: session.user.name };
}
export async function body(request: Request) {
  if (request.headers.get("origin") !== localOrigin())
    throw new MarketError("Åtgärden är inte tillåten.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new MarketError("Ogiltigt format.", 415);
  const text = await request.text();
  if (text.length > 16384) throw new MarketError("Förfrågan är för stor.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new MarketError("Ogiltigt format.");
  }
}
export async function handle(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof MarketError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError)
      return json(
        {
          error:
            "Kontrollera uppgifterna. Välj 1–31 dagar inom ett år och fyll i alla obligatoriska fält.",
        },
        400,
      );
    const code =
      e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code === "P0002")
      return json({ error: "Uppgiften kunde inte hittas." }, 404);
    if (code === "42501")
      return json({ error: "Åtgärden är inte tillåten." }, 403);
    if (["P0001", "23P01", "23505", "40001", "40P01"].includes(code))
      return json(
        {
          error:
            "Uppgifterna har ändrats eller platserna är upptagna. Uppdatera och försök igen.",
        },
        409,
      );
    if (["22023", "23514", "23502", "22P02"].includes(code))
      return json(
        {
          error:
            "Uppgifterna passar inte hundvakten. Kontrollera datum, plats och hundarnas behov.",
        },
        400,
      );
    console.error("Marketplace request failed", {
      type: e instanceof Error ? e.name : "Unknown",
    });
    return json({ error: "Något gick fel. Försök igen." }, 500);
  }
}
