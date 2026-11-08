# Marketplace progress

## Current checkpoint — expiring holds, 8 November 2026

Branch `codex/marketplace-expiring-holds`, isolated public-history worktree based on requested merge `59c34186aab646020e40502227e87a9104af6a0c`. Implementation/test commit: `72414b59fafefe46fa1a094718ab18f6c5bf341c`.

- Implemented stored pending deadlines, terminal expired state, trigger-enforced atomic release, request-time reconciliation and a bounded actor-free one-shot worker with systemd/cron guidance.
- Preserved sitter MVCC fence, active-only exclusions, restricted connections/roles, RLS and bounded whole-transaction retries. Confirmed bookings never auto-expire.
- New holds default to 48 elapsed hours capped at Stockholm stay-start midnight; same-day requests are rejected. Legacy pending rows all receive a fresh full 48-hour migration grace, with a separate start-of-stay approval cutoff. No booking/history deletion.
- Swedish pending/expired states, deadlines, explanation and stale-decision refresh are complete. The independent actual-clock test verifies privacy before worker cleanup.
- **458 tests passed, none failed/skipped in final runs:** standalone 150 unit / 93 integration / 13 browser; marketplace 89 unit / 108 integration / 5 browser. Both builds, lint, TypeScript, migration reruns, worker smoke, unchanged 965-entry license inventory, zero-vulnerability audit, and secret scans pass.
- Independent local review: **PASS WITH NOTES**, with the initial migration-grace finding resolved and provenance preserved in [the review](docs/EXPIRING_HOLDS_REVIEW.md). The optional Qwen/OpenRouter packet is frozen offline, not sent; no API charge.
- Original P3 cancellation precision issue remains documented and unchanged. Hosted CI has not run for this feature. No push, PR, merge, deployment, scheduler installation or private production access.

Use [the expiring-holds handoff](../docs/MARKETPLACE_HOLDS_HANDOFF.md), [ADR 004](docs/adr-004-expiring-holds.md), and [operations](docs/HOLDS_OPERATIONS.md) to resume. The foundation records below are historical and retain their earlier counts and authorization states.

---

Historical implementation checkpoint. For final review, hosted checks and the completed external review, see [final review closure](../docs/MARKETPLACE_FINAL_REVIEW.md). Earlier verification counts and authorization statements below describe that checkpoint.

Updated 8 November 2026. Branch: `codex/marketplace-foundation`. Sanitized public release base: `7b9dadb`. Original implementation: `cb93f5c`; reviewed target: `bb34e1a`; original acceptance report/regressions preserved in `13482eb`; tested blocker fixes in `b13126d`.

## Location and boundaries

Use the public-source feature checkout on `codex/marketplace-foundation`.
Keep private installations and their configuration outside this checkout.

Use this public-history worktree, never the original private installation or the ignored initial private-workspace draft. No production resources, credentials or deployment were used. Both synthetic test databases live in the dedicated local cluster at `/tmp/dogbooker-marketplace-pg`, port 55438. Runtime accepts only its dedicated database and restricted roles.

## Current candidate

- Preserves Swedish multi-dog onboarding, sitter profiles, availability, explained matching, requests/decisions, immutable snapshots, tenant isolation and the public single-sitter application.
- Fixes connection-string and inherited-environment overrides with explicit validated driver options, actual runtime identity/privilege verification and local-only admin/test boundaries.
- Fixes stale-snapshot capacity reductions with additive migration 0006 and a shared sitter MVCC write boundary for booking/schedule changes.
- Explicit Read Committed runtime transactions retry only aborted serialization/deadlock failures, at most three whole attempts; uncertain failures do not retry and failed rollbacks discard clients.
- Retains all original acceptance assertions and adds deterministic contention, retry, deadlock, migration-preservation and adversarial configuration evidence.
- Updates architecture, installation guidance, ADR 003, implementation report and [blocker resolution evidence](../MARKETPLACE_BLOCKER_RESOLUTION.md). The historical [independent FAIL report](../MARKETPLACE_ACCEPTANCE_REVIEW.md) remains available; it has not been replaced by a self-issued independent PASS.

## Final verification

Clean Node 22.23.4 install, PostgreSQL 16.14 and Playwright Chromium 156.0.8078.4, only synthetic local databases:

- Standalone: **150 unit + 93 integration + 13 browser tests passed**.
- Marketplace: **63 unit + 58 integration + 4 browser tests passed**.
- Total: **381 passed, 0 failed/skipped**; all six originally failing regressions pass.
- Both lint/typecheck/production builds and migration reruns pass.
- Dependency audit: zero vulnerabilities; 965-entry license inventory unchanged. Gitleaks publishable-source and full-history scans pass.
- Existing standalone migrations and marketplace migrations 0001–0005 are unchanged; 0006 preserves populated data.

Concurrency checks use observed PostgreSQL lock waits and explicit barriers. They include the previously unverified first-profile/intervening-booking and injected-midnight exclusion cases, mixed-isolation stale snapshots, both booking/reduction orders, concurrent reductions/approvals, cancellation release/rollback and actual deadlock recovery. Logs are ignored under `.local/blockers/` at the root and marketplace, with final clean-install results in `node22/` subdirectories.

## Resuming

1. Read [blocker resolution evidence](../MARKETPLACE_BLOCKER_RESOLUTION.md), [implementation report](IMPLEMENTATION_REPORT.md) and ADR 003.
2. Reuse only this public worktree's ignored synthetic `.env.local` files. Do not import private production configuration. Clear nonempty `PG*` or `NODE_PG_FORCE_NATIVE` overrides.
3. Start the retained local cluster if stopped: `pg_ctl -D /tmp/dogbooker-marketplace-pg/data -l /tmp/dogbooker-marketplace-pg/server.log -o '-h 127.0.0.1 -p 55438 -k /tmp/dogbooker-marketplace-pg' start`.
4. In `marketplace/`, run `npm run db:migrate`, then `npm run dev`; open `http://127.0.0.1:3100`. Synthetic demo credentials remain in ignored `.local/demo-accounts.json`.
5. Setup/seed refuse to replace existing demo data. Run database/browser suites sequentially per application; they modify synthetic fixtures. Browser suites require their ports free and always start their own server.

## Readiness and next actions

Ready for independent re-review. Hosted CI is unrun because the branch remains unpublished. Obtain separate authorization before any push/PR/merge; require all three hosted workflows for the candidate SHA before merge acceptance. Production deployment remains out of scope and not ready.

The inherited P3 standalone cancellation cutoff loses sub-millisecond precision; current suites pass, but a targeted follow-up remains recommended. Production load/vacuum behavior, hold expiry/admission limits, notifications, trust/verification, payments, privacy/retention and operational recovery remain documented future gates.

## Cleanup

After verification, temporary acceptance/migration databases and test clients are gone, preview servers are closed, and the retained synthetic cluster is stopped. The private checkout was unchanged; public main remained `7b9dadb`. No push, PR, merge or deployment performed.
