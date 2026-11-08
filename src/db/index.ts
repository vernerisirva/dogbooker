import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";
import { testDatabaseConfig } from "../lib/test-database-config";
const config =
  process.env.ALLOW_TEST_DATABASE === "true"
    ? testDatabaseConfig()
    : { connectionString: process.env.DATABASE_URL };
const globalDb = globalThis as unknown as { dogbookerPool?: Pool };
export const pool =
  globalDb.dogbookerPool ??
  new Pool({
    ...config,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  });
if (process.env.VERCEL) attachDatabasePool(pool);
if (process.env.NODE_ENV !== "production") globalDb.dogbookerPool = pool;
export const db = drizzle(pool, { schema });
