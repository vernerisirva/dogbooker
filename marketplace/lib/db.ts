import type { PoolClient } from "pg";
import { runtimePool } from "./connection";
export const pool = runtimePool("marketplace_app", 12);
export async function transaction<T>(
  actorId: string,
  work: (c: PoolClient) => Promise<T>,
) {
  // Callbacks contain only transactional database work; external effects belong after commit.
  for (let attempt = 0; ; attempt++) {
    const c = await pool.connect();
    let discard = false;
    try {
      await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await c.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        discard = true;
      }
      const code =
        e && typeof e === "object" && "code" in e ? e.code : undefined;
      // These SQLSTATEs prove transaction abort. Never retry an uncertain connection/commit failure.
      if (discard || attempt >= 2 || !["40001", "40P01"].includes(String(code)))
        throw e;
    } finally {
      c.release(discard);
    }
  }
}
