import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";
const globalDb = globalThis as unknown as { dogbookerPool?: Pool };
export const pool =
  globalDb.dogbookerPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  });
if (process.env.VERCEL) attachDatabasePool(pool);
if (process.env.NODE_ENV !== "production") globalDb.dogbookerPool = pool;
export const db = drizzle(pool, { schema });
