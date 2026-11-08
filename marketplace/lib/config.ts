import { localPostgresUrl } from "../../src/lib/local-postgres";
export type RuntimeRole = "marketplace_app" | "marketplace_auth";
export function localDatabase(value: string | undefined, role: RuntimeRole) {
  const config = localPostgresUrl(value);
  if (
    !["marketplace_app", "marketplace_auth"].includes(role) ||
    config.host !== "127.0.0.1" ||
    config.port !== 55438 ||
    config.database !== "dogbooker_marketplace" ||
    config.user !== role
  )
    throw new Error(
      "This prototype requires its dedicated loopback database and restricted role.",
    );
  return config;
}
export function localOrigin() {
  const value = process.env.MARKETPLACE_ORIGIN ?? "http://127.0.0.1:3100";
  if (value !== "http://127.0.0.1:3100")
    throw new Error("The marketplace demo is local-only.");
  return value;
}
