# [P3] Preserve PostgreSQL precision in recent-cancellation cutoffs

Severity: **P3 / Low**, inherited standalone behavior. Source: `MARKETPLACE_ACCEPTANCE_REREVIEW.md`, finding 1, in the marketplace foundation branch.

## Problem and reproduction

`src/lib/booking-service.ts:171` reads `clock_timestamp()` through `pg` as a JavaScript `Date`. JavaScript retains milliseconds; PostgreSQL retains microseconds. The rounded value is bound back into the recent-cancellation query at lines 189/196. Both its exclusive 24-hour lower bound and inclusive upper bound can therefore be wrong.

The first full acceptance run failed `tests/integration/cancellation-history.test.ts:90`: **92 passed, 1 failed**. The unchanged full repeat passed **93/93**. The fixture at line 84 creates a cancellation exactly 24 hours old. Its timing makes the assertion sensitive to rounding. That run did not record exact timestamps; the deterministic probe below establishes the underlying defect independently.

With an exact clock of `2026-11-08T10:00:00.900900Z`, the driver/JavaScript round trip produces `2026-11-08T10:00:00.900Z`:

| Cancellation | Correct visibility | Current rounded comparison |
| --- | --- | --- |
| `2026-11-07T10:00:00.900500Z` | Excluded: older than 24 hours | Included |
| `2026-11-08T10:00:00.900500Z` | Included: already cancelled | Excluded |

This read-only SQL reproduces the comparison discrepancy. `date_trunc` models the millisecond truncation observed through the installed driver; it is not the proposed fix.

```sql
WITH clock AS (
  SELECT timestamptz '2026-11-08T10:00:00.900900Z' AS exact_now
), examples(label, cancelled_at) AS (
  VALUES
    ('expired', timestamptz '2026-11-07T10:00:00.900500Z'),
    ('new', timestamptz '2026-11-08T10:00:00.900500Z')
)
SELECT label,
  cancelled_at > exact_now - interval '24 hours'
    AND cancelled_at <= exact_now AS exact_visible,
  cancelled_at > date_trunc('milliseconds', exact_now) - interval '24 hours'
    AND cancelled_at <= date_trunc('milliseconds', exact_now) AS rounded_visible
FROM clock CROSS JOIN examples
ORDER BY label;
-- expired: false / true
-- new:     true  / false
```

## Impact and deferral

The recent-cancellation API selection can be wrong by less than one millisecond at either edge. A row omitted from a rendered view can remain absent until the next fetch. The integration test can make CI intermittently red.

Booking correctness and availability are unaffected: active reservations use booking/status state, not this display cutoff. Cancellation and capacity release are transactional. `drizzle/0006_cancellation_history.sql` stores and preserves the original database timestamp; this read-side rounding does not alter it. Permanent history does not use the 24-hour window. No lost audit record or cross-owner disclosure was demonstrated.

Deferral is acceptable for the local marketplace foundation and its publication/CI gate. It does not make the defect fixed, excuse a failing hosted check, or justify repeatedly rerunning CI as the permanent remedy. Production readiness is a separate decision.

## Proposed correction

Keep one full-precision database clock value for all SQL comparisons, for example by reading `clock_timestamp()::text` and binding that text unchanged. Derive the millisecond `serverNow` response separately for the existing UI contract. Alternatively compute the clock and selection together in SQL. Avoid unrelated booking, availability, notification or audit-schema changes.

## Regression requirements

- Test both deterministic examples above through the actual service/query path, with a controlled clock; do not rely on wall-clock sleeps.
- Verify exactly 24 hours old is excluded; just inside the window is included; exactly the current clock is included; future cancellations are excluded.
- Exercise both owner and administrator views and retain other-owner privacy assertions.
- Preserve permanent history, the stored full-precision cancellation timestamp, repeated-cancellation idempotency, capacity release and notification behavior.
- Only after adding exact-boundary coverage, make the broad integration fixture unambiguously expired if needed. Do not remove, skip or weaken regression assertions to obtain a passing run.
- Run the standalone unit/integration/browser suites and both lint/type checks; require the applicable hosted checks to succeed.

No fix is included in the evidence-finalization commit.
