# Expiring booking holds — local completion and publication checkpoint

8 November 2026. Branch `codex/marketplace-expiring-holds`, isolated worktree `.local/marketplace-expiring-holds` under the private workspace, backed by the separate public repository. Base is exactly `59c34186aab646020e40502227e87a9104af6a0c`. Implementation and tests: **`72414b59fafefe46fa1a094718ab18f6c5bf341c`**. The following documentation commit records validation/review; use `git log -2 --format=fuller` for both exact identities.

**Complete locally; ready for hosted CI after publication authorization. Not production-ready.** Nothing was pushed, no PR opened, no merge/deployment performed, and no private production database/resource was used. The original private checkout remains unchanged. Source and configuration stay in the separate public-history worktree; synthetic secrets/logs/packet are ignored.

## Implementation

- Migration 0007 adds persisted `expires_at`/`expired_at`, an expired terminal state, administrator-only duration policy, partial due index, lifecycle/release triggers, bounded expiration and participant reconciliation functions. Migrations 0001–0006 and all standalone application/migration code are unchanged.
- New holds default to 48 elapsed hours, shortened to midnight starting the stay in Europe/Stockholm. Date-only same-day requests are explicitly rejected. Config changes affect future requests only. Confirmed bookings never auto-expire; decline/cancel release immediately.
- Every legacy pending row gets the full fresh 48-hour migration grace, even if its original creation was years ago. Status/revision/history/snapshots/reservations are unchanged during migration. Already-started legacy stays cannot be approved, but retain the promised grace and may be cancelled/declined. This can temporarily retain capacity for up to 48 hours.
- All release/state/revision/audit writes are atomic. Expired requests cannot revive, including request-key retries. SQL clocks and constraints remain authoritative, with no time-dependent exclusion predicate.
- The one-shot `npm run holds:expire` uses the existing restricted pool, no user session/admin credential/HTTP endpoint, at most 1000 transitions by default in separately committed batches. It logs only aggregate counts/timing/sanitized SQLSTATE. Checked-in user systemd units and cron guidance schedule it without a daemon. CI now smoke-tests the command.
- Booking, search/history, profile and availability flows reconcile relevant expired holds. Search doesn't count overdue holds; sitter care RLS closes at deadline even before cleanup. Swedish UI shows all five requested status labels, pending deadlines and resubmission guidance, and refreshes stale decisions and pending history.

See [ADR 004](../marketplace/docs/adr-004-expiring-holds.md), [operations](../marketplace/docs/HOLDS_OPERATIONS.md), and [architecture](../MARKETPLACE_ARCHITECTURE.md).

## Verification evidence

Node **22.23.4**, PostgreSQL **16.14**, Playwright Chromium **156.0.8078.4**, separate synthetic local databases. Existing locked dependencies were reused through an ignored symlink; no dependency or lockfile change. Node 25 was also used for early focused tests, but final complete checks used Node 22. Logs are retained in ignored `.local/holds/`; browser screenshots under `marketplace/.local/`.

| Check                                                           | Final result                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Standalone unit                                                 | 150 passed                                                               |
| Standalone integration                                          | 93 passed                                                                |
| Standalone browser                                              | 13 passed                                                                |
| Marketplace unit                                                | 89 passed                                                                |
| Marketplace integration                                         | 108 passed                                                               |
| Marketplace browser                                             | 5 passed                                                                 |
| **Total**                                                       | **458 passed, 0 failed, 0 skipped**                                      |
| Both production builds, lint and TypeScript                     | Passed                                                                   |
| Standalone and marketplace migration reruns                     | Passed; applied matching checksums skipped                               |
| Populated new migration, rollback/reapply, history preservation | Passed                                                                   |
| One-shot worker                                                 | Passed actor-free, safe aggregate output                                 |
| Dependency audit                                                | Zero vulnerabilities                                                     |
| License inventory                                               | 965 locked entries, byte-identical inventory                             |
| Gitleaks 8.30.1                                                 | Publishable source, full public history, and offline review packet clean |
| Formatting and `git diff --check`                               | Passed                                                                   |
| Hosted CI                                                       | Not run for this unpublished branch                                      |

The original capacity and effective-connection regressions remain. The only existing concurrency fixture adjustment moves its real request date from today to tomorrow because new same-day requests are now forbidden; its simulated midnight, observed exclusion wait, all original outcomes and every assertion are preserved. New tests separately exercise the deadline boundary at minus 1ms, exact equality and plus 1ms, sitter-lock waits, both approval/expiration orders, and contending replacement allocations under Read Committed, Repeatable Read and Serializable. They verify unchanged MVCC conflicts, single capacity allocation, complete rollback/release, terminal idempotency, cross-sitter owner-dog reconciliation, independent-sitter progress while another is locked, interrupted batches, recovery, cancellation/decline, tenant/auth boundaries and four DST cases. A separate reviewer-added test uses the actual database clock and unmodified RLS/functions to prove care access closes before cleanup.

The existing matching benchmark passed (10,000 synthetic candidates: median 11.97ms, p95 14.84ms, max 17.85ms). This measures in-process ranking only, not database/worker load or production performance.

Validation history is not presented as an uninterrupted pass: initial sandbox attempts could not access shared memory/Unix sockets and ran no database checks; permitted local checks succeeded. The first new fixture omitted a required dog breed, then a simulated-clock privacy test advanced function clocks but not its RLS policy; both fixtures were corrected. The independent review found and resolved the full-grace policy mismatch before acceptance. A local unpublished migration iteration was refreshed transactionally in the synthetic development database with every booking retained; fresh disposable-database tests verify the final shipped migration from 0006. The first browser attempt lacked matching Chromium; installation resolved launch. The first running expiry browser assertion matched both the product alert and Next.js's blank route announcer; narrowing the test locator resolved it without a product change. Final suites above passed. The inherited P3 cancellation issue did not reproduce in this task's final standalone suite and remains unresolved.

## Independent review and optional external review

The separate local review context issued [**PASS WITH NOTES**](../marketplace/docs/EXPIRING_HOLDS_REVIEW.md). Its 28 content hashes match the implementation; provenance, the resolved P2 grace finding, initial failures, independent test evidence and scope limits are retained. It independently ran 38 focused integration tests, 13 unit tests and the actual-clock regression. Broader suite/build results above belong to the implementing context, not the reviewer.

Global `pr-review` **1.2.0** was inspected without modification. Offline preparation reused its collector/redactor/schema/parser/validator and the previously established one-provider Qwen workflow. The optional packet is **prepared only**, with zero inference/self-test requests and zero API charges:

- Candidate `72414b59fafefe46fa1a094718ab18f6c5bf341c`, 17 changed files plus 11 unchanged authority/context files; no prior verdicts or private data.
- Packet SHA-256 **`683465b76a9181c4458687f517ddc011a856952d2b9f3795131675911b1037c3`**, **133,525 bytes**.
- Proposed `qwen/qwen3-coder`, only `deepinfra/turbo`, 8192 output tokens, at most **$0.10**, exactly one request, zero retries/fallbacks/model switches. Availability/prices must be reverified before an authorized dispatch.
- One valid offline schema fixture accepted, fourteen malformed/truncated/mismatched fixtures rejected; scanner clean. No external-model verdict exists.

Exact request, readable context, manifest, strict schema, preparation script and approval plan are ignored at `.local/holds/openrouter-review/` (private file modes). Review packet scope/hash is stable across documentation-only commits. Do not run the bare CLI or the foundation's old dispatcher approval. Any new inference requires explicit approval of this exact unpublished-source disclosure, packet, provider/model and spending cap; recheck hashes and preserve actual request/model/provider/token/cost/validation provenance. Investigate returned claims independently.

## Remaining limits

- Legacy grace intentionally retains some already-started pending capacity temporarily, while approval is forbidden.
- User-facing statuses can lag while the app/scheduler is offline; authorization, start/deadline checks and RLS remain authoritative. Request reconciliation is not batch-bounded across an actor's entire history. High sustained backlog, starvation, load/vacuum and production monitoring remain unverified prototype limits.
- Scheduler units are supplied but not installed; Linux activation, persistent timer reboot behavior and hosted operations are not claimed from macOS one-shot/transaction-recovery tests.
- Preserve the inherited [P3 cancellation timestamp-precision issue](issue-drafts/cancellation-timestamp-precision.md). No standalone behavior was modified to address it.
- Hosted CI needs to run against the exact pushed candidate. The broader production gates (admission limits, notifications, onboarding, privacy/retention, backup/restore, monitoring and operational readiness) remain. Payments/trust systems were not added.

## Exact next authorization

Authorize **pushing `codex/marketplace-expiring-holds` to `vernerisirva/dogbooker` and opening a PR against `main`**, then run/inspect all three hosted workflows (standalone CI, marketplace prototype, secret scan) for that exact SHA. No additional code implementation is awaiting authorization.

That publication approval would not authorize merging, deploying, installing a production scheduler, modifying private production resources or executing the optional paid review. Each remains separate. Local app/test processes are closed and the retained synthetic cluster is stopped at handoff; start it using the marketplace README before resuming local tests.
