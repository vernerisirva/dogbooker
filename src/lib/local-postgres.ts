// Local tools must never inherit libpq targets, startup options, credentials or native mode.
export function assertLocalPgEnvironment() {
  if (
    Object.entries(process.env).some(
      ([key, value]) =>
        value && (key.startsWith("PG") || key === "NODE_PG_FORCE_NATIVE"),
    )
  )
    throw new Error(
      "Local database tools do not accept PG* or NODE_PG_FORCE_NATIVE environment overrides.",
    );
}

export function localPostgresUrl(value: string | undefined) {
  assertLocalPgEnvironment();
  try {
    if (!value || /[\s?#]/.test(value)) throw new Error();
    const u = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
      !u.port ||
      !Number.isInteger(Number(u.port)) ||
      Number(u.port) < 1 ||
      Number(u.port) > 65535 ||
      !u.username ||
      !u.password ||
      !/^\/[a-z][a-z0-9_]*$/.test(u.pathname)
    )
      throw new Error();
    return {
      host: u.hostname === "[::1]" ? "::1" : u.hostname,
      port: Number(u.port),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
      ssl: false as const,
      options: "-c search_path=public,pg_catalog",
      connectionTimeoutMillis: 10000,
    };
  } catch {
    // URL/driver parse errors can include the original credential-bearing input.
    throw new Error(
      "A complete local PostgreSQL URL without query parameters or fragments is required.",
    );
  }
}
