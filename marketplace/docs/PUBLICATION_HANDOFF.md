# Current expiring-holds publication checkpoint

For branch `codex/marketplace-expiring-holds`, use [the current handoff](../../docs/MARKETPLACE_HOLDS_HANDOFF.md). Local implementation/review/validation are complete; publishing this new branch remains unauthorized. The foundation handoff below is retained as historical evidence and grants no authority for this feature.

---

# Marketplace publication handoff

Updated 8 November 2026. Independent acceptance: **PASS WITH NOTES**. This is a local marketplace foundation, not a production release.

**Closure update:** the single authorized external review completed and its four defect claims were independently adjudicated. All three checks passed on `5980e2bf41001816a0018dcc8cf98da3cb78ca76`. See [final review closure](../../docs/MARKETPLACE_FINAL_REVIEW.md). The historical publication/review preparation record below is retained; its statements that review is pending describe the earlier checkpoint. Merge, further publication and production deployment still require their own authorization.

## Published state

- Repository: [vernerisirva/dogbooker](https://github.com/vernerisirva/dogbooker).
- [Feature branch](https://github.com/vernerisirva/dogbooker/tree/codex/marketplace-foundation): `codex/marketplace-foundation`.
- [Draft PR #8](https://github.com/vernerisirva/dogbooker/pull/8), base `main` at `7b9dadbb3fc62d9b96421ed0ee3304b5cd6c1a06`.
- Reviewed publication: `c53a3d78c0fbaf077d5885396616c20606674c5b`.
- Tested CI correction: `0149cb06a0fdfd8d218632929fe8cadabfe33d85`.
- This handoff is a documentation-only follow-up. Application code, migrations, dependencies and assertions are unchanged from the accepted source. Its own commit must receive all three checks before it is treated as the final candidate. The PR body and ignored local publication checkpoint record the latest exact HEAD and check links after completion.

## Hosted results on corrective commit 0149cb0

| Exact check       | Workflow              | Result  | Evidence                                                                                                                                                              |
| ----------------- | --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`        | CI                    | success | [Run](https://github.com/vernerisirva/dogbooker/actions/runs/42504380976), [job](https://github.com/vernerisirva/dogbooker/actions/runs/42504380976/job/128803744131) |
| `local-prototype` | Marketplace prototype | success | [Run](https://github.com/vernerisirva/dogbooker/actions/runs/42504380921), [job](https://github.com/vernerisirva/dogbooker/actions/runs/42504380921/job/128803744220) |
| `gitleaks`        | Secret scan           | success | [Run](https://github.com/vernerisirva/dogbooker/actions/runs/42504380945), [job](https://github.com/vernerisirva/dogbooker/actions/runs/42504380945/job/128803744292) |

All push runs report the full corrective SHA above. All corresponding pull-request runs also succeeded: [CI](https://github.com/vernerisirva/dogbooker/actions/runs/42504385996), [marketplace](https://github.com/vernerisirva/dogbooker/actions/runs/42504385957), [secret scan](https://github.com/vernerisirva/dogbooker/actions/runs/42504385994). No required step was failed or skipped in these successful jobs.

Hosted test results: standalone **150 unit + 93 integration + 13 browser**; marketplace **76 unit + 69 integration + 4 browser**. Total **405 = 381 baseline + 24 independent cases**. Both lint/type checks and production builds passed. Standalone migrations ran twice successfully, the 965-entry license inventory matched, and the dependency audit reported zero vulnerabilities. Marketplace installed migrations 0001–0006, seeded synthetic accounts, passed migration/concurrency/auth regressions and benchmark, then built and passed Chromium. Source/history secret scans passed. Marketplace migration safe reruns also passed in the earlier local acceptance review; the hosted marketplace setup applies migrations once.

## Initial failures and exact correction

The first push at `c53a3d7` was not green. [Secret scan passed](https://github.com/vernerisirva/dogbooker/actions/runs/42503810291), but:

1. [Standalone CI](https://github.com/vernerisirva/dogbooker/actions/runs/42503810251) stopped at fixture safety validation before integration. Docker port forwarding exposes the container's server-side network address, whereas the hardened guard requires loopback. `.github/workflows/ci.yml` now provisions PostgreSQL 16 on the ephemeral runner, binds only `127.0.0.1:55438`, and creates `dogbooker_test` owned by a non-superuser synthetic login. The identity guard is unchanged.
2. [Marketplace CI](https://github.com/vernerisirva/dogbooker/actions/runs/42503810324) passed all 76 unit and 69 integration assertions but reported two unhandled `57P01` errors in independent-fixture teardown. The installed `pg-pool` removes clients before asynchronous disconnect completes; `pool.end()` can therefore resolve before the server closes them. The two acceptance fixtures now use ordinary `DROP DATABASE` after ending pools, allowing PostgreSQL to wait for disconnects. They no longer force-terminate closing clients. No assertion was removed, skipped or weakened; unexpected errors remain failures.

Corrective commit files: `.github/workflows/ci.yml`, `marketplace/tests/acceptance-concurrency.integration.test.ts`, `marketplace/tests/rereview-boundaries.integration.test.ts`, and `docs/MARKETPLACE_CI_HANDOFF.md`. Local Node 22 verification passed 69 marketplace and 93 standalone integration tests, marketplace lint/types, formatting, shell syntax and whitespace checks before push. Hosted success then verified Linux provisioning and the complete suites. Initial skipped build/browser steps were never counted as passes.

Both jobs use separate ephemeral runner-local PostgreSQL clusters, synthetic accounts and generated test authentication configuration. Neither workflow uses production credentials or deploys. No private source history, environment files, invitation tokens or real user datasets were published. Private production resources were not contacted or changed.

## Findings and readiness

Both original blockers remain resolved: connection parsing/precedence cannot reselect an unvalidated target or role, and the inventory row-version fence prevents stale snapshots from silently reducing capacity below bookings. Runtime functions, migrations and the three-attempt whole-transaction retry policy are unchanged by CI remediation. Independent regression assertions remain included.

The inherited cancellation precision finding remains **P3 / Low**, with its [unpublished issue draft](../../docs/issue-drafts/cancellation-timestamp-precision.md). The first local standalone integration run was **92/93**, followed by an unchanged **93/93** run. This is preserved in the [acceptance report](../../MARKETPLACE_ACCEPTANCE_REREVIEW.md). Truncation can misclassify the recent-history window by under one millisecond and make a test flaky; a rendered omission can persist until refresh. It does not alter stored audit timestamps, transactional cancellation, capacity release or authorization. Deferral remains justified for this foundation. No P3 fix or issue publication is included.

Technical acceptance for merging the local foundation is **PASS WITH NOTES**, subject to all three checks on the latest candidate. The PR remains draft. Additional independent model review is prepared locally and awaits approval; no model findings exist from this workflow. Merge authorization is separate. Production readiness is **NO**: hold expiry/admission controls, verified onboarding/publication, notifications, payment design where applicable, retention/deletion, backup/restore, monitoring, operational response and deployment validation remain launch gates.

## Independent review and resume boundary

The existing global `pr-review` version 1.2.0 was inspected and reused for offline packet/schema preparation. Its default DeepSeek configuration has prior reasoning-budget exhaustion records and is not proposed. A focused non-thinking Qwen3-Coder review with one fixed provider, bounded output/cost, no retry and no fallback is prepared separately. No live model request, connectivity self-test or paid review was made. Exact packet hash, model/provider metadata, costs, schema-validation results and disclosure scope are retained in the private local handoff rather than adding review tooling or credentials to this repository.

Resume from ignored `.local/publication/HANDOFF.md` and `PROGRESS.md` in the public-source checkout. They retain exact final HEAD, hosted links, sanitized logs and the prepared packet. Require explicit approval before sending the packet; any retry, model/provider change or application of resulting findings needs further approval. Do not merge, deploy, publish the P3 issue or access production as part of that approval.
