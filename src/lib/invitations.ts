import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { type Actor, requireAdmin } from "./access";
import { AppError } from "./errors";
import { transaction } from "./booking-service";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ownerLimit } from "./installation";
export const ownerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().trim().toLowerCase().max(254),
  dogName: z.string().trim().min(1).max(80),
});
export const acceptSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Inbjudan är ogiltig."),
  password: z.string().min(12, "Använd minst 12 tecken.").max(128),
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function issue(c: PoolClient, userId: string) {
  const token = randomBytes(32).toString("hex");
  await c.query(
    "UPDATE invitations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
    [userId],
  );
  await c.query(
    "INSERT INTO invitations(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '48 hours')",
    [userId, digest(token)],
  );
  // Fragment avoids tokens entering request URLs, access logs, and referrers.
  return { url: `${process.env.BETTER_AUTH_URL}/invite#${token}` };
}
export async function inviteOwner(
  actor: Actor,
  input: z.infer<typeof ownerSchema>,
) {
  requireAdmin(actor);
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(731043)");
    const count = await c.query(
      "SELECT count(*)::int AS n FROM users WHERE role='owner'",
    );
    const limit = ownerLimit();
    if (limit > 0 && count.rows[0].n >= limit)
      throw new AppError(
        "Gränsen för antal hundägare är nådd. Kontakta administratören.",
      );
    const u = await c.query(
      "INSERT INTO users(name,email,dog_name,role) VALUES($1,$2,$3,'owner') RETURNING id",
      [input.name, input.email, input.dogName],
    );
    return issue(c, u.rows[0].id);
  });
}
export async function updateOwner(
  actor: Actor,
  id: string,
  input: z.infer<typeof ownerSchema> & { isActive: boolean },
) {
  requireAdmin(actor);
  return transaction(async (c) => {
    const {
      rows: [old],
    } = await c.query(
      "SELECT email FROM users WHERE id=$1 AND role='owner' FOR UPDATE",
      [id],
    );
    if (!old) throw new AppError("Hundägaren kunde inte hittas.", 404);
    await c.query(
      "UPDATE users SET name=$2,email=$3,dog_name=$4,is_active=$5,updated_at=now() WHERE id=$1",
      [id, input.name, input.email, input.dogName, input.isActive],
    );
    if (!input.isActive || old.email !== input.email) {
      await c.query("DELETE FROM auth_sessions WHERE user_id=$1", [id]);
      await c.query(
        "UPDATE invitations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [id],
      );
    }
    if (old.email !== input.email) {
      await c.query(
        "DELETE FROM auth_accounts WHERE user_id=$1 AND provider_id='credential'",
        [id],
      );
      await c.query("UPDATE users SET email_verified=false WHERE id=$1", [id]);
      if (input.isActive) return issue(c, id);
    }
    return { id };
  });
}
export async function reissueInvite(actor: Actor, id: string) {
  requireAdmin(actor);
  return transaction(async (c) => {
    const result = await c.query(
      "SELECT id FROM users WHERE id=$1 AND role='owner' AND is_active=true FOR UPDATE",
      [id],
    );
    if (!result.rowCount)
      throw new AppError("Ingen aktiv hundägare hittades.", 404);
    return issue(c, id);
  });
}
export async function acceptInvitation(input: z.infer<typeof acceptSchema>) {
  const password = await hashPassword(input.password);
  return transaction(async (c) => {
    const {
      rows: [invite],
    } = await c.query(
      "SELECT i.id,i.user_id FROM invitations i JOIN users u ON u.id=i.user_id WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() AND u.is_active=true FOR UPDATE OF i,u",
      [digest(input.token)],
    );
    if (!invite)
      throw new AppError(
        "Inbjudan har gått ut eller redan använts. Be din hundvakt om en ny länk.",
        400,
      );
    await c.query(
      "INSERT INTO auth_accounts(account_id,provider_id,user_id,password) VALUES($1::text,'credential',$1::uuid,$2) ON CONFLICT(provider_id,account_id) DO UPDATE SET password=$2,updated_at=now()",
      [invite.user_id, password],
    );
    await c.query(
      "UPDATE invitations SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [invite.user_id],
    );
    await c.query(
      "UPDATE users SET email_verified=true,updated_at=now() WHERE id=$1",
      [invite.user_id],
    );
    await c.query("DELETE FROM auth_sessions WHERE user_id=$1", [
      invite.user_id,
    ]);
    return { ok: true };
  });
}
export async function bootstrapAdmin(name: string, email: string) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(731043)");
    const existing = await c.query("SELECT id FROM users WHERE role='admin'");
    if (existing.rowCount)
      throw new AppError(
        "Det finns redan en administratör. Använd återställningsskriptet för att skapa en ny länk.",
      );
    const {
      rows: [u],
    } = await c.query(
      "INSERT INTO users(name,email,role) VALUES($1,$2,'admin') RETURNING id",
      [name, email.toLowerCase()],
    );
    return issue(c, u.id);
  });
}
export async function recoverAdmin(email: string) {
  return transaction(async (c) => {
    const {
      rows: [u],
    } = await c.query(
      "SELECT id FROM users WHERE role='admin' AND email=$1 AND is_active=true FOR UPDATE",
      [email.toLowerCase()],
    );
    if (!u) throw new AppError("Administratören kunde inte hittas.");
    return issue(c, u.id);
  });
}
