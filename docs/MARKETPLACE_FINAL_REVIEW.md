# Marketplace final review closure

**Technical verdict: PASS WITH NOTES. Production readiness: NO.**

Reviewed candidate: `5980e2bf41001816a0018dcc8cf98da3cb78ca76`, [PR #8](https://github.com/vernerisirva/dogbooker/pull/8), against main `7b9dadbb3fc62d9b96421ed0ee3304b5cd6c1a06`. This is acceptance of the isolated, synthetic, local marketplace foundation.

## External review and independent adjudication

One authorized Qwen3-Coder 480B review through DeepInfra returned **CHANGES_REQUIRED**. Its four defect claims were independently checked against the complete source, current migrations, installed authentication dependency and regression evidence. **All four claims are false positives as written; none justified an implementation fix.** The external verdict is preserved rather than represented as a model-issued pass.

| Claim | Adjudication and evidence |
| --- | --- |
| Coordinate validation permits extreme values | False positive. Sitter, search and booking schemas reject non-finite and out-of-range inputs before service work. SQL independently bounds booking coordinates. Existing geographic tests pass. |
| Booking availability has an unprotected last-slot race | False positive. Request and schedule functions lock the same sitter before checking/writing; the MVCC fence invalidates stale higher-isolation writers. Exclusion constraints add protection. Controlled races and the 100-request/capacity-two test pass. |
| Runtime database roles have excessive permissions | False positive as stated. No specific unnecessary privilege was established. Domain writes are limited to explicitly granted, actor-checked functions; RLS scopes reads. Real-role tests reject direct writes, trigger bypass and role switching. The authentication adapter's CRUD access to identity tables is an explicit trusted boundary. |
| Expired sessions remain usable without client-side handling | False positive. Cookie caching is disabled, every API request validates the server session, and the installed adapter rejects expired records. The production-mode regression expires a valid session in PostgreSQL and observes HTTP 401 with the same cookie. |

The model's suggestions for concurrency and privilege-escalation tests overlap existing coverage. Retaining the broader coordinate matrix is worthwhile: a separate proposed test file adds 72 invalid-input, 24 accepted-boundary and 64 finite-distance cases. All 160 pass alongside the existing 76 marketplace unit tests; lint and TypeScript pass. This proposal is not part of the reviewed PR or its hosted test count.

## Verified candidate and checks

All three exact check names succeed on the candidate; both push and pull-request runs are successful, with no required step skipped:

- [`validate` — CI](https://github.com/vernerisirva/dogbooker/actions/runs/42504795271/job/128804991639)
- [`local-prototype` — Marketplace prototype](https://github.com/vernerisirva/dogbooker/actions/runs/42504795256/job/128804991436)
- [`gitleaks` — Secret scan](https://github.com/vernerisirva/dogbooker/actions/runs/42504795284/job/128804991581)

Hosted logs confirm **405 tests**: standalone 150 unit / 93 integration / 13 browser; marketplace 76 / 69 / 4. Both lint/type checks and builds pass. Migration preservation/reruns, dependency audit and source/history secret scans passed within their documented scope.

Both original acceptance blockers remain resolved. Standalone domain services/routes, migrations and dependencies are unchanged. Main is unchanged, is an ancestor of the candidate, and GitHub reports no merge conflicts. These are acceptance-required checks; repository protection is not currently configured to enforce them.

## Remaining notes and limits

- **P3 — inherited cancellation precision:** `src/lib/booking-service.ts:171` converts the database clock to millisecond precision before the recent-cancellation query. The first local integration run was **92/93**; its unchanged repeat passed **93/93**. Preserve that failure. Deterministic evidence shows sub-millisecond display-window errors; stored timestamps, cancellation, capacity release and tenant authorization are unaffected. Deferral remains acceptable for this foundation. The [issue draft](https://github.com/vernerisirva/dogbooker/blob/5980e2bf41001816a0018dcc8cf98da3cb78ca76/docs/issue-drafts/cancellation-timestamp-precision.md) remains unpublished.
- **P3 — documentation metadata:** `marketplace/PROGRESS.md:7–8` contains workstation-specific paths; that file at line 50 and `MARKETPLACE_ACCEPTANCE_REVIEW.md:147` also include a private checkout identifier. These are unnecessary internal metadata, not credentials or user records. A separate documentation cleanup is recommended; no history rewrite is implied.
- Test coverage is substantial but not exhaustive. The contention test uses a 12-connection pool, midnight coverage substitutes the clock in a disposable database, and the benchmark measures ranking only. Production TLS, multi-host load/failover, operations and real care outcomes are unverified.
- Pending-hold expiry/admission controls, verified onboarding/publication, transactional notifications, privacy retention/deletion and operational readiness remain launch gates; payment design is required where applicable.

Marking the PR ready for human review and requesting merge authorization are technically reasonable with these notes disclosed. Prefer the small metadata cleanup before merging; if new commits are authorized, recheck the resulting exact HEAD and all three checks. No merge, deployment, issue publication or further paid review is authorized by this report.
