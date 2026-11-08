# DogBooker Marketplace — local prototype

A separate Swedish boarding marketplace app. Owners register synthetic accounts, manage several dogs, compare explained matches and request a stay. Sitters maintain profiles and open dates, then approve, decline or cancel requests in their private agenda. Pending requests reserve capacity immediately. No payments or email are sent.

This app is based on the public MIT release and shares its locked dependencies and a few pure helpers. It does not use the standalone app's database, cookies or database URLs. Do not deploy this prototype or point it at an existing database. Runtime configuration intentionally accepts only `127.0.0.1:55438/dogbooker_marketplace` and the dedicated restricted roles.

## Install

Requirements: Node.js 22+, PostgreSQL 16+ with `btree_gist`, and npm. Run `npm ci` at the **repository root**. There is one dependency lockfile; the nested package only provides app commands.

Start a new, disposable local cluster as your normal OS user (not root). PostgreSQL binaries must be on PATH. macOS `/tmp` resolves to `/private/tmp`; the same commands work on Linux. If the directory already contains the existing demo cluster, skip `initdb` and just start it.

```sh
mkdir -p /tmp/dogbooker-marketplace-pg
initdb -D /tmp/dogbooker-marketplace-pg/data --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --no-locale
pg_ctl -D /tmp/dogbooker-marketplace-pg/data -l /tmp/dogbooker-marketplace-pg/server.log -o '-h 127.0.0.1 -p 55438 -k /tmp/dogbooker-marketplace-pg' start
cd marketplace
npm run db:setup
npm run db:migrate
npm run db:seed
npm run dev
```

Open [the local marketplace](http://127.0.0.1:3100). Use exactly this origin, not `localhost`. Generated credentials are in `.env.local` (mode 0600). Setup refuses to replace existing credentials or a database. Migration and seed tools use only the fixed local Unix socket. Seed refuses any existing accounts and never resets data.

Database URLs must use `postgres://` or `postgresql://`, include credentials, and contain no query parameters, fragments or raw whitespace. Percent-encoded credentials are supported. `MARKETPLACE_DATABASE_URL` must name `marketplace_app`; `MARKETPLACE_AUTH_DATABASE_URL` must name `marketplace_auth`. The effective server identity and restricted role privileges are checked before application queries. Generic database URLs are ignored. Run local commands without nonempty `PG*` or `NODE_PG_FORCE_NATIVE` environment variables, including `PGOPTIONS` and `PGPASSFILE`; these overrides fail closed. Local production builds (`NODE_ENV=production`) and CI use the same restrictions.

For an existing demo, run `npm run db:migrate` before restarting the app. Migration 0006 is additive and preserves profile, availability, booking and care data; do not edit previously applied migration files.

Demo logins and one randomly generated password are saved in `.local/demo-accounts.json` (mode 0600):

| Account             | Demo purpose                                        |
| ------------------- | --------------------------------------------------- |
| `alva@example.test` | Owner of Smulan and Atlas; Atlas needs medication   |
| `bo@example.test`   | Owner of Vilda, who needs a home without other dogs |
| `maja@example.test` | Maja's three-dog home, medication/puppy/senior care |
| `erik@example.test` | Erik's two-dog home with resident dogs              |
| `liv@example.test`  | Liv's two-dog home with medication/senior care      |

Availability covers today and the next 90 days. Search with Stockholm's prefilled coarse coordinates. Select Smulan and Atlas to compare Maja and Liv. Send a request, sign in as the selected sitter in another browser profile, then approve or decline. Sign in as Erik to verify the booking is absent. Owners can cancel; search reflects released inventory. For long-lived demos, open new dates from the sitter's profile.

You can register more accounts using `@example.test`. Supply only synthetic names and notes. No address, real contact details, identity documents or payment information should be entered. The login is intentionally not a public-registration production design.

## Verify

From `marketplace/`, after migration and seeding:

```sh
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run benchmark
npm run build
npm run test:e2e
```

Browser tests use installed Chrome locally and Playwright Chromium in CI. `npx playwright install chromium` from the root installs the CI browser. They validate local configuration and always start their own server; port 3100 must be free. Database tests create synthetic fixtures in the dedicated database; migration/concurrency tests create and remove randomly named local databases. Do not run suites concurrently with manual demo sessions. The GitHub marketplace workflow reproduces setup/checks without deployment; it still needs its first hosted CI run. [Blocker fixes and exact verification evidence](../MARKETPLACE_BLOCKER_RESOLUTION.md) cover connection attacks, mixed-isolation races and bounded transaction retries.

For the original app's browser suite use `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` at the root when using installed Chrome. Its tests require an independently prepared standalone test database and its own `.env.local`; never reuse private configuration. See the root installation instructions.

To stop the demo database after closing app/test processes:

```sh
pg_ctl -D /tmp/dogbooker-marketplace-pg/data stop
```

Keep the cluster for later use. The `/tmp` location may be removed by OS housekeeping; regenerate the synthetic demo if that happens. Do not copy `.env.local`, `.local` or database files into release artifacts.

See [architecture](../MARKETPLACE_ARCHITECTURE.md), [matching](../MATCHING_ENGINE.md), [roadmap](../MARKETPLACE_ROADMAP.md), [verification report](IMPLEMENTATION_REPORT.md), and [progress](PROGRESS.md).
