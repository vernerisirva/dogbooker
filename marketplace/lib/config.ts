export function localDatabase(value: string | undefined, role?: string) {
  if (!value)
    throw new Error("Marketplace local database configuration is missing.");
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55438" ||
    u.pathname !== "/dogbooker_marketplace" ||
    (role && u.username !== role)
  )
    throw new Error(
      "This prototype requires its dedicated loopback database and restricted role.",
    );
  return value;
}
export function localOrigin() {
  const value = process.env.MARKETPLACE_ORIGIN ?? "http://127.0.0.1:3100";
  if (value !== "http://127.0.0.1:3100")
    throw new Error("The marketplace demo is local-only.");
  return value;
}
