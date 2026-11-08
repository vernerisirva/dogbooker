# Marketplace architecture

Status: local functional prototype with expiring holds, 8 November 2026. No production rollout. Branch `codex/marketplace-expiring-holds` starts from the foundation merge `59c34186aab646020e40502227e87a9104af6a0c`; private installation history/resources remain outside scope.

## Decision: separate application and database

The single-sitter app's identity is owner-account-as-dog; its administrator intentionally sees every booking and its singleton windows/availability are global. Retrofitting tenant IDs would require auditing all booking, reminder, invitation, notification and shared-calendar queries and would create a dangerous partial-migration state.

`marketplace/` is a separate Next.js application and local PostgreSQL database. It shares locked npm dependencies, the pure Stockholm date helper, hydration hook and local PostgreSQL configuration validator. Standalone routes, domain services and SQL migrations are unchanged; its synthetic-test connection and browser tooling now reject unsafe configuration. Ordinary self-hosted database configuration remains supported outside synthetic-test mode. Root TypeScript excludes the new app; ESLint ignores its generated files. Separate auth cookies and origins prevent accidental session reuse.

Trade-off: duplicated auth configuration and UI styling, and SQL/TypeScript validation that needs parity tests. This is smaller and safer than a tenant retrofit or premature shared domain package. A later standalone-to-marketplace import needs consent, dog mapping and new account activation; no automatic import is provided. See [ADR 001](marketplace/docs/adr-001-separate-application.md).

```mermaid
flowchart LR
  Browser[Swedish owner / sitter UI] --> Auth[Independent Better Auth]
  Browser --> API[Validated marketplace API]
  Auth --> AuthDB[Auth role: identity tables only]
  API --> Scope[Verified actor + transaction-local context]
  Scope --> Read[RLS-protected reads]
  Scope --> Functions[Database booking/profile functions]
  Functions --> Inventory[Daily slots + dog exclusion constraints]
  Read --> DB[(Separate local PostgreSQL)]
  Inventory --> DB
```

## Model and isolation

| Table                                                     | Ownership and privacy                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`, `session`, `account`, `verification`, `rateLimit` | Better Auth identity; separate auth role; not accessible to domain runtime                                                                                |
| `sitters`                                                 | One operator per sitter tenant in this slice; a user may also own dogs. Only that operator reads the base row. Search uses a minimized public projection. |
| `dogs`                                                    | Many per owner; owner-only RLS. Size, integer age, optional breed, explicit sociability, required care, preferences and private notes.                    |
| `availability`                                            | Explicit open dates per sitter. Only the operator reads the full schedule. Search gets eligibility booleans, not other guests or reservation counts.      |
| `bookings`                                                | Owner + sitter relationship, inclusive dates, immutable price and retry payload, status/revision. Only parties can read.                                  |
| `booking_dogs`                                            | Composite owner/dog and booking/sitter/owner foreign keys; immutable care snapshot and global active-dog overlap exclusion.                               |
| `reservations`                                            | Daily capacity slots; active sitter/slot/date overlap exclusion. No runtime read/write access.                                                            |

The domain role `marketplace_app` is neither owner, superuser nor BYPASSRLS and cannot write tables, read auth tables, assume the auth role or create schema objects. RLS protects private reads. Each request sets the verified UUID with transaction-local `set_config`; commit/rollback clears it before the pooled connection is returned. IDs sent by a browser never establish ownership. There is no global administrator bypass.

Writes use explicitly granted `SECURITY DEFINER` functions, owned by the local migration administrator. Their fixed `search_path`, bound arguments, actor checks and restricted grants are part of the security boundary. Table-owner bypass is intentional inside these functions; RLS is not claimed to sandbox the migration administrator or a compromised application holding both credentials. Production requires separate protected migration credentials, audited operator access, secret rotation and independent database-role review. Do not enable ordinary owner/admin credentials for runtime.

Both runtime pools construct explicit driver options from validated PostgreSQL URLs. They accept only `127.0.0.1:55438/dogbooker_marketplace`, each pool's named role and explicit credentials; query parameters, fragments and nonempty `PG*`/`NODE_PG_FORCE_NATIVE` overrides are rejected. Neither generic `DATABASE_URL` nor migration URLs are fallback sources. An awaited connection hook verifies the actual database, server address/port, login/current role and restricted privileges before lending a new connection. Setup/migration/test administration uses a fixed Unix socket and an allowlist of local database identities. Errors never echo the supplied URL. The OS, dedicated local cluster administrator and application process are trusted; these checks do not authenticate a server against a malicious local administrator or sandbox arbitrary code execution.

Search has no owner identifiers, email, private notes, booking IDs or exact home addresses. Coarse points are stored with two decimal places; distance is approximate straight-line distance. Care snapshots are shared with the chosen sitter when a request is submitted, as explained in the UI. Sitter care access ends on decline/cancellation/expiry or after the final Stockholm date; the expiry deadline is enforced by RLS even before cleanup runs; owners retain their snapshots. Search never reads the notes for scoring. Owners should not put human medical or contact information in notes. Retention/deletion is a launch gate.

## Reservation rules

- Boarding only, SEK integer öre per dog per inclusive calendar day, `Europe/Stockholm`. One-day stays consume one day. Maximum 31 days and one-year horizon. These demo charging semantics are not a commercial policy.
- One booking can contain 1–5 distinct dogs owned by the caller. Global dog exclusion prevents an active dog staying with two sitters on intersecting inclusive dates.
- Pending and confirmed requests consume the same capacity. Decline/cancel/expiry releases all daily slots and active dog reservations atomically. New pending holds persist a configurable deadline (default 48 elapsed hours, capped at the stay’s starting Stockholm midnight); confirmed bookings never expire. Legacy pending rows receive a full 48-hour migration grace, with approval independently forbidden once the stay begins. See [ADR 004](marketplace/docs/adr-004-expiring-holds.md) and the [worker runbook](marketplace/docs/HOLDS_OPERATIONS.md).
- Social dogs consume one slot each per day. Any non-social dog requires no resident dogs and reserves all sitter slots for that household party. Within-party compatibility is assumed to be the owner's responsibility; unknown sociability is rejected. A pilot needs a fuller, reviewed safety checklist.
- Requests take an actor/key advisory lock, affected sitter row locks in UUID order (target plus expired holds for the owner’s dogs), reconcile those holds, then take dog share locks in UUID order. Each day allocates available slots separately. Unique/range exclusions remain a second concurrency barrier. Whole transactions roll back on any failing day.
- Date validity is checked before work, after row locks and after potentially waiting exclusion inserts, using the database clock in Stockholm. Cancellation/decision validates revision after locks. A race yields one legal state, not duplicate capacity.
- Request UUIDs are unique per owner; identical normalized payloads return the same booking, changed payloads conflict. Quoted daily price is checked and total calculated in SQL. Profile edits do not rewrite existing price or care snapshots.
- Sitter profile writes serialize even during first creation. Capacity, resident-dog, size and care-capability changes are blocked while future active commitments exist. Closing dates with active bookings is rejected. Published profiles belonging to inactive accounts cannot receive new requests.

Migration 0006 adds a shared MVCC write boundary: booking inserts/status changes/deletes and availability changes write a new version of the same sitter row that profile changes lock. A row lock alone did not invalidate old Repeatable Read snapshots. Now a stale Repeatable Read/Serializable writer aborts with `40001`, even when the intervening booking used Read Committed. Runtime transactions explicitly select Read Committed and retry the entire database-only callback at most three times for `40001` or `40P01`, only after rollback. They never retry business conflicts or uncertain connection/commit failures; a failed rollback discards the connection. Existing exclusions and function-level checks remain required. See [ADR 003](marketplace/docs/adr-003-connection-and-snapshot-boundaries.md) and the [remediation evidence](MARKETPLACE_BLOCKER_RESOLUTION.md).

## API contract

All endpoints are under `/api/marketplace/`. The API uses Better Auth sessions, active-user checks, strict Zod input, parameterized SQL, exact same-origin JSON for mutations, and `private, no-store` responses. Database errors are mapped to Swedish generic errors without query/credential exposure.

| Method / resource             | Result / authority                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET `me`, optional `?id=UUID` | Own dogs, own sitter profile/open dates, party bookings and permitted care snapshots; unrelated IDs return 404              |
| POST `dogs`                   | Create/update caller-owned dog; caller cannot set owner                                                                     |
| POST `sitter`                 | Create/update caller's sitter profile; caller cannot choose operator                                                        |
| POST `availability`           | Open/close caller's dates                                                                                                   |
| POST `search`                 | Dates, coarse point, owned dog UUIDs → matching version, ranked matches, scores/explanations, excluded profiles/reasons     |
| POST `bookings`               | Search input + sitter UUID + expected daily price + retry UUID → booking UUID                                               |
| POST `decisions`              | Booking UUID, expected revision, `confirmed`/`declined`/`cancelled`; only the sitter accepts/declines, either party cancels |

Service functions take verified actor IDs, not sessions or browser-supplied actor objects. Future adapters must authenticate separately and call this boundary; neither raw SQL nor a matching result authorizes a booking. A future reranker can reorder eligible match IDs only.

## Limits before a pilot

One operator per sitter and one guardian per dog; no household/staff invitations. Explicit dates instead of recurring schedules. Agenda capped at 200 bookings; no production pagination. Search scans all synthetic published profiles and is not a PostGIS-scale directory. No payment, messaging, outbox, fraud controls, identity/permit verification, production recovery or operational monitoring. Coarse locations are self-entered. See [roadmap](MARKETPLACE_ROADMAP.md) for gates rather than treating these as launch-ready defaults.
