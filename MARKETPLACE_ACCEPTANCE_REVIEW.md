# DogBooker marketplace independent acceptance review

**Remediation note, 8 November 2026:** findings 1 and 2 have implementation fixes and passing regression evidence in [MARKETPLACE_BLOCKER_RESOLUTION.md](MARKETPLACE_BLOCKER_RESOLUTION.md). The subsequent [independent re-review](MARKETPLACE_ACCEPTANCE_REREVIEW.md) returned **PASS WITH NOTES**, retaining the inherited P3 cancellation precision finding and its reproduced flaky test failure. The original verdict and findings below remain historical evidence; hosted CI and merge acceptance are still pending.

**Verdict: FAIL — fix findings 1 and 2 before merge acceptance.** The normal local prototype flows work, and both previously unverified concurrency scenarios now have passing controlled tests. However, the claimed local-only connection boundary can be bypassed by connection-string options, and capacity protection depends on an isolation level the application does not enforce. These are configuration-dependent failures, not evidence of overbooking or cross-tenant disclosure in the tested default configuration.

Reviewed 7 November 2026, Europe/Helsinki. Target: `codex/marketplace-foundation`, commit `bb34e1a9cd10a60eb9ef4d4889367d00644c2365`; implementation `cb93f5c`; sanitized public base `7b9dadb`. Review checkout: `.local/marketplace-foundation` under the original workspace. The original workspace is the private application and was not used as a test target.

## Scope and evidence

Read the root and marketplace READMEs, `marketplace/IMPLEMENTATION_REPORT.md`, progress report, architecture, matching specification, roadmap, both marketplace ADRs, standalone architecture/security review, all five marketplace migrations, migration runner, runtime services/routes/authentication, matching implementation, UI, automated tests, and all three GitHub Actions workflows. Traced the standalone calendar code involved in the observed regression failure. Compared the branch against the sanitized public base: standalone `src/`, `drizzle/`, `scripts/`, `tests/` and the lockfile are unchanged.

Previous marketplace independent-review findings are available as a summary in `marketplace/IMPLEMENTATION_REPORT.md:56`; no separate raw review transcript is in the branch. The listed fixes were checked in the final code. Their summary alone was not treated as acceptance evidence.

This review adds only this report and three test files. It does not fix or refactor application code. The regression tests deliberately fail for unresolved findings so that subsequent fixes are reviewable. No production account, database, credential, email service, deployment, push, PR or merge was used.

## Findings and recommended fixes

### Must fix

1. **[P2 / Medium] Connection options bypass the local-only and restricted-role checks.** File: `marketplace/lib/config.ts:5` (return at line 14); callers: `marketplace/lib/db.ts:4`, `marketplace/lib/auth.ts:6`.

   The validator checks the URL authority, then passes the original string to `pg`. The installed driver lets query parameters override the effective connection settings. A URL with the approved authority plus `?host=remote.invalid`, `?port=5432`, or `?user=unexpected_admin` passes validation and produces a client using that different host, port or user. The probe constructed clients only; it made no external connection. All three retained unit regressions fail.

   **Fix:** For this fixed local prototype, reject query parameters and fragments and require a PostgreSQL URL scheme before handing the string to the driver. Alternatively construct a validated explicit driver configuration without retaining override parameters. Keep the three negative tests. This is an operator/environment configuration boundary; browser input does not directly control these URLs. Leaving it unchanged makes the documented refusal to use remote databases or privileged runtime roles unreliable.

2. **[P2 / Medium] Capacity-changing profile writes can use a stale transaction snapshot.** Files: `marketplace/lib/db.ts:16`; `marketplace/migrations/0004_review_hardening.sql:6`–8.

   `BEGIN` inherits the connection/database default. A row lock does not refresh a Repeatable Read snapshot. Reproduction: start the sitter's transaction and establish its snapshot; commit a two-dog, three-day booking from another connection; save capacity one in the old transaction. The save and commit succeed with **capacity 1 and occupancy [2, 2, 2]**. This happens with both writers at Repeatable Read and with a Repeatable Read or Serializable editor mixed with a Read Committed booking. The default Read Committed pair rejects the edit, and a uniformly Serializable pair also prevents the invalid result.

   **Fix:** Explicitly begin application transactions at Read Committed and document that requirement. Because database functions are also advertised as a write boundary, reject unsupported isolation levels in those functions via a new migration, or implement and test a consistent serialization protocol. Do not rewrite already-applied migration files. If choosing Serializable, every participating transaction needs the same policy and serialization-error handling; changing only one caller is insufficient. Update the acceptance tests to recognize any deliberate fail-closed isolation error and verify the actual application transaction still enforces the chosen level.

   Current dedicated local configuration was verified as Read Committed; no capacity violation occurred there. This finding concerns inherited configuration and direct database-function callers. PostgreSQL documents the snapshot/locking distinction and the need for consistent Serializable participation: [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [application consistency](https://www.postgresql.org/docs/16/applevel-consistency.html).

### Should fix

3. **[P3 / Low, inherited] The standalone cancellation boundary can produce a flaky integration result.** Files: `tests/integration/cancellation-history.test.ts:84` and `src/lib/booking-service.ts:171`–189.

   The first standalone run had 92 passes and one failure at the assertion on line 90; the repeat and clean Node 22 run passed all 93. The fixture uses exactly 24 hours, while the server reads PostgreSQL's microsecond clock into a millisecond JavaScript Date and sends it back as the SQL cutoff. A deterministic read-only probe reproduced the discrepancy: exact time `10:00:00.900900`, serialized time `10:00:00.900`, cancellation time on the previous day `10:00:00.900500`. The serialized cutoff includes that expired row; the exact cutoff excludes it. This supports a sub-millisecond boundary explanation, though the first failing run did not capture its precise timestamps.

   **Fix:** Preserve the database timestamp precision for SQL comparisons, or use a single database-side time value. Keep exact boundaries in deterministic tests; give the broad integration fixture an unambiguous expired age rather than relying on scheduling. The practical visibility difference is below one millisecond. This code is unchanged by the marketplace branch and is not a marketplace merge blocker, but the test can make CI intermittently red.

No critical/high-severity finding or successful unauthorized cross-tenant access was demonstrated. That statement is limited to this code review and the tested local threat model.

## Exact validation results

Validation used PostgreSQL **16.14**, a dedicated loopback cluster at port **55438**, and synthetic accounts only. The existing public-release environment files were checked for endpoint/role safety without printing passwords. Both database URLs target local test databases; outbound mail credentials are empty. A separate clean source export was installed under `/private/tmp` using **Node 22.23.4** and `npm ci`, without changing the checkout's shared dependency directory. The main local run used **Node 25.9.0**.

Commands below are run from the indicated application directory. Raw logs are retained in ignored `.local/acceptance/` directories at the repository root and under `marketplace/`.

| Check | Result |
| --- | --- |
| Standalone `npm test` | **132/132 passed**, Node 25 and clean Node 22 |
| Standalone `npm run test:integration` | First run **92 passed / 1 failed**; repeat **93/93 passed**; clean Node 22 **93/93 passed** |
| Standalone Chrome `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` | **13/13 passed**, 43.0 s |
| Standalone Node 22 + Playwright Chromium browser suite | **13/13 passed**, 43.5 s |
| Marketplace original unit suite | **14/14 passed** |
| Marketplace original integration suite | **19/19 passed**, including 100-request contention and populated migration preservation |
| Marketplace expanded `npm test` | **14 passed / 3 failed**; failures are finding 1 |
| Marketplace expanded integration suite | **31 passed / 3 failed**; failures are finding 2 |
| Marketplace Chrome browser suite | **4/4 passed**, 6.1 s |
| Marketplace Node 22 + Playwright Chromium browser suite | **4/4 passed**, 6.8 s |
| Both applications `npm run typecheck` | Passed, including the added tests |
| Both applications `npm run lint` | Passed |
| Both applications `npm run build` | Passed with Node 25 and clean Node 22; no deployment |
| Fresh Node 22 `npm ci` | Passed; 813 installed packages, 814 audited installed entries, zero reported vulnerabilities |
| Root `npm audit --audit-level=moderate --json` | Passed; **0 vulnerabilities**, lock audit metadata reports **965 dependency entries** |
| Root `npm run licenses`, then inventory comparison | Passed; **965 locked entries**, no inventory changes |
| Both migration commands, each run twice | Passed, no new migration applied on rerun |
| Gitleaks 8.30.1 all refs/full history | **3 commits scanned; no leaks** |
| Final publishable source plus added tests/report secret scan | Gitleaks 8.30.1: **no leaks** |
| Workflow YAML parsing and static inspection | All three workflows parse; hosted execution still unverified |
| `git diff --check` | Passed |

The original report's **275 passing tests** are reproducible after the standalone boundary-test retry. The expanded suite has **293 tests: 287 pass and 6 fail**, rather than an all-green result. The six failures represent two root causes, not six independent defects. Infrastructure-only attempts blocked by sandbox local-socket/DNS restrictions were rerun successfully with the required execution access and are not counted as product failures.

Added evidence:

- `marketplace/tests/acceptance-config.unit.test.ts`: three effective-driver-option bypass cases; no connections opened.
- `marketplace/tests/acceptance-concurrency.integration.test.ts`: thirteen controlled PostgreSQL cases. It creates and drops a uniquely named disposable database, uses the actual restricted runtime role for calls, and observes `pg_blocking_pids`/`pg_stat_activity` rather than sleeping to guess when a lock was reached.
- `marketplace/tests/acceptance-auth.integration.test.ts`: two authentication/security cases containing assertions for cookies, passwords, tampering, expiry, revocation, activity, rate limits and origins. Better Auth disables origin checks under its test environment, so this file deliberately loads it in production mode before making those assertions; the application configuration is unchanged.

## Concurrency findings

| Scenario | Verified outcome |
| --- | --- |
| Previously unverified first-profile / second-profile / intervening-booking ordering | **Passed.** The second profile save is observed waiting on the actual operator advisory lock before the creator commits. A session-level copy of that same lock holds the queue while a two-dog booking commits. Releasing it makes capacity reduction reject with `P0001`; capacity remains two and all three days retain two allocations. No function instrumentation is used for this case. |
| Previously unverified exclusion wait across Stockholm midnight | **Passed with an injected clock.** The second sitter's booking is observed waiting on the first transaction's dog exclusion. Advancing the test clock across midnight and rolling back the first request releases the wait; the second request raises `22023` and leaves zero bookings, care rows or daily reservations. An otherwise identical control without crossing midnight succeeds. |
| Clock-test scope | Only `check_range`'s two `clock_timestamp()` expressions are substituted in a newly created test database. The shipped date predicate and Stockholm timezone remain intact. The real operating-system clock was not changed, and a real midnight transition was not awaited. This verifies the intended lock ordering and rollback, not a wall-clock endurance test. |
| 100 competing one-dog requests, capacity two, three inclusive dates | Exactly **two successes**, **six active daily allocations**. These are 100 queued application requests through the pool's maximum 12 connections, not 100 simultaneous database sessions. |
| Concurrent identical retry keys | Ten requests yield one booking; changed retry payload conflicts. |
| Cancellation / decline versus waiting replacement | **Passed deterministically.** Replacement waits for the sitter lock, then consumes released inventory after commit; a rolled-back cancellation leaves the original dog reservation and rejects the replacement. No partially released state survives. |
| Availability close / request | **Both commit orders passed deterministically.** Closing first rejects booking; booking first rejects closing. |
| Approval / cancellation | Existing concurrent test leaves one legal revision/status with matching active inventory. |
| Cross-sitter overlapping dog stays | Inclusive intersection rejects through the exclusion constraint; next-day stay is allowed. |
| Daily slot fragmentation, multi-dog and exclusive household care | Existing database tests pass; per-day allocation avoids the earlier continuous-slot false rejection. |
| Isolation matrix | Read Committed/Read Committed passes; Repeatable Read/Read Committed and Repeatable Read/Repeatable Read fail; Serializable/Read Committed fails; Serializable/Serializable passes. Finding 2 limits the generality of the locking claim. |

The runtime takes actor/request-key advisory locks, then sitter row locks and dog share locks in sorted order. Decisions lock sitter then booking. Capacity and dog exclusions provide an additional write barrier. The exclusion constraints protect occupancy against competing allocations, but do not independently enforce `sitters.capacity` after a profile edit; that check is procedural.

## Verified features and security findings

- **Owner/dog authority:** owners can manage several dogs; changing another owner's dog or booking another owner's dog fails. Composite foreign keys also bind dog/booking ownership. Selected dog IDs are validated before matching.
- **Tenant isolation:** two owners/two sitters are tested through RLS reads, booking detail, care rows and decisions. Unrelated authenticated booking reads/decisions return 404; unrelated lists are empty. Public results exclude owner IDs and care notes. The browser suite repeats an unrelated-sitter access attempt.
- **Role boundary:** runtime is a non-owner, non-superuser, non-BYPASSRLS role; direct reservation writes, auth-table reads and assuming the auth role fail. Transaction-local actor context clears after success and rollback. Definer functions have fixed search paths and explicit grants. An app process holding both credentials and the migration administrator are trusted, not RLS-sandboxed attackers.
- **Booking lifecycle:** price and care snapshots are immutable after profile changes; pending and confirmed bookings reserve inventory; owner/sitter cancellation and sitter decline release it atomically. Revision conflicts, price changes, own-sitter booking, unavailable dates, radius, size and service incompatibilities are rejected.
- **Authentication/session:** password hashes differ from plaintext; passwords are checked; a client cannot set `isActive`; cookies are application-prefixed, host-only, HttpOnly, SameSite=Lax, path `/`; normal sessions last approximately 24 hours. Tampered, expired and logged-out sessions fail. Inactive sessions fail, and inactive accounts cannot create a new session. The eleventh sign-in attempt hits the configured persistent limit. Foreign-origin auth writes and foreign/missing-origin domain writes reject in production mode. Cookies are used over the deliberate loopback HTTP demo origin; real HTTPS deployment security is not claimed.
- **Request/privacy handling:** strict schemas, parameterized SQL, exact domain mutation origins and private/no-store responses are present. Credentials/private forms cannot fall back to GET before hydration. Care access ends on decline/cancel and is date-scoped for sitters by RLS; owner snapshots persist. Expired-care policy was inspected, not tested through a live midnight browser transition.
- **Availability/dates:** inclusive 1–31-day stays and the one-year horizon are validated; the database rechecks booking dates after lock waits and after writes. Explicit availability must cover every day. DST/date and geography tests pass.
- **Matching:** the pure engine applies the documented hard filters, normalized weights, stable UUID tie break, and data minimization. Existing fixtures cover multiple dogs, service/size exclusions, resident dogs, geography, dateline/poles, weights, invalid input, privacy and dates. Search is advisory; SQL independently validates requests under locks.
- **Migrations:** fresh isolated schema creation and populated range-to-daily conversion pass; booking/care JSON is unchanged and two range rows expand to six daily rows with identical occupancy. Migration reruns pass; the runner serializes migration execution and checks checksums. The standalone's nine migrations remain unchanged and its migration regression tests pass. No standalone-to-marketplace data import is implemented or implied.
- **Single-sitter regression:** unit, integration and browser coverage passes as detailed above. Tested browser flows include invitations, shared stays/privacy, admin blocks, approvals, arrival/pickup proposals, cancellation/history, Swedish validation and mobile interaction. Marketplace desktop/mobile screenshots were inspected; the tested mobile page has no document overflow. This is not a full accessibility audit.

The synthetic ranking benchmark also passes its assertions. Node 25 results for 25 measured runs: 100 candidates / 21 eligible / p95 **0.32 ms**; 1,000 / 202 / **1.50 ms**; 10,000 / 2,040 / **11.46 ms**. This measures ranking in memory only. It does not validate database/network latency, matching quality, care safety or commercial demand.

## Hosted CI status and publication gate

**Not run on GitHub.** The branch remains unpublished; a read-only GitHub branch lookup returned no matching branch. No push or PR was attempted.

Static inspection supports safe execution on an ephemeral hosted runner: workflows use `push`/`pull_request`, `contents: read`, generated test credentials, local PostgreSQL, no repository/production secrets, no deployment step, and no `pull_request_target`. The standalone job includes audit and license checks; the separate secret job scans full Git history; the marketplace job initializes its own loopback cluster, runs checks/build/benchmark and browser tests. All three YAML files parse successfully.

The clean Node 22/macOS runs close the runtime/install gap, and Playwright Chromium is also exercised locally. **Ubuntu provisioning, apt-selected PostgreSQL binaries/extensions, hosted networking/browser libraries, GitHub token permissions, job timeouts and actual remote check results remain unverified.** Local success is not a substitute for those gates. Marketplace path filters mean a later documentation-only push may not launch its job; there is no manual `workflow_dispatch` trigger. See [GitHub workflow trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

After findings 1 and 2 are fixed and publication is separately authorized, the concrete steps are:

1. In this public checkout, rerun the full suites, retain the acceptance tests, update this report, and commit only the intended public code/test/report changes. Verify `git status --short`, `git diff --check`, the branch and `origin` (`https://github.com/vernerisirva/dogbooker.git`). Never publish the private-workspace history or `.local`/environment artifacts.
2. **Only with explicit push authorization**, run `git push -u origin codex/marketplace-foundation` from this checkout. The first publication includes marketplace implementation changes and should trigger all three workflows.
3. Run `gh run list --branch codex/marketplace-foundation --limit 10`, then `gh run watch <run-id> --exit-status` for each relevant run. Require successful `CI / validate`, `Marketplace prototype / local-prototype`, and `Secret scan / gitleaks` results for the exact candidate commit. Investigate failures; do not equate a queued/skipped job with a pass.
4. Record those run URLs and commit SHA here. Open a PR only if separately authorized. No deployment or merge is part of this review.

The new acceptance tests currently make CI fail on findings 1 and 2. Do not remove or skip them merely to obtain a green run. Hosted validation and the two fixes are the remaining merge-acceptance gates.

## Remaining limitations and readiness

**Merge readiness: not accepted yet.** Fix the two medium findings, rerun the expanded suite, then obtain the separately authorized hosted CI evidence. The inherited cancellation-boundary flake should be corrected or explicitly tracked. The previously unverified profile and midnight-exclusion scenarios no longer require speculative acceptance; their tested scope is described above.

**Production readiness: no.** This is still a local synthetic prototype. Existing documented limits include non-expiring pending holds, no booking admission limits, no transactional notification worker, no verified registration/recovery or sitter approval, no payments, no incident/support operation, no production monitoring/recovery or retention/deletion program, one operator/guardian per tenant/dog, an agenda cap of 200, and a search that scans published profiles. Structured compatibility depends on declarations and assumes household dogs can share. Those are declared future launch gates, not features delivered by this branch.

Not tested: production accounts/data, TLS/reverse-proxy deployment, external mail/payment integrations, failover/disaster recovery, multi-host load, real animal-care outcomes, exhaustive mobile/accessibility coverage or a real overnight clock transition. No claim of production certification is made.

## Final evidence checkpoint

Final expanded marketplace runs agree on Node 25.9.0 and clean Node 22.23.4: **14 passed / 3 failed unit tests; 31 passed / 3 failed database tests**. The 13 deterministic concurrency cases contain ten passes and three failing isolation combinations. Both production builds and all **17 browser tests** pass on Node 22 with Playwright Chromium 156.0.8078.4 (`CI=true`); all 17 also passed with installed Chrome on Node 25. Both applications' final type/lint checks pass. The license inventory is byte-identical after clean Node 22 regeneration.

Logs from the clean Node 22 run were copied into `.local/acceptance/node22/` and `marketplace/.local/acceptance/node22/`. Key evidence is `standalone-integration.log` (initial failure), `standalone-integration-repeat.log`, `node22/integration-node22.log`, `marketplace/.local/acceptance/integration-final.log`, `marketplace/.local/acceptance/unit-final.log`, the browser logs, `dependency-audit.json`, `secrets-history.log` and `secrets-source.log`. These are ignored local artifacts, not publication inputs.

All temporary `mp_acceptance_*` and `mp_migration_*` databases were removed; no server was listening on test ports 3000/3100 and no test database clients remained. The previously stopped disposable PostgreSQL cluster was stopped again, preserving only synthetic fixtures. The private checkout remains unchanged, public main remains clean at `7b9dadb`, and the reviewed branch remains at `bb34e1a` with only this report and three new test files uncommitted. No tracked application, migration, workflow or dependency file was changed by the review.
