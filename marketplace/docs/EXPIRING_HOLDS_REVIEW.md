What this change does: Pending booking requests receive a persisted expiration deadline. Expiration releases capacity and dog exclusions atomically, while owners and sitters retain booking history; a bounded worker and request-time reconciliation recover overdue holds.

**Verdict: PASS WITH NOTES.** No unresolved must-fix defect was established in the implementation identified below. This accepts the local feature's code within the existing prototype boundary. It does not establish production readiness or authorize publication, deployment, or scheduler installation.

**Provenance.** Independent review on 8 November 2026 in a separate Codex review context, against base and checkout HEAD `59c34186aab646020e40502227e87a9104af6a0c`. The feature was an uncommitted working-tree change during review. Findings were sent to the implementing context; that context made the implementation corrections. The reviewer changed no implementation files and added only this report and `marketplace/tests/holds-realtime.integration.test.ts`. No external review provider received source code. No push, deployment, private database, or production resource was used.

The review followed `AGENTS.md`, the Ponytail review guidance, the existing marketplace architecture, ADRs 002/003, and the prior acceptance/final-review evidence. It traced the new migration into the existing grants, row-level security, daily exclusions, sitter write fence, transaction wrapper, service callers, API route, UI, worker, migration runner, and tests. Prior reports and passing tests were supporting evidence, not substitutes for reading those paths. Assumed load is the documented local prototype, with concurrent application connections and overlapping worker invocations; sustained public-marketplace traffic is outside this acceptance.

**Resolved finding.**

1. **[P2 / Medium, resolved] Legacy bookings initially received less than the required migration grace.** The first inspected version of `marketplace/migrations/0007_expiring_holds.sql:15` used `least(migration_time + 48 hours, stay_start)`. A legacy request starting tomorrow received less than 48 hours; one already started became immediately due. Historical creation time was correctly ignored, but the separate start-of-stay approval rule did not justify shortening the explicitly requested migration grace.

   The final migration gives every legacy pending row the full fresh 48 hours. A separate approval cutoff is checked in `decide_booking` and in the lifecycle trigger after locks (`0007_expiring_holds.sql:47`, `:236`). Started legacy requests cannot be approved, but may be cancelled or declined before their stored deadline. The populated migration regression preserves all six bookings, revisions, existing timestamps, care snapshots and reservations, and verifies the fresh deadlines, transactional rollback, blocked approval, and permitted cancellation. This closes the finding. Legacy holds may retain capacity during that grace even after their start; that is the explicit compatibility trade-off, not an unnoticed early-expiration policy.

**Correctness and security assessment.**

- New holds use the database clock and persisted administrator-only duration, capped at Stockholm midnight at stay start. Same-day requests fail closed. The guard runs after the existing alphabetical `booking_inventory_fence` trigger, so its clock check occurs after the sitter write can wait. A second check after allocation rejects a hold that elapsed during an exclusion wait. The accepted transition can commit after its deadline if it already won the serialized approval before that deadline; the worker cannot reverse a confirmed booking.
- Expiration, revision increment, audit timestamp, reservation release and dog-exclusion release occur in one transaction. The final status drives the release trigger. A failed release rolls back the status too. Repeated expiration does not increase revisions or rewrite audit timestamps; expired requests cannot be resurrected. Identical request-key retries return the existing identity and reconcile its overdue state.
- Supported writers retain sitter-before-booking ordering. Cross-sitter cleanup locks affected sitters in UUID order. The existing sitter MVCC write fence remains active on booking status updates, so an older Repeatable Read or Serializable writer fails with `40001` instead of approving stale inventory. Daily capacity exclusions and global dog overlap exclusions remain unchanged and remain the final barriers. Search is advisory: contention or time moving during a request can still produce a safe conflict requiring a later user retry.
- The actor-free worker exposes only due-row expiration and an aggregate count. Internal targeted helpers and triggers are not executable by runtime roles. Existing functions retain actor/party checks and restricted grants; no table-writing privilege is added. `reconcile_actor_holds` requires an active actor and derives sitter scope from that actor's existing relationships. Unrelated booking reads and decisions remain excluded.
- Sitter care access checks the persisted deadline even while a due row still says `pending`; owner access remains. The independent actual-clock test verifies that property with the unmodified RLS policy, without relying on the worker or substituted clock. No booking, care, owner, dog, credential, or raw error-message fields are added to worker logs.
- A worker transaction handles at most 500 holds; the default invocation handles at most ten batches of 100. Each batch commits separately. `SKIP LOCKED` lets a concurrent invocation make progress on another sitter. The existing transaction wrapper explicitly uses Read Committed, retries only `40001`/`40P01` after rollback, and stops after three attempts. It does not replay business conflicts or uncertain connection/commit failures. Worker queries have two-second lock and ten-second statement timeouts; failure propagates to a nonzero process exit. The next invocation can recover without duplicate release. A count below the batch size is not proof that no due rows remain, because locked sitters may have been skipped.
- Migration 0007 is additive and runs within the existing checksum/advisory-lock migration transaction. Its single materialized migration clock gives all pending rows the same full grace independently of old `created_at`; terminal and confirmed rows receive no deadline. The migration does not expire or delete legacy history. UI decisions refresh on failure as well as success; pending views refresh every 30 seconds and on focus. The database remains authoritative while a displayed view is stale.

**Independent validation.**

| Check run by this review | Result |
| --- | --- |
| Hold behavior and populated migration suites | 38/38 passed |
| Hold worker/formatting unit suite | 13/13 passed |
| Separate real-clock probe, then retained regression | Both passed; retained test 1/1 |
| Lint of the reviewer-added regression | Passed |
| `git diff --check` | Passed |

The integration suites use generated `mp_acceptance_*` / `mp_migration_*` disposable databases on the fixed local socket and remove them afterward. They do not use the main marketplace database. The independent regression configures a two-second hold, observes PostgreSQL's exact `expires_at <= clock_timestamp()` predicate with a five-second bounded poll, and checks pre-expiry sitter access, post-expiry denial before cleanup, retained owner history, outsider isolation, revision/state changes, both inventory releases, and repeat-sweep no-op.

Disclosed failures: the first invocation was stopped by the sandbox's Unix-socket `EPERM` and ran no tests. The first permitted hold-suite run passed 36/37: its simulated function clock advanced but its RLS policy still used the real clock, so the test expected privacy to end before the policy's actual deadline. The implementer corrected only the disposable test policy clock; the final 38-test run passed. The independent real-clock probe and retained regression separately establish the actual policy behavior. These results must not be described as every initial invocation passing.

The previously inherited standalone P3 cancellation timestamp-precision finding is deliberately outside this change. This review neither fixes it nor treats an unchanged repeat as erasing its earlier failure.

**Inspected content identity.** SHA-256 values below identify the final source/test/configuration content inspected by this reviewer. They identify a working-tree snapshot, not a commit-wide certification. Prior architecture/review documents were consulted as context; subsequent documentation additions and the implementing context's broader validation are not represented as independent reruns here.

```text
063098f6cb31bb44c6f8fbea25b3876de7ee1e5f7d00a50dbab506f6415eb7f0  AGENTS.md
ceb481ff6dc42b84b27fa95ec42d0679547d30d4d067f869611e9b6df18ec2b7  marketplace/migrations/0001_foundation.sql
4da384946b910ed8d9a1ec0db5aa04f41093fb8da5a3835656f9ddb5143a26d4  marketplace/migrations/0003_daily_inventory.sql
55b68166e0d3bced34ec9ed475dcc624d1d9a12fcc73bdad6c9e367aa1795e4e  marketplace/migrations/0004_review_hardening.sql
8f98dfecfe04caae803a00d2baad39e0fa1e90ebf2c4386e95e4463cd7d6a644  marketplace/migrations/0005_post_write_date_check.sql
3b8c9c326c979863c549c73e98aca33fac2e22dc3503dd881be76da700947d95  marketplace/migrations/0006_inventory_snapshot_fence.sql
0b2477716d509aad75838b67c379b6ec5c7e6bc231abdffa5f502734658776f5  marketplace/migrations/0007_expiring_holds.sql
60a61ea947a6c67a9cada08f4cd254b1fc4700d5531cfad651daf3a29d3bc7b9  marketplace/lib/db.ts
73ff459d3d8f30a29dac6e663d9a13255da4d49aff27ff9da1dead69ab61c257  marketplace/lib/connection.ts
b1eefbe81ee41381c87c449a967b29feb48ae01b9326f381463483412d29ed50  marketplace/lib/validation.ts
9398dac123145408b14e264b45629b66e43f775e56c6030ac4aa33552c2ef4b9  marketplace/lib/service.ts
cb77d98ea5d95b09547f3f6e924489ea7e2e84c13b61edddae204e9304d49dec  marketplace/lib/http.ts
419949458f353646418a0e22536c0f06013fc4a7290b26fc4e7726dea633511e  marketplace/lib/expiration-worker.ts
5d5439f1b06db8f941ece10eb1260864f27690e9e3f46f3d82354d5acb6bde52  marketplace/lib/hold-display.ts
7fe135d3b9e7db7c87b104634e676be68239ee67772072496e42c361a97289a8  marketplace/app/ui.tsx
1a79430a09f7aea2bb94799f5e7815be4ca6053dc45dada94555d91f5e246550  marketplace/app/api/marketplace/[resource]/route.ts
ca7e91b7dda866479029ebf1b002816ce44e8cf0f77da6c4276ccf1037e71dc0  marketplace/scripts/migrate.ts
96601237e8cdc0cab53426bb751ad56dd0bddf6e7f696fba0677bfa378e22745  marketplace/scripts/local-admin.ts
0c52b18e179ac807963b4a405cae1e17db741008125aea0b891c2706ad115ca8  marketplace/scripts/expire-holds.ts
9e7023b1723734d9fed6748777758ca986f3d765dc77222caedc557af4c6ead6  marketplace/package.json
775bc1427ccfcb511c3ff386246ce9e3f2ef5c94db139645028ec50db4437dcf  marketplace/ops/dogbooker-holds.service
72bcd6f62757504b8112109cbd111d61de274d099ab9f1064887252084a697ee  marketplace/ops/dogbooker-holds.timer
2e1502eb4add0553ee35f849a3897cc1dcf1caf27a14aa5fc3980b244173916d  marketplace/tests/holds.integration.test.ts
349f5adb0af9a8b1c043557b70fe0d464e97732b1c519d9c77083240cd14904d  marketplace/tests/holds-migration.integration.test.ts
ff47014742368233eabf45115bbd528cc768534ed94517dc33bc3130218824b4  marketplace/tests/holds-realtime.integration.test.ts
759bcda794d05738e57c1fcf5647ed8806a3a9015ff7cb29af6078dded9cbbbf  marketplace/tests/holds.unit.test.ts
fbc066b60ab54dc5a37f8a15382ed655e1ed19a6c463f9353afcb9683ad43af9  marketplace/tests/acceptance-concurrency.integration.test.ts
943d1e16d8f98dab133ed82dd5c2f6ee8b1c421350384698161acb0d9d99a606  marketplace/tests/transaction.integration.test.ts
```

**Not checked:** full application/browser/standalone suites, hosted CI, an installed scheduler, actual machine restart recovery, sustained backlog/load or starvation, production TLS/credentials/monitoring, or a live Stockholm midnight/DST transition. The implementing context owns the wider validation. Application reconciliation can process an unbounded number of an actor's overdue sitters and holds; the bounded worker and existing prototype scale do not establish production response-time guarantees.

Verdict: Ship this local feature after the enclosing task's required checks pass, with the migration compatibility trade-off and operational limits above retained.
