import { Pool } from "pg";
import { userInfo } from "node:os";
import { assertLocalPgEnvironment } from "../../src/lib/local-postgres";

export function localAdminConfig(database = "dogbooker_marketplace") {
  assertLocalPgEnvironment();
  if (
    !["postgres", "dogbooker_marketplace"].includes(database) &&
    !/^mp_(acceptance|migration|blockers)_[a-f0-9]{32}$/.test(database)
  )
    throw new Error("Only dedicated local marketplace databases are allowed.");
  return {
    host: "/tmp/dogbooker-marketplace-pg",
    port: 55438,
    user: userInfo().username,
    password: "local-socket-only", // The dedicated socket uses trust; never fall back to .pgpass.
    database,
    ssl: false as const,
    options: "-c search_path=public,pg_catalog",
    connectionTimeoutMillis: 10000,
  };
}
export function adminPool(database = "dogbooker_marketplace") {
  return new Pool({ ...localAdminConfig(database), max: 8 });
}
