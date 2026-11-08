import { transaction } from "./db";

export async function expireHolds(batchSize = 100, maxBatches = 10) {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    !Number.isInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > 20
  )
    throw new Error("Invalid expiration limits.");
  let expired = 0;
  let batches = 0;
  for (; batches < maxBatches; batches++) {
    const count = await transaction("", async (c) => {
      await c.query("SET LOCAL lock_timeout='2s'");
      await c.query("SET LOCAL statement_timeout='10s'");
      return (
        await c.query<{ count: number }>(
          "SELECT expire_booking_holds($1) AS count",
          [batchSize],
        )
      ).rows[0].count;
    });
    expired += count;
    if (count < batchSize)
      return { expired, batches: batches + 1, limitReached: false };
  }
  return { expired, batches, limitReached: true };
}
