import { auth } from "./auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "./errors";
export type Actor = {
  id: string;
  role: "admin" | "owner";
  name: string;
  email: string;
  dogName: string | null;
};
export async function requireActor(headers: Headers): Promise<Actor> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new AppError("Logga in för att fortsätta.", 401);
  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      name: users.name,
      email: users.email,
      dogName: users.dogName,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, session.user.id));
  if (!user?.isActive || !["admin", "owner"].includes(user.role))
    throw new AppError("Kontot är inte tillgängligt.", 403);
  return { ...user, role: user.role as Actor["role"] };
}
export function requireAdmin(actor: Actor) {
  if (actor.role !== "admin")
    throw new AppError(
      "Du behöver vara administratör för att göra detta.",
      403,
    );
}
