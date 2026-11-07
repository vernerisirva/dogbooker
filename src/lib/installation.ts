/** Zero means no configured account limit; paused accounts still count. */
export function ownerLimit() {
  const raw = process.env.MAX_OWNERS ?? "0";
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new Error("MAX_OWNERS must be a non-negative safe integer");
  return Number(raw);
}
