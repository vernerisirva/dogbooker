import { expect, it } from "vitest";
import { Client } from "pg";
import { localDatabase } from "../lib/config";

it.each(["host=remote.invalid", "port=5432", "user=unexpected_admin"])(
  "rejects connection-string overrides that escape the dedicated database: %s",
  (query) => {
    const value = `postgresql://marketplace_app:synthetic@127.0.0.1:55438/dogbooker_marketplace?${query}`;
    // Constructing a client parses options; it performs no network connection.
    const effective = new Client({ connectionString: value });
    const [key, valueOverride] = query.split("=");
    expect(effective).toMatchObject({
      [key]: key === "port" ? Number(valueOverride) : valueOverride,
    });
    expect(() => localDatabase(value, "marketplace_app")).toThrow();
  },
);
