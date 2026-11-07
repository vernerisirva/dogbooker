import { sv } from "./swedish";
import { pool } from "@/db";
import { createHash } from "node:crypto";
import { AppError } from "./errors";
export async function limitInvitation(request: Request) {
  const ip = request.headers.get("x-real-ip") ?? "local";
  const minute = Math.floor(Date.now() / 60000);
  const key = "invite:" + createHash("sha256").update(ip).digest("hex");
  const {
    rows: [row],
  } = await pool.query(
    `INSERT INTO auth_rate_limits(key,count,last_request) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_rate_limits.last_request=$2 THEN auth_rate_limits.count+1 ELSE 1 END,last_request=$2 RETURNING count`,
    [key, minute],
  );
  if (row.count > 10) throw new AppError(sv.errors.rateLimit, 429);
}
