import { pool } from "../lib/db";
import { expireHolds } from "../lib/expiration-worker";

// One-shot process: invoke each minute through cron/systemd; no user session needed.
const started = Date.now();
try {
  console.log(
    JSON.stringify({
      event: "booking_holds_expiration",
      status: "ok",
      ...(await expireHolds()),
      durationMs: Date.now() - started,
    }),
  );
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "unknown";
  // Only allow SQLSTATEs; database error messages can contain private row values.
  console.error(
    JSON.stringify({
      event: "booking_holds_expiration",
      status: "failed",
      code: /^[A-Z0-9]{5}$/.test(code) ? code : "unknown",
      durationMs: Date.now() - started,
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
