# Marketplace progress

Updated 8 November 2026. Branch: `codex/marketplace-foundation`. Sanitized public release base: `7b9dadb`. Original implementation: `cb93f5c`; reviewed target: `bb34e1a`; original acceptance report/regressions preserved in `13482eb`; tested blocker fixes in `b13126d`.

## Location and boundaries

Worktree: `/Users/vernerisirva1/Documents/ChatGPT/DogBooker/.local/marketplace-foundation`.
Public source checkout: `/Users/vernerisirva1/Documents/ChatGPT/DogBooker/.local/public-release/dogbooker`.

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

After verification, temporary acceptance/migration databases and test clients are gone, preview servers are closed, and the retained synthetic cluster is stopped. Private main remains `5142775`; public main remains `7b9dadb`. No push, PR, merge or deployment performed.
