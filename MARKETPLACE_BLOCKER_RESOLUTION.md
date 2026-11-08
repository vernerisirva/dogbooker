# Marketplace acceptance blockers — resolution evidence

**Subsequent independent review, 8 November 2026:** [PASS WITH NOTES](MARKETPLACE_ACCEPTANCE_REREVIEW.md). Both fixes were independently verified. Completed runs passed the 381 baseline tests plus 24 new cases; the first standalone integration run reproduced the inherited P3 flake before an unchanged repeat passed. The implementation-time record below is preserved. Hosted CI and production readiness remain unverified; publication is not authorized.

8 November 2026. Branch `codex/marketplace-foundation`, sanitized public base `7b9dadb`. Scope: fix the two blocking findings from [the independent acceptance review](MARKETPLACE_ACCEPTANCE_REVIEW.md), preserve behavior, and prepare independent re-review. Implementation/test fix commit: `b13126d` (`fix: enforce local database boundaries and snapshot-safe inventory`). No unrelated feature was added. The historical review verdict remains FAIL until a new independent review accepts the candidate.

**Implementation result: both blockers fixed; all 381 tests pass. Ready for independent re-review. Hosted CI and merge acceptance remain pending; production readiness remains no.**

## Reproduction and retained regressions

Before changing implementation, committed the original report and its three regression files as `13482eb` (`test: preserve independent marketplace acceptance regressions`). Against that code:

- `cd marketplace && npm test -- tests/acceptance-config.unit.test.ts`: **3 failed**. The validated URL's query parameters changed the driver's effective host, port or user. These probes constructed clients only; no remote connection was attempted.
- `cd marketplace && npm run test:integration -- tests/acceptance-concurrency.integration.test.ts`: **10 passed, 3 failed**. A committed two-dog booking was absent from an older editor snapshot; capacity became **1**, while all three dates retained **2** occupied slots.

All six failures now pass with their original assertions. The original concurrency file changes only its connection setup to the shared local administrator boundary and appends cases; no original assertion, test body, skip condition or expected error was weakened. The migration preservation test additionally checks sitter/availability data and includes migration 0006. Added tests increase the reviewed 293-test suite by 88 to 381.

## Finding 1 — effective database connection overrides

**Original severity: P2 / Medium, release blocker. Resolved.** The original `marketplace/lib/config.ts` validated one interpretation of a URL and passed the untrusted original string to a second parser. `pg` allows query parameters to override explicit connection fields; inherited libpq-style variables and alternative admin/test constructors also needed review.

The trust boundary now constructs explicit options once, without a `connectionString` field. See `src/lib/local-postgres.ts:14`, `marketplace/lib/config.ts:3` and `marketplace/lib/connection.ts:32`.

| Configuration path | Enforced policy / evidence |
| --- | --- |
| Domain runtime `MARKETPLACE_DATABASE_URL` | Fixed `127.0.0.1:55438/dogbooker_marketplace`, `marketplace_app`, explicit credentials; no fallback to generic URLs. |
| Auth runtime `MARKETPLACE_AUTH_DATABASE_URL` | Same fixed target, exclusively `marketplace_auth`; the same validator and awaited connection hook. |
| URL query/fragment/scheme/encoded inputs | PostgreSQL scheme only; reject all query parameters/fragments/raw whitespace, unsupported targets/identities, absent credentials and invalid ports. Percent-encoded credentials are decoded once. Port zero is rejected because the driver otherwise falls back to 5432. No second URL parse reaches the driver. |
| Process environment and `.env` precedence | Every effective value is validated at construction. Reject nonempty `PG*` and `NODE_PG_FORCE_NATIVE`, including host/user/database/password, options/role, service, password-file, SSL and native-mode overrides. Explicit SSL/startup options prevent implicit configuration fallback. Local builds and CI obey the same boundary. |
| Actual runtime connection | Awaited hook checks database, server IP/port, current/login role, elevated role flags, memberships, database/table ownership and schema-create permission before app/auth work. Missing or unexpected results fail closed. A real test temporarily grants CREATEDB in the synthetic cluster and proves a new runtime connection is refused, then restores/rechecks the role. |
| Setup, migrations, seed and isolated database tests | `marketplace/scripts/local-admin.ts:5` fixes the Unix socket, port and OS user, gives an explicit local authentication value, rejects PG environment overrides and allowlists only the control/demo/generated test database names. No environment URL is consumed by this path. |
| Standalone synthetic tests, fixtures and migration argument | `src/lib/test-database-config.ts:4` requires explicit test mode, empty outbound-mail credentials, loopback, a test database name and matching runtime/direct identities. The existing pool must match; `scripts/test-database.ts:7` checks the actual target/login/port and rejects non-test accounts before fixtures mutate data. An explicit migration function argument is subject to the same guard. |
| Browser target and server reuse | Both configs validate local database settings and start their own local server. The standalone config refuses `BASE_URL`; marketplace does not consume it. Neither suite reuses an unknown running server. |
| Ordinary standalone self-hosting | Outside explicit synthetic-test mode, existing deployment connection behavior remains supported. This mode is not a test-tool authorization path. Malformed migration errors are sanitized in both modes. |

Adversarial coverage includes the original three driver bypasses, 46 new marketplace connection cases and 18 new standalone test-configuration cases. It exercises encoded/duplicate query keys, options/role injection, SSL file paths, wrong scheme/host/port/database/role, environment precedence, missing config, native mode, malformed credentials, admin targets, connected identity/privileges, explicit migration overrides and sanitized errors. No URL/password is logged. The actual connection identity check additionally runs throughout the integration/browser suites.

Trust limits: the local OS, dedicated cluster administrator and application process remain trusted. A malicious administrator can change roles after a connection is verified, disable triggers or replace a loopback service; this prototype is not intended to sandbox that authority. Standalone fixtures still require the operator to choose a disposable database and explicit opt-in; a deliberately mislabeled local production database is outside that promise.

## Finding 2 — stale transaction snapshots

**Original severity: P2 / Medium, release blocker. Resolved.** `BEGIN` inherited session isolation. Row locks ordered writers but did not refresh a Repeatable Read snapshot, and booking creation did not change the sitter row version. A stale profile editor could miss the booking. Serializable on only the editor did not protect a booking at Read Committed.

**Database fix:** additive `marketplace/migrations/0006_inventory_snapshot_fence.sql:6` adds fixed-search-path, revoked-execute trigger code. Booking creation/status changes/deletion and availability changes perform a no-op sitter update, creating a new MVCC version of the row already locked by profile writers. Old Repeatable Read/Serializable writers now receive `40001`; fresh Read Committed calls observe current commitments under the existing lock protocol. Existing functions, authorization, per-day slot exclusions, dog exclusions and all previous migration checksums remain unchanged. [ADR 003](marketplace/docs/adr-003-connection-and-snapshot-boundaries.md) explains the PostgreSQL snapshot behavior and tradeoffs.

**Application fix:** `marketplace/lib/db.ts:13` explicitly begins Read Committed, sets actor context locally and retries the whole database-only callback for `40001` or `40P01` after rollback, at most three attempts. Business/constraint errors and uncertain transport/commit failures are not retried. Failed rollback discards the client; actor state cannot leak through its reuse. Exhausted conflicts retain the existing generic Swedish HTTP 409 response.

| Deterministic scenario | Verified result |
| --- | --- |
| Original stale editor/booking isolation pairs: RC/RC, RR/RC, RR/RR, Serializable/RC, Serializable/Serializable | All five preserve capacity **2**, occupancy **[2,2,2]**, and reject the reduction with a business or serialization conflict. The three originally failing pairs now pass. |
| Booking versus reduction, both commit orders, each of RC/RR/Serializable | Observe the contender blocked before first commit. Booking first preserves capacity two/occupancy two; reduction first leaves capacity one/no booking. Loser aborts; no invalid state commits. |
| Concurrent reductions at RC/RR/Serializable | Ordered profile updates; old snapshots abort. No inventory is created or orphaned. |
| Concurrent approvals at RC/RR/Serializable | One final confirmation/revision, unchanged allocations. Higher-isolation loser retries in a fresh transaction and observes idempotent confirmation. |
| Cancellation/decline versus waiting replacement; cancellation rollback | Committed release lets the waiting request consume capacity. Rollback preserves the original booking/allocations and rejects the replacement. |
| Availability close/request, both orders; stale snapshots in both write directions | Booking cannot consume a closed schedule; closing cannot overlook active inventory. Higher-isolation stale writers abort. |
| Full transaction abort/retry and exhaustion | Actual PostgreSQL `40001`/`40P01` aborts after writes are rolled back; success on third attempt persists exactly one row. Three failures persist none and return a generic conflict. |
| Actual advisory-lock deadlock | Two callbacks synchronize after taking opposite first locks. PostgreSQL aborts one; exactly one full retry succeeds, with two intended rows and no duplicate. |
| Business/constraint/connection failures, terminated backend | No inappropriate retry. Failed writes roll back; disconnected client is discarded; subsequent actor context is empty. |
| Existing request contention, tenant/dog isolation and retry UUIDs | 100 requests through the 12-connection pool admit exactly two at capacity two; ten identical request keys produce one booking; unauthorized dog/tenant access still rejects. |
| Original initial-profile/intervening-booking and exclusion wait across midnight | Preserved passing tests. Lock graph controls ordering; only the clock expression is substituted inside the disposable midnight-test database. |

The 27 acceptance concurrency cases use `pg_blocking_pids`/`pg_stat_activity` observations, transaction boundaries and explicit barriers. Deadlines bound failures; sleeps do not choose ordering. The transaction suite adds ten cases, including real database failures. Direct higher-isolation callers remain responsible for whole-transaction retries after `40001`; safety does not depend on the application wrapper.

## Guaranteed invariants within the supported boundary

- No local marketplace/test configuration can override validated fields through a second connection-string parse or inherited PG configuration. Runtime roles and the connected marketplace target are verified before application work.
- All supported domain mutations use the same sitter write/lock boundary. A committed booking and a capacity reduction cannot jointly leave daily occupancy above capacity, including mixed isolation and old snapshots.
- Pending and confirmed bookings reserve the same daily inventory. Approval cannot allocate twice; cancellation/decline commits all releases or rolls them all back.
- Availability/profile constraints, immutable booking/care snapshots, dog ownership, cross-sitter dog exclusion and private tenant reads remain enforced by existing database functions, keys, exclusions and RLS.
- Retries are bounded, encompass the whole aborted transaction and cannot duplicate rolled-back writes. Connections with unknown rollback state are discarded. External side effects must stay outside retry callbacks.

These statements concern restricted runtime functions and trusted migrations, not arbitrary administrator SQL or a claim of database-wide serializability for every possible custom transaction.

## Exact final verification

The final candidate's executable source was copied to a fresh directory under `/private/tmp` and installed with the unchanged lockfile using **Node 22.23.4** (`npm ci`: **813 installed packages**, **814 audited installed entries**, zero vulnerabilities). It uses PostgreSQL **16.14**, only the dedicated loopback cluster at port **55438**, separate synthetic standalone/marketplace databases, no outbound mail credentials, and Playwright Chromium **156.0.8078.4** with `CI=true`. All 171 tracked executable/configuration files in the tested copy match this candidate byte for byte. Shared checkout dependencies were not reinstalled or changed.

| Working directory / command | Result |
| --- | --- |
| Root `npm test` | **150/150 passed**, 14 files |
| Root `npm run test:integration` | **93/93 passed**, 14 files |
| Root `npm run test:e2e` | **13/13 passed**, 41.2 s |
| Marketplace `npm test` | **63/63 passed**, 3 files |
| Marketplace `npm run test:integration` | **58/58 passed**, 5 files |
| Marketplace `npm run test:e2e` | **4/4 passed**, 4.3 s |
| Total | **381 passed, zero failed/skipped** |
| Each app `npm run lint`, `npm run typecheck`, `npm run build` | All passed; both browser suites exercise production builds |
| Each app `npm run db:migrate`, repeated | Passed; repeated runs apply nothing |
| Root `npm audit --audit-level=moderate --json` | **0 vulnerabilities**, 965 lockfile dependency entries |
| Root `npm run licenses` and inventory diff | **965 entries**, byte-identical inventory |
| Marketplace `npm run benchmark` | Assertions pass; 100/1,000/10,000 candidates, 25 measured runs, p95 **0.31/2.98/15.42 ms**; in-memory ranking only |
| Workflow YAML parse and security inspection | All three parse; no production credentials/deploy steps; shared validator added to marketplace path filters |
| Gitleaks 8.30.1 publishable source and full feature history | No leaks |
| `git diff --check`; previous migrations/lockfile comparison | Passed; earlier migrations and dependencies unchanged |

Local raw logs are retained in ignored `.local/blockers/` and `marketplace/.local/blockers/`, with final clean-install logs under their `node22/` subdirectories. Initial failing reproductions are `config-before.log` and `concurrency-before.log` in the marketplace directory. These artifacts and environment/demo credential files are deliberately excluded from commits. An early new-test fixture typo and a PostgreSQL address-format comparison were corrected during implementation; the final runs above are complete passing suites, not partial retries hiding a failing case.

The migration preservation case checks unchanged sitter, availability, booking and care JSON, with the same six daily occupied units after migrating a populated early schema through 0006. All nine standalone migrations remain unchanged. Browser flows verify Swedish validation/onboarding, mobile UI, several dogs, invitations, private booking detail, sitter profiles, search, approvals, cancellation and capacity release. Authentication security tests retain production-mode origin, cookie, session expiry/revocation and rate-limit assertions.

## Changed-file security review and remaining risks

Reviewed every changed runtime/configuration/migration/tool/test/workflow file. Confirmed explicit parameterized connection-identity queries, no credential-bearing diagnostics, no new public data fields, fixed trigger search path and revoked direct execution, unchanged existing grants/RLS and bound service arguments, database-only transaction callbacks, intentional test-only privileged operations with cleanup, local-only fixture targets, additive migrations and workflow filters for the shared validator. All original acceptance test assertions remain intact.

- **P3 / Low, inherited:** `src/lib/booking-service.ts:171` and `tests/integration/cancellation-history.test.ts:84` retain the independent review's sub-millisecond cancellation-boundary risk. Current runs pass, but JavaScript timestamp precision can still cause a rare exact-boundary test failure. Recommended follow-up: retain database timestamp precision and add a deterministic exact-boundary case. No test was weakened and no unrelated domain-service change was made in this blocker fix.
- **Operational limit:** the new row version per booking/schedule mutation adds write amplification. Local contention tests pass; sustained multi-host load, vacuum behavior, starvation and production latency are unmeasured. Three failed attempts return a conflict rather than retrying indefinitely.
- **Hosted gate:** Ubuntu provisioning, apt-selected PostgreSQL, browser libraries and actual GitHub runner results remain unverified. Local Node 22/Chromium success does not replace that gate.
- **Production gates:** local HTTP/socket trust, non-expiring pending holds, missing admission/notification/verification/payment/incident/recovery/retention operations and the previously documented prototype limits remain. No production-readiness claim is made.

## Hosted CI, merge readiness and handoff

No push, PR, merge or deployment was performed. Workflows use `contents: read`, ephemeral local databases and generated credentials, with no production secrets or deployment jobs. The marketplace workflow now also triggers for `src/lib/local-postgres.ts`; its first run still requires separately authorized publication.

After independent re-review and **only after explicit push authorization**, from this public checkout:

1. Verify the clean tree, branch, candidate SHA and public `origin` (`https://github.com/vernerisirva/dogbooker.git`); do not use the private main checkout.
2. Run `git push -u origin codex/marketplace-foundation`.
3. Run `gh run list --branch codex/marketplace-foundation --limit 10`, then `gh run watch <run-id> --exit-status` for the exact candidate SHA. Require `CI / validate`, `Marketplace prototype / local-prototype` and `Secret scan / gitleaks` to pass. Record run URLs/SHA; skipped/queued jobs are not passes.
4. Open a PR or merge only when separately authorized. No deployment belongs to this handoff.

The code is ready for independent re-review. Merge acceptance requires that review plus hosted CI. The private production application, its credentials and databases were not accessed or changed. Only synthetic test resources were used.
