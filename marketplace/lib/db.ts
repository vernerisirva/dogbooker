import { Pool, type PoolClient } from "pg";
import { localDatabase } from "./config";
export const pool = new Pool({
  connectionString: localDatabase(
    process.env.MARKETPLACE_DATABASE_URL,
    "marketplace_app",
  ),
  max: 12,
});
export async function transaction<T>(
  actorId: string,
  work: (c: PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
