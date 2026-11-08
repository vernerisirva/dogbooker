import { localPostgresUrl } from "./local-postgres";

// Applied only to synthetic test mode; ordinary self-hosted installations keep their configuration.
export function testDatabaseConfig(
  migrationUrl = process.env.DATABASE_URL_UNPOOLED,
) {
  if (
    process.env.ALLOW_TEST_DATABASE !== "true" ||
    process.env.GMAIL_APP_PASSWORD?.trim()
  )
    throw new Error(
      "Tests require explicit synthetic database mode and no outbound mail credentials.",
    );
  const config = localPostgresUrl(process.env.DATABASE_URL);
  const direct = localPostgresUrl(migrationUrl);
  if (
    config.host !== process.env.TEST_DATABASE_HOST ||
    !/^(dogbooker|dogbooker_standalone|[a-z][a-z0-9_]*_test)$/.test(
      config.database,
    ) ||
    ["host", "port", "database", "user", "password"].some(
      (key) =>
        config[key as keyof typeof config] !==
        direct[key as keyof typeof direct],
    )
  )
    throw new Error(
      "Tests require matching local runtime/migration identities and a dedicated test database.",
    );
  return config;
}
