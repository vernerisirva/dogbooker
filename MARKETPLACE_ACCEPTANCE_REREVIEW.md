# DogBooker Marketplace — Independent Acceptance Re-review

**Verdict: PASS WITH NOTES**

Reviewed 8 November 2026, Europe/Helsinki. This accepts the bounded, local marketplace foundation for the next publication/CI gate. It does not authorize publication, merge or deployment.

The two original release blockers are resolved. Independent negative controls reproduced both defects in the old implementation and rejected the same attacks against the candidate. The inherited standalone cancellation precision defect remains P3 and reproduced in the first integration run. All 381 reported tests passed in the completed runs, including an unchanged repeat of that suite; this was **not an entirely green first pass**. Another 24 independently added cases pass.

## Acceptance decisions

| Question | Decision and qualification |
| --- | --- |
| Both original blockers resolved? | **Yes.** Connection overrides are rejected before connection; the database write fence prevents the original stale-snapshot capacity reduction. |
| All 381 reported tests pass? | **Yes in the completed runs**, with the first standalone integration run at 92/93 and its unchanged full repeat at 93/93. The P3 failure is retained below, not hidden by the repeat. |
| Database invariants adequately enforced? | **Yes within the supported runtime boundary:** database ACLs, authorized functions, row locks, the new write fence, foreign keys and exclusion constraints enforce future/ongoing booking inventory and party access. Arbitrary migration-administrator SQL is outside that boundary. |
| P3 safe to defer? | **Yes for this foundation acceptance.** It affects recent-cancellation selection/display and test reliability, not booking state, capacity release or stored audit timestamps. Track the correction; do not normalize rerunning red CI as the permanent solution. |
| Ready for an authorized push and hosted CI? | **Yes.** Preserve/commit the intended review artifacts, verify the public checkout and candidate SHA, then obtain explicit push authorization. Hosted CI has not run. |
| Ready to merge now? | **No.** The exact published candidate still needs successful hosted CI and separate merge authorization. |
| Production-ready? | **No.** This remains a deliberately local synthetic prototype with substantial documented launch gates. |

## Review target and independence

Target: `codex/marketplace-foundation`, **`00063d4d0206071bf6339c1aab344ea75a5c8886`**, in a separate public-source checkout. The private installation was not the review/test target. The reviewed repository's origin is `https://github.com/vernerisirva/dogbooker.git`, based on sanitized public base `7b9dadb`.

Read the original acceptance report, blocker-resolution report, relevant root/marketplace READMEs, architecture/security documentation, matching specification, roadmap, implementation report and ADRs. Inspected the connection consumers, runtime authorization/service code, all six marketplace migrations, relevant standalone migrations/services, regression tests, and all three workflows. Compared `13482eb`, `b13126d` and `00063d4`; the old failure assertions were retained. The original five marketplace migrations, nine standalone migrations and dependency lockfile are unchanged.

A fresh `git archive HEAD` export in a disposable temporary directory was installed with `npm ci`, using Node **22.23.4**. All **199 tracked files** in the original export match the candidate byte for byte. The two new test files also match between the reviewed checkout and tested copy. Application code, existing tests, migrations, workflows, dependencies and commits were not changed by this review.

Only the dedicated local PostgreSQL **16.14** cluster on loopback port **55438**, its synthetic standalone/marketplace databases, and generated disposable databases were used. Existing local test configuration was checked without printing passwords; outbound-mail credentials are empty. The required synthetic marketplace demo-credentials fixture was copied privately into the clean export. No private production database, account, credential file, deployment or external mail/payment integration was used. No paid external review API was invoked.

## Findings

### 1. P3 / Low — inherited cancellation timestamp precision remains

**Location:** `src/lib/booking-service.ts:171` (database clock decoded as `Date`), `src/lib/booking-service.ts:189` (SQL cutoff), `src/lib/booking-service.ts:196` (rounded value sent back); regression fixture `tests/integration/cancellation-history.test.ts:84`, assertion at `:90`.

**Reproduction/evidence:** the first full standalone integration run failed “shows only recent cancellations for both roles, regardless of original stay dates” at line 90: **92 passed, 1 failed**. The unchanged full repeat passed **93/93**. The failure did not capture its exact timestamps, so that individual scheduling event cannot be reconstructed conclusively. A separate deterministic read-only PostgreSQL/driver probe proves the precision defect without relying on timing:

| Value/comparison | Result |
| --- | --- |
| Exact database clock | `2026-11-08T10:00:00.900900Z` |
| Same value decoded by `pg` and serialized through JavaScript `Date` | `2026-11-08T10:00:00.900Z` |
| Cancellation at `2026-11-07T10:00:00.900500Z` | Exact comparison excludes it as older than 24 hours; rounded cutoff incorrectly includes it. |
| Cancellation at `2026-11-08T10:00:00.900500Z` | Exact comparison includes it; rounded upper bound incorrectly excludes it. |

**Impact:** SQL selection can disagree at either edge of the recent-cancellation window by less than one millisecond. An omitted row can remain absent from the rendered view until the next fetch. API/UI timestamp representations also lose sub-millisecond detail. The exact-boundary integration fixture can make CI intermittently red.

**Correctness/audit assessment:** this query is read-only. Active booking availability uses `entries.status='active'`, not the recent-cancellation cutoff. Cancellation/status changes, capacity release and notification persistence remain transactional. `drizzle/0006_cancellation_history.sql:9` records the original PostgreSQL timestamp and preserves it on repeated cancellation; the read-side round trip does not overwrite it. Permanent history at `src/lib/booking-service.ts:148` does not use this 24-hour filter. No lost audit record, duplicate booking, delayed capacity release or cross-owner exposure was demonstrated. P3 is justified; no evidence warrants escalation.

**Smallest appropriate correction:** fetch the single clock value as full-precision text (for example `clock_timestamp()::text`), bind that unchanged text for SQL comparisons, and separately produce the millisecond `serverNow` DTO. Alternatively compute the selection and clock from one database-side value. Add deterministic lower/upper-bound tests, including both examples above. Give the broad integration fixture an unambiguously expired age only alongside those exact-boundary tests. Do not weaken or remove the current regression merely to turn CI green. No correction was implemented here.

**Deferral:** safe for the local foundation/publication gate, with an explicit follow-up. This is the reason for the qualification in the verdict. It is not acceptable to claim a consistently green first run or exact timestamp precision in the API.

No new release-blocking code finding was established within the documented local threat model. Hosted and production gates below are outstanding verification/scope limits, not claims that those environments passed.

## Original blocker 1: connection configuration — resolved

**Former severity:** P2 / Medium. **Relevant locations:** `src/lib/local-postgres.ts:14`, `marketplace/lib/config.ts:3`, `marketplace/lib/connection.ts:4` and `:32`, `marketplace/scripts/local-admin.ts:5`, `src/lib/test-database-config.ts:4`, `scripts/test-database.ts:7`.

**Original reproduction:** loaded the actual validator from `13482eb`, passed each approved-looking URL through it, and constructed a `pg.Client` without connecting. `?host=remote.invalid` changed the driver host; `?port=5432` changed its port; `?user=unexpected_admin` changed its login. The current validator rejects all three before creating a connection. No external database was contacted.

**Effective boundary verified:**

| Path | Enforcement/evidence |
| --- | --- |
| Marketplace domain and auth pools | Parse once; hand explicit host/port/database/user/password/SSL/options to `pg`, with no retained `connectionString`. Each pool requires its named restricted role and exactly `127.0.0.1:55438/dogbooker_marketplace`. |
| URL syntax/override inputs | Reject non-PostgreSQL schemes, missing fields, raw whitespace, queries/fragments (including empty suffixes), encoded/duplicate option keys, role/options injection and SSL-file parameters. Encoded delimiters inside credentials remain credential data. |
| Environment precedence | Nonempty `PG*` and `NODE_PG_FORCE_NATIVE` settings fail closed. Generic `DATABASE_URL`/`DATABASE_URL_UNPOOLED` cannot replace marketplace URLs. Missing marketplace configuration has no fallback. A new independent test also changes target PG variables after validation and confirms explicit fields still win. |
| Actual connected identity | Installed `pg-pool` awaits `onConnect` before lending the client. The hook verifies database, server address/port, login/current role, privilege flags, memberships, ownership and public-schema creation rights. Real-role regression temporarily grants `CREATEDB` in the synthetic cluster, observes rejection, and restores the role. Hook/query failures do not lend the client. |
| Marketplace setup/migrate/seed/test administration | Fixed dedicated Unix socket and port, OS-user login and explicit password value; allowlisted database names; no environment URL or `.pgpass` target fallback. Setup/seed refuse existing/non-synthetic data as documented. These are trusted local administrator tools. |
| Standalone synthetic tests | Explicit opt-in; empty outbound-mail password; loopback/test database; matching runtime/direct identities including credentials; actual pool/connected identity checks; refusal of non-test accounts before fixture deletion. Explicit migration arguments receive the same validation in test mode. |
| Browser fixtures | Validate configuration before startup; fixed local URLs; `reuseExistingServer:false`. Standalone refuses `BASE_URL`; marketplace does not use it. Parent-process overrides are validated rather than trusted because an env file exists. |
| Ordinary standalone installations | Outside synthetic-test mode, the original self-hosted connection behavior remains supported. This is intentional and is not an alternate authorization path for fixture tools. |

All original regressions, 46 remediation marketplace connection cases, 18 standalone configuration cases and 13 additional independent cases pass. Positive cases include percent-encoded credentials, local production builds, the CI configuration shape, and standalone IPv4/localhost/IPv6 explicit configurations. Only IPv4 was exercised as an actual server transport in this run; the other positive configurations were checked through the installed driver parser.

**Impact removed/recommendation:** operator configuration can no longer override the validated endpoint or role using the original driver reparse. Retain these guards and regressions. The OS/cluster administrator and application process remain trusted: a malicious administrator can replace the loopback service, alter roles after a connection is checked, or relabel local data. Standalone ordinary migration mode is intentionally capable of operating on a real installation and is not a universally local-only command.

## Original blocker 2: snapshot/concurrency safety — resolved

**Former severity:** P2 / Medium. **Relevant locations:** `marketplace/migrations/0006_inventory_snapshot_fence.sql:6`, `:18`, `:22`; profile mutation `marketplace/migrations/0004_review_hardening.sql:2`; current request function `marketplace/migrations/0005_post_write_date_check.sql:2`; transaction wrapper `marketplace/lib/db.ts:9`.

**Independent negative control:** a generated database first installed the actual migrations 0001–0005. An editor established an old snapshot, another connection committed a two-dog/three-day request at Read Committed, then the editor reduced capacity. Both Repeatable Read and Serializable editors committed **capacity 1 / occupancy [2,2,2]**. After applying the actual additive migration 0006, the same ordering with fresh fixtures rejected both editors with **`40001`**, preserving **capacity 2 / occupancy [2,2,2]**. No function or clock was substituted in this probe.

The trigger now performs an actual sitter-row update for booking insert/status change/delete and availability insert/update/delete. That creates a new row version on the same row the writers lock. It makes a stale higher-isolation writer abort, including mixed-isolation transactions. At Read Committed, the existing volatile database functions execute their checks after acquiring the ordered locks and see committed inventory. This is consistent with PostgreSQL's distinction between a row lock and a real row update. [PostgreSQL application consistency](https://www.postgresql.org/docs/16/applevel-consistency.html), [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html).

| Scenario | Independently rerun/added evidence |
| --- | --- |
| Original five editor/booking isolation pairs | RC/RC, RR/RC, RR/RR, Serializable/RC, Serializable/Serializable all retain capacity two and two occupied units per day; reduction rejects. |
| Booking vs capacity reduction | Both commit orders at all three isolation levels pass; tests observe the actual blocker before releasing it. |
| Concurrent reductions | Serialized at RC; stale RR/Serializable editor aborts. |
| Concurrent requests | Existing 100-request test admits exactly two at capacity two. This uses a maximum 12-connection pool, not 100 simultaneous database sessions. New tests reject an old last-slot booking snapshot at each isolation level. |
| Concurrent approvals | One confirmed state/revision; inventory is unchanged. Higher-isolation loser aborts; fresh transaction observes idempotent confirmation. |
| Cancel/decline and replacement | Committed release is atomic; rollback retains both daily and dog reservations. Added RR/Serializable replacement tests cover both cancellation commit and rollback, then fresh-transaction reuse of released inventory. |
| Availability changes | Both commit orders and stale reads in both directions pass; no accepted stay consumes a closed schedule. |
| Independent sitter accounts | Added RC/RR/Serializable tests commit sitter B's request while sitter A's transaction remains open with an allocated booking. B's inventory commits; A's rollback leaves no inventory. No global sitter serialization was found. |
| Dog exclusion, multi-dog/exclusive care, daily fragmentation | Existing database cases pass, including cross-sitter overlap and inclusive dates. |
| First-profile/intervening booking and midnight exclusion wait | Existing controlled cases pass. The midnight test substitutes only the clock source in its disposable database; it is not a real overnight test. |
| Failure and rollback | Partial writes do not persist; cancellation rollback preserves allocations; terminated backend is discarded. |
| Deadlock and serialization retry | Actual advisory-lock deadlock plus database-raised aborts pass; retry/exhaustion tests prove exactly-once persisted transactional work and at most three attempts. |

**Alternative mutation paths:** catalog checks confirm neither runtime role has INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER privileges on any of the six domain tables. A real `marketplace_app` login, not just an administrator using `SET ROLE`, receives `42501` for direct capacity updates, booking deletes, reservation truncation, trigger disabling, replica mode, assuming the auth role and direct trigger-function execution. Both triggers are enabled. Explicitly granted functions have fixed search paths and actor/party checks. Direct reservation/care edits, moving a booking to another sitter and bypassing the fence are unavailable through the supported runtime API.

The invariant depends on this complete database boundary. The fence alone is not a universal constraint on arbitrary administrator SQL, and there is no claim that current capacity retroactively caps historical stays. Future mutation functions must preserve the same protocol; granting table DML would invalidate this assessment.

**Retries:** `marketplace/lib/db.ts:13` explicitly begins Read Committed; line 27 allows only `40001`/`40P01` and stops after attempts 0, 1 and 2. Each attempt rolls back before retrying the entire callback, reacquires a client, and sets actor context transaction-locally. Rollback failure discards the connection. Business/constraint/transport errors are not retried; uncertain commits are not blindly replayed. Exhaustion maps to generic HTTP 409. All current callbacks contain database work and local computation, not external side effects. Direct higher-isolation callers must restart their own aborted transaction. [PostgreSQL serialization failure handling](https://www.postgresql.org/docs/16/mvcc-serialization-failure-handling.html).

**Impact removed/recommendation:** the original stale-capacity violation no longer commits. Retain the additive migration, grants, isolation matrix and retry tests. The extra sitter-row versions add write/vacuum work; sustained production throughput and starvation have not been measured.

## Validation results

Commands ran from the appropriate application directory in the fresh Node 22 export. Chromium used `CI=true` and the installed Playwright browser cache; browser tests started their own production servers. No tests were skipped, removed or weakened.

| Suite | Unit | Integration | Browser |
| --- | ---: | ---: | ---: |
| Standalone reported baseline | 150/150 | 93/93 on unchanged full repeat; first run 92/93 | 13/13, 43.0 s |
| Marketplace reported baseline | 63/63 | 58/58 | 4/4, 4.7 s |
| Additional independent marketplace cases | 13/13 | 11/11 | — |
| Completed total | 226 | 162 | 17 |

**381 baseline tests plus 24 added cases = 405 passing tests in the completed runs.** Expanded marketplace totals are 76 unit / 69 integration / 4 browser. The retained first-run P3 failure prevents describing this as 405 consistently passing on the first attempt.

| Other check | Result |
| --- | --- |
| Fresh `npm ci` | 813 packages installed; 814 installed entries audited; zero reported vulnerabilities. |
| Both `npm run lint` | Passed; new tests also checked. |
| Both `npm run typecheck` | Passed; new tests also checked. |
| Both `npm run build` | Passed; browser suites exercised those production builds. |
| Both `npm run db:migrate`, twice | Passed; reruns applied nothing. |
| Fresh standalone migration probe | All nine migrations applied in a newly generated database; second run applied nothing; database removed. |
| Marketplace fresh/populated migration test | All six migrations exercised; sitter/availability/booking/care snapshots preserved; two range rows expand to six equivalent daily rows. |
| `npm audit --audit-level=moderate --json` | Zero vulnerabilities across 965 lockfile dependency entries. This is a current registry-advisory result, not proof of no undisclosed vulnerability. |
| `npm run licenses` | 965 entries; inventory byte-identical to candidate. |
| Secret scan | Gitleaks 8.30.1: full public feature history (six commits) and final publishable source including the new review/tests have no findings. Scanner archive checked against the cached official release checksum. |
| Workflow parsing/static review | All three YAML files parse; triggers, permissions and local provisioning inspected. |
| Ranking benchmark | Assertions pass; 100/1,000/10,000 candidates, p95 0.31/1.67/14.05 ms. In-process ranking only, not API/database or production load evidence. |
| Preservation | All 199 original tracked files match tested export; original migrations/lockfile unchanged; `git diff --check` passes. |

**Disclosed setup/probe failures:** the first marketplace integration invocation had 57 passes/one failure because the fresh export lacked ignored `.local/demo-accounts.json`. Copying the existing synthetic seed fixture fixed that review setup omission; the full baseline then passed 58/58. The first new independent integration run exposed a SQL alias typo in the new test helper (10 new-case errors); adding `AS` fixed only that helper, and the complete expanded suite passed 69/69. Neither event required an application change. Sandbox DNS/shared-memory restrictions required permitted execution access; the scanner download returned HTTP 503, so the existing checksum-verified release archive was used. These events are separate from the reproduced P3 product defect.

## Authentication, tenant isolation and standalone compatibility

Production-mode auth regressions verify password hashing/checking; client inability to set activity; application-prefixed, host-only, HttpOnly, SameSite=Lax session cookies; approximately 24-hour expiry; tamper/expiry/logout rejection; inactive-account behavior; database-backed sign-in limits; and foreign/missing-origin rejection. The deliberate local HTTP origin is not evidence for a deployed HTTPS cookie/proxy configuration.

SQL/RLS, service and browser tests cover multiple owners and sitters, foreign dog IDs, unrelated booking reads/decisions, private care snapshots, cancelled/declined access, price/care immutability and transaction-local actor cleanup. Authentication supplies the actor; request JSON cannot set owner/operator. The application process can set the custom actor setting and holds both credentials, so RLS is not a sandbox against a fully compromised application process. Search output excludes owner identity and care notes. Expired-care RLS was inspected; a real midnight browser transition was not awaited.

The standalone application keeps its domain services/routes and nine migrations unchanged. Both production builds and the full standalone suite exercise invitations, owners, booking approvals, shared-stay privacy, time windows/proposals, arrival/pickup behavior, cancellation/history and reminders. Its only runtime change in this remediation is conditional connection hardening in explicit synthetic-test mode. A private production deployment was neither needed nor used to establish compatibility.

## Hosted CI, publication and merge gates

**Local verification only.** A read-only GitHub branch search for `codex/marketplace-foundation` returned no branches. No push, PR, merge or deployment occurred, and there are no hosted run URLs for this candidate to report.

`.github/workflows/ci.yml:1`, `.github/workflows/marketplace.yml:1` and `.github/workflows/secrets.yml:1` use push/pull-request triggers and `contents: read`. They use disposable local PostgreSQL/generated test credentials, not production secrets, and have no deployment job or `pull_request_target`. Root CI checks migrations twice, lint/types/tests, licenses/audit, build and browser tests. Marketplace provisions its fixed loopback cluster and runs setup/migration/seed, checks, benchmark, build and browsers. Secret CI scans full history with a checksum-verified scanner.

The marketplace path filter includes the shared PostgreSQL validator at `.github/workflows/marketplace.yml:8`. The initial feature publication includes matching implementation/test paths. Later documentation-only pushes may skip that job, and there is no manual trigger; do not interpret a skipped job as successful candidate validation. The hosted marketplace job does not itself repeat migrations, although safe reruns passed locally. Ubuntu package provisioning, its selected PostgreSQL version, browser system libraries, network availability, permissions and job time limits remain unverified on GitHub.

Next actions, in order:

1. Preserve this report and the two new tests in the public feature branch's intended commit set. Finalization adds only review documentation/tests; existing commits and implementation behavior remain unchanged. The [P3 issue draft](docs/issue-drafts/cancellation-timestamp-precision.md) records the follow-up without publishing an issue.
2. **Only after explicit push authorization**, publish from this public checkout and record the exact commit SHA.
3. Require successful hosted checks named exactly `validate`, `local-prototype`, and `gitleaks` for that candidate. Their workflow/job labels are `CI / validate`, `Marketplace prototype / local-prototype`, and `Secret scan / gitleaks`. The marketplace adds a third workflow, not another job inside the two existing public workflows. Record run URLs and investigate failures, including any P3 recurrence. A missing/skipped result is not a pass. See the [CI handoff and proposed commands](docs/MARKETPLACE_CI_HANDOFF.md).
4. Reassess merge readiness after hosted checks, then obtain separate PR/merge authorization. A merge would accept a local foundation, not authorize deployment.

## Production boundary and retained evidence

Production readiness remains **no**. Documented launch gates include expiring pending holds/admission limits; transactional notifications and audited booking operations; verified registration/recovery and sitter publication approval; payment/refund/reconciliation design where applicable; privacy retention/deletion; operational monitoring, backup/restore, incident/support processes; realistic multi-host load; and reviewed deployment credentials/TLS. Search scans profiles, the agenda is capped at 200 rows, and care compatibility relies on declarations. The benchmark and local suite do not validate real animal-care outcomes or commercial operation.

New maintained evidence: `marketplace/tests/rereview-config.unit.test.ts` (13 cases) and `marketplace/tests/rereview-boundaries.integration.test.ts` (11 cases). Raw logs and the reproducible original-vs-fixed/precision/fresh-migration probes are retained under ignored `.local/rereview/` in this checkout. Key files are `independent-probes.log`, `probes.ts`, `integration.log`, `integration-repeat.log`, `marketplace-integration-complete.log`, `marketplace-integration-final.log`, `marketplace-unit-expanded.log`, `browser.log`, `marketplace-browser.log`, `fresh-migrations.log`, `dependency-audit.json`, `secrets-history.log`, `secrets-source.log` and `source-verification.json`.

All generated disposable databases were removed. Test web servers stopped, and the previously stopped synthetic PostgreSQL cluster was returned to its stopped state. Private main and the public candidate commit remain unchanged. Not verified: hosted CI, production integrations/resources, sustained multi-host load/failover, a real overnight clock transition, or exhaustive accessibility/device coverage.
