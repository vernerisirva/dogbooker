# ADR 003: validated connections and snapshot-safe inventory writes

Accepted for the local prototype, 2026-11-08. Resolves findings 1 and 2 from the [independent acceptance review](../../MARKETPLACE_ACCEPTANCE_REVIEW.md). Re-review is still required.

## Effective connection configuration

The previous validator checked URL authority fields but passed the original string to `pg`. Driver query parameters could override host, port or role after validation. Environment settings and alternate administration/test connection paths also needed a single explicit policy.

Parse once and pass explicit driver fields, never `connectionString`, at the local boundary. Require a PostgreSQL scheme, loopback address, explicit credentials/port and simple database identity; reject all query parameters, fragments, raw whitespace, nonempty `PG*` variables and native-driver forcing. Set SSL and startup search path explicitly. Marketplace runtime further fixes host, port, database and pool-specific role. Generic standalone URLs cannot override it. Before each new connection is lent, verify actual database/server/login/current role and reject elevated privileges, role memberships, ownership and schema creation rights. No validator error contains input credentials.

Administration is a separate trusted boundary: fixed dedicated Unix socket/port, current OS user, explicit local authentication value (no `.pgpass` fallback), and allowlisted database names. Tests use generated names within that allowlist. Standalone synthetic-test mode uses the same parser, matching runtime/migration identities, explicit opt-in, loopback verification and the existing non-synthetic-account refusal. Its ordinary self-hosted mode remains independent. Browser fixtures always start their own validated local server.

This protects against accidental or adversarial configuration overrides, not a malicious local OS/database administrator or arbitrary code execution inside the server process. Local HTTP and socket trust remain prototype choices.

## PostgreSQL write protocol

`SELECT ... FOR UPDATE` orders writers but does not refresh an already-established Repeatable Read snapshot. A booking previously locked the sitter without updating it. An old profile-edit transaction could therefore miss that booking and reduce capacity below occupancy. Serializable on only the editor also failed when the booking used Read Committed.

Keep the existing authorization functions, lock ordering and exclusion constraints. Add migration 0006 with triggers that perform `UPDATE sitters SET capacity=capacity` for booking insertion/status change/deletion and availability changes. This creates a new MVCC row version, without changing visible profile data, on the same row used by profile edits and bookings. An older Repeatable Read/Serializable transaction cannot lock/update that version successfully: it aborts with `40001`. At Read Committed, waiting functions see committed state and recheck business invariants. Availability participates so an old booking snapshot cannot overlook a newly closed date. A no-op column assignment avoids a new externally visible version column or changes to established function signatures.

This follows PostgreSQL's guidance that a row lock alone does not protect a stale snapshot and an actual update may be needed: [application consistency](https://www.postgresql.org/docs/16/applevel-consistency.html), [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html). All runtime writes still go through the restricted functions; privileged direct SQL or disabled triggers are outside this guarantee.

Application transactions explicitly use Read Committed. Retry the entire database-only callback for `40001`/`40P01`, at most three attempts, after rollback. Never retry business/constraint failures or uncertain transport/commit errors. Discard a connection if rollback fails. Any future email/payment/external effect must occur after successful commit or through a transactional outbox. Direct higher-isolation callers must likewise retry the entire aborted transaction themselves.

## Consequences and verification

Pending and confirmed bookings still reserve identical inventory. Approval does not allocate again. Cancellation/decline releases all reservations atomically; rollback restores all of them. Per-day exclusions and global dog-overlap constraints remain intact. The same sitter serializes requests, profile changes, schedule changes and decisions; different sitters retain independent row locks.

The fence adds one sitter-row version per booking mutation and per changed availability row. That write amplification is acceptable for the bounded local prototype; production load, vacuum behavior and admission limits still need measurement. Immediate bounded retries favor simplicity; callers may receive a generic 409 under sustained contention.

Deterministic tests observe PostgreSQL's actual lock wait graph and use explicit barriers, not sleeps to choose commit ordering. They cover both booking/reduction orders at all three isolation levels, stale mixed-isolation snapshots, concurrent reductions, approvals, cancellation commit/rollback, schedule changes, full-transaction retry, retry exhaustion, actual deadlock recovery and disconnected-client disposal. Migration preservation includes profiles, availability, booking/care JSON and occupied days. [Exact run evidence](../../MARKETPLACE_BLOCKER_RESOLUTION.md).
