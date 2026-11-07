# Marketplace implementation and verification

Completed 7 November 2026 on `codex/marketplace-foundation`, based on public v1.0.0 commit `7b9dadb`. Application/test implementation: `cb93f5c`. Documentation is committed separately.

## Working result

A separate local Swedish Next.js marketplace with synthetic account creation/login, multiple dogs per owner, private care notes, sitter profile creation/editing, coarse location/radius, price/capacity/services, explicit open dates, explained ranked matching, profile comparison, multi-dog booking requests, sitter acceptance/decline, owner/sitter cancellation and a private date-ordered booking agenda. UI includes loading/errors, empty states, labels, focus styles, mobile layouts and no-JavaScript credential protection.

Three initial sitter profiles, two owners and three dogs are seeded with 91 available dates and private generated demo credentials. Additional test accounts are synthetic. Price/care snapshots remain unchanged after profile edits. Exact addresses, real contact details, payments, emails and LLM calls are absent.

The database authorizes mutations, serializes changes, reserves daily slots, prevents global dog overlaps and releases inventory transactionally. Restricted runtime roles, row-level security, composite ownership keys, same-origin validation and minimized response fields protect tenant data. See [architecture](../MARKETPLACE_ARCHITECTURE.md) and [matching](../MATCHING_ENGINE.md).

## Verification evidence

All checks used dedicated local PostgreSQL 16.14, Node 25.9.0 and installed Chrome. CI targets Node 22. Browser screenshots were inspected at desktop and 390-pixel mobile widths; no horizontal document overflow or JavaScript page errors occurred in the tested main flow.

| Check                                        | Result                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Public standalone unit tests                 | 132 passed                                                                                          |
| Public standalone database integration tests | 93 passed                                                                                           |
| Public standalone browser tests              | 13 passed (`PLAYWRIGHT_CHANNEL=chrome`)                                                             |
| Marketplace unit tests                       | 14 passed                                                                                           |
| Marketplace PostgreSQL integration tests     | 19 passed, including migration preservation                                                         |
| Marketplace browser tests                    | 4 passed                                                                                            |
| Total automated tests                        | **275 passed**                                                                                      |
| Type checks / ESLint                         | Both applications passed                                                                            |
| Production builds                            | Both applications passed; no deployment performed                                                   |
| Dependency audit                             | Zero reported vulnerabilities in the public release lockfile (965 dependency entries)               |
| License inventory                            | 965 locked entries reviewed; no inventory changes                                                   |
| Secret scan                                  | Gitleaks 8.30.1 found no leaks in the staged implementation; final branch scanned before completion |
| Diff validation                              | No whitespace errors; standalone source/services/migrations/tests unchanged                         |
| Hosted CI                                    | Marketplace workflow added, not run remotely because branch was not pushed                          |

The first private-workspace baseline also passed its 227 tests. The final evidence above is from the sanitized public release, which has additional tests/hardening. The final branch does not include private Git history. Original workspace and public release main checkouts remain unchanged.

### Complete flow

| Boundary                 | Evidence                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Owner UI → API           | Chrome signs in, selects both Smulan and Atlas, searches and displays explained compatible sitter cards                            |
| API → PostgreSQL         | Party ownership, date/service/location checks, price snapshot and reservations exercised by real-database tests                    |
| PostgreSQL → owner       | Requested status and both frozen care profiles returned; owner sees total and reserved state                                       |
| Sitter authorization     | Selected sitter can approve/decline; unrelated sitter's GET and decision requests return 404                                       |
| Decision → inventory     | Decline/cancellation release all daily slots; concurrency tests observe legal final state                                          |
| Registration/profile     | Mobile browser creates a synthetic account, two dogs, a sitter profile and availability                                            |
| Privacy before hydration | JavaScript-disabled form is POST/inert and its login button disabled, so credentials cannot fall back to a query-string submission |

### Concurrency and migration

Exactly two of 100 competing one-dog requests succeed against capacity two over the same three-day interval. Ten identical concurrent request keys produce one booking. Changed retries conflict. Tests cover inclusive endpoints, cross-sitter dog overlaps, multi-dog capacity, exclusive non-social parties, cancellation/approval races, availability-close/request races, protected profile changes, pooled actor cleanup and invalid direct database calls.

A separate temporary local database installs the early schema, creates a populated two-dog/three-day booking, then runs the inventory migration and later hardening migrations. All booking and care JSON remains identical, and the six daily occupied units match the original expanded ranges. Migration reruns are no-ops. The temporary database is removed afterward. The standalone's nine unchanged migrations and regression tests run on a second local synthetic database.

### Independent adversarial review

A separate agent performed read-only static review and re-review. Findings resolved:

- Credential/private-form native GET fallback → POST plus hydration/inert protection.
- Continuous-slot fragmentation → daily allocations and regression/preservation tests.
- Lock waits across Stockholm midnight → date checks after row locks and after exclusion inserts.
- Concurrent first-profile upsert bypass → per-operator advisory serialization before profile lookup.
- Inactive sitters remaining searchable/bookable → active-account filtering in both paths.
- Null/negative revisions and out-of-bounds direct SQL coordinates → database checks.
- Search recommending an already-booked dog → owner-scoped active-overlap rejection.

Re-review found no remaining significant code finding within this bounded local prototype. This is not a production security certification. The controlled three-way initial-profile-save/intervening-booking race and a real midnight transition while waiting on an exclusion constraint were reviewed statically, not reproduced with a controllable clock/scheduler. The ordinary concurrent creation, stale decisions, date/DST logic and other contention paths are tested.

## Limits and next work

The slice is **ready for independent human review and local demonstrations**. It is **not ready for public deployment or commercial use**. The runtime deliberately refuses nonlocal database configuration.

Pending requests do not expire automatically. There are no booking admission limits, notification worker, email verification/recovery, sitter verification/approval workflow, payments, insurance/incident operations, messaging, reviews, production observability/recovery, multi-guardian/staff roles or full data-retention program. The private calendar is an agenda, not a month-grid editor. Profiles and search points are self-entered and coarse. Search scans all profiles; agenda returns at most 200 bookings. Care matching relies on declared structured facts and assumes same-household dogs can share; it is not animal-safety assurance.

The benchmark's 10,000-profile p95 of 10.72 ms covers ranking only, not database/network or measured safety/outcome quality. Add realistic end-to-end load tests and unbiased outcomes before claiming validated match quality or choosing infrastructure based on these numbers.

Next: human review, expiry/admission limits and transactional notifications; then trust/privacy and launch-jurisdiction decisions; then an approved payment design in test mode. [Roadmap and researched launch dependencies](../MARKETPLACE_ROADMAP.md).

## Handoff

- [Installation and demo accounts](README.md)
- [Architecture decision 001](docs/adr-001-separate-application.md)
- [Capacity decision 002](docs/adr-002-capacity-and-snapshots.md)
- [Progress and resumption](PROGRESS.md)
- Screenshots: `.local/marketplace-desktop.png` and `.local/marketplace-mobile.png` in this app directory (ignored local artifacts).

No private production database was contacted or migrated, no production secret/environment changed, no message sent, no deployment, no push and no merge performed.
