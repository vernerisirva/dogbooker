# ADR 002: daily slots, immutable care and explicit decisions

Accepted for the local prototype, 2026-11-07.

Use daily sitter capacity slots guarded by PostgreSQL exclusion constraints, plus a global dog/date exclusion. Only database functions can write domain records; they authorize participants, serialize sitter changes and reserve all requested days in one transaction. This avoids application-only count-then-insert races.

The first implementation assigned one continuous slot per stay. Independent review found that fragmented free slots can falsely reject an otherwise available interval. Migration 0003 converts populated ranges to per-day slots without changing bookings or snapshots. Tests exercise both preservation and the fragmentation case.

Pending requests reserve capacity. Decisions are revision checked; retries use an owner-scoped UUID and immutable payload. Decline/cancellation releases inventory atomically. The price is stored in öre; requested dog-care data is snapshotted so later profile edits cannot silently change accepted responsibilities.

No payment holds, expiry worker or fees yet. A pilot must add expiring holds, admission limits and notifications. No AI scoring can bypass the hard safety/capacity checks.

Updated 2026-11-08: the acceptance tests now verify exclusion-lock contention across Stockholm midnight with a clock substituted only inside a disposable database, and the three-way initial-profile/booking ordering with observed locks. The later acceptance review exposed stale-snapshot capacity edits; migration 0006 and [ADR 003](adr-003-connection-and-snapshot-boundaries.md) add the missing MVCC write boundary. The original lock-only protocol is insufficient at Repeatable Read or mixed isolation.
