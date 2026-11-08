# ADR 004: persisted booking deadlines and transactional expiration

Accepted for local validation, 8 November 2026. No hosted deployment is authorized.

## Policy

A new pending request reserves the same daily capacity and global dog dates as before. Its `expires_at` is the earlier of the creation instant plus `booking_hold_policy.duration_seconds` (default 172800 elapsed seconds) and midnight starting `start_date` in `Europe/Stockholm`. The administrator-only singleton permits 1–604800 seconds; changing it affects only future requests. Runtime roles cannot edit policy or deadlines.

Stays are date-only and occupy whole inclusive calendar days. There is no arrival time from which to derive a safe same-day cutoff. Same-day requests are therefore rejected; tomorrow's request gets the remaining time until Stockholm midnight. DST changes alter the UTC midnight, not the elapsed duration. Equality with a deadline means expired.

Migration 0007 gives **every existing pending row a full fresh 48 hours from one database migration instant**, regardless of its original creation date. It changes no status, revision, original creation timestamp, care snapshot or reservation. Confirmed, declined and cancelled rows keep null expiration fields and their history. The schema has no separate approval/cancellation event timestamps to rewrite; its existing status/revision and immutable payload/snapshot history remain intact.

Legacy requests whose stays already began (or begin during grace) cannot be approved: both the decision function and status trigger enforce an independent Stockholm start cutoff. They retain the promised grace deadline and can be cancelled/declined until expiry, even for already-ended stays. This compatibility exception can retain legacy capacity for up to 48 hours; it is not a rule for new requests. The UI explains closed approval. No migration infers expiry from historical creation.

## Database authority

Expiration transitions `pending → expired` once, increments revision once, records `expired_at`, and releases every capacity slot and active dog reservation in the same transaction. The terminal state cannot be approved or resurrected. Confirmed bookings only permit explicit cancellation and never auto-expire. Decline and cancellation retain immediate atomic release. Immutable deadlines, allowed transitions and release are trigger-enforced in addition to the existing restricted function grants and exclusion constraints.

Approval is linearized at its serialized database transition, after sitter/booking waits and the inventory fence. An approval strictly before deadline can commit afterward and stays confirmed. At/after deadline a decision instead commits expiration. The service reads that resulting status and raises the Swedish 409 **after commit**; throwing inside the transaction would roll back cleanup. Start cutoff errors on legacy holds do not consume their grace.

The sitter-first order and migration 0006 MVCC write fence are retained. A lock alone does not invalidate a stale Repeatable Read snapshot; PostgreSQL requires a row version change for this protocol ([PostgreSQL consistency guidance](https://www.postgresql.org/docs/16/applevel-consistency.html)). Pending/confirmed capacity remains guarded by the same active-only exclusions. No exclusion predicate depends on time.

- Internal cleanup locks sitter, then due booking rows, then releases reservation/dog rows via the status trigger.
- A new request locks its target sitter plus any sitters holding the owner's selected dogs in expired pending bookings, in UUID order. It clears those holds before allocating capacity or hitting the global dog exclusion. Ownership predicates prevent cleanup selection from using another owner's dog IDs.
- Decisions lock sitter before booking. Profile/availability updates reconcile their sitter before checking commitments.
- Dashboard and search reconcile the actor's expired relationships. Search capacity also excludes logically overdue holds in its minimized availability projection. Actual allocation always performs transactional cleanup and retains exclusions.
- Sitter care RLS independently tests the persisted deadline; scheduler downtime cannot prolong private care visibility. Owners retain history/snapshots; unrelated owners/sitters cannot read a booking.
- A failure in any release rolls back status, revision, timestamp and all inventory changes. Repeated processing is a no-op. Same retry keys return the existing booking, including an expired one; a new request needs a new key.

Runtime uses the existing explicit Read Committed transaction wrapper, with at most three complete attempts only for proven abort SQLSTATEs `40001`/`40P01`, after rollback. It does not retry uncertain connection/commit failures; failed rollback discards the connection. Higher-isolation stale writers fail rather than silently violating inventory.

## Scheduler and outage recovery

`npm run holds:expire` is a one-shot local process using the existing restricted domain pool. Its granted database function requires no user session, accepts only a batch size of 1–500, can only expire due pending rows, and returns an aggregate count. It exposes no identifiers or arbitrary tenant mutations. It has no HTTP endpoint and no migration/admin credential.

The SQL worker locks eligible sitter rows in UUID order with `SKIP LOCKED` before booking rows, avoiding the deadlock caused by taking a booking lock before its sitter. Default runs commit up to ten batches of 100 transitions. Each transaction has a 2-second lock timeout and 10-second statement timeout. Existing bounded serialization/deadlock retries apply. Locked tenants can be skipped while independent tenants proceed. A short/zero batch is **not proof that the global backlog is empty** because busy sitters may have been skipped. `limitReached` indicates the processing cap, not an exact queue size.

A user systemd timer (or cron) invokes the command every minute. The calendar timer is persistent, and every scan selects all overdue pending rows without a lower time window or cursor. Missed runs, process death and partial batch completion recover on a later invocation. Previously committed batches remain committed; a killed transaction rolls back. A 360-second service timeout bounds a hung invocation; no daemon or always-running worker is needed. Failed runs exit nonzero; aggregate JSON logs contain status, counts on success, duration, and sanitized SQLSTATE only.

A permanent scheduler outage means inactive users' stored statuses can lag, but confirmation is still fenced, care access ends at the deadline, search does not count overdue capacity, and booking/profile/availability/history operations reconcile relevant holds. Underlying row flags are eventually cleaned by a restored scheduler. Production scheduling, monitoring and capacity sizing still need a deployment-specific review.

## Migration and verification

The existing migrator executes migrations and checksum ledger updates in one transaction under an advisory lock, skips applied matching checksums, and rejects altered applied files. Migrations 0001–0006 are unchanged. New migration 0007 is rerunnable **through that migrator**, not by replaying raw CREATE statements. Populated migration tests exercise rollback/reapply and preserve six pending/confirmed/declined/cancelled fixtures, including old creation dates and already-started stays. Other tests cover exact boundaries, DST, real and substituted clocks, observed lock waits under all three isolation levels, cancellation, independent tenants, bounded/repeated processing and failure rollback.

Future migration must not rename an expired booking back to pending or bypass the inventory fence. Payments, admission limits and trust systems remain separate milestones.
