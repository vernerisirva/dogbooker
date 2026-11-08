import { Pool, type ClientBase } from "pg";
import { localDatabase, type RuntimeRole } from "./config";

export async function verifyRuntimeConnection(
  c: ClientBase,
  role: RuntimeRole,
) {
  const { rows } = await c.query(`
    SELECT current_database() AS db, current_user AS role, session_user AS login,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      OR EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid)
      OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=r.oid)
      OR has_schema_privilege(current_user,'public','CREATE') AS privileged
    FROM pg_roles r WHERE rolname=current_user`);
  const s = rows[0];
  if (
    !s ||
    s.db !== "dogbooker_marketplace" ||
    s.role !== role ||
    s.login !== role ||
    s.host !== "127.0.0.1" ||
    s.port !== 55438 ||
    s.privileged !== false
  )
    throw new Error(
      "Marketplace database identity or runtime privileges are not permitted.",
    );
}

export function runtimePool(role: RuntimeRole, max: number) {
  const value =
    role === "marketplace_app"
      ? process.env.MARKETPLACE_DATABASE_URL
      : process.env.MARKETPLACE_AUTH_DATABASE_URL;
  return new Pool({
    ...localDatabase(value, role),
    max,
    // pg-pool awaits this hook before lending the connection to auth or domain code.
    onConnect: (client) => verifyRuntimeConnection(client, role),
  });
}
