# Booking hold expiration operations

This runbook targets the existing **local synthetic marketplace** only. It does not enable hosted database connections or authorize deployment. Use the marketplace `.env.local`; never copy private deployment configuration.

## Apply and inspect

With the dedicated PostgreSQL cluster running:

```sh
cd marketplace
npm run db:migrate
npm run db:migrate
npm run holds:expire
```

Run migration before starting the updated app/worker. A repeat migration must be a no-op. Migration 0007 retains all bookings and assigns legacy pending requests a fresh full 48-hour deadline; approval separately closes at the start of the stay. Confirmed and terminal history are unchanged. See [ADR 004](adr-004-expiring-holds.md).

The authorized migration administrator can configure **future** holds:

```sql
UPDATE booking_hold_policy SET duration_seconds = 172800 WHERE singleton;
```

The maximum is seven days, the minimum one second. New requests are always capped at the stay's first Stockholm midnight. Do not give runtime roles policy/table writes or change existing deadlines to extend holds. Keep the migration credential separate from the worker. Runtime uses only `MARKETPLACE_DATABASE_URL` and the existing strict loopback/role checks.

## Schedule

The checked-in `ops/dogbooker-holds.service` and `.timer` are user systemd units. Before installing them, change `WorkingDirectory` to the authorized checkout's `marketplace` directory and ensure the service PATH resolves Node 22+ and npm. The default `%h/dogbooker/marketplace` is an example installation location. Copy to `~/.config/systemd/user/`, then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now dogbooker-holds.timer
systemctl --user list-timers dogbooker-holds.timer
journalctl --user -u dogbooker-holds.service
```

For cron, use an absolute installation path and a PATH containing Node/npm:

```cron
* * * * * cd /absolute/path/to/dogbooker/marketplace && /absolute/path/to/npm run holds:expire
```

Retain stdout/stderr in your scheduler's restricted log destination. No timer/cron entry is installed by migration or by the validation task. Linux systemd activation must be checked on the eventual authorized host; local macOS validation exercises the one-shot command directly.

## Recovery and monitoring

Successful output is one JSON record with `event=booking_holds_expiration`, `status=ok`, `expired`, `batches`, `limitReached`, and `durationMs`. Errors log only event/status/duration and a five-character SQLSTATE or `unknown`, exit nonzero, and let the next scheduled run recover. Database messages, account IDs, names, care notes, URLs and credentials are not logged.

Alert on missing successful runs, repeated failure, or repeated `limitReached=true`. A zero count may mean a sitter is locked, so it is not a backlog health check. An authorized local administrator can inspect only aggregate lag without dumping booking details:

```sql
SELECT count(*) AS overdue,
       coalesce(max(clock_timestamp()-expires_at), interval '0') AS oldest_lag
FROM bookings WHERE status='pending' AND expires_at<=clock_timestamp();
```

After downtime, run the command again; it has no date-window gap or cursor to repair. Each batch is transactional. An ambiguous connection failure must not be treated as proof that a batch failed to commit; rerunning is safe because only still-pending due rows can transition. Investigate persistent locks, database availability and scheduler credentials before increasing batch sizes. The code accepts at most 500 rows per batch and 20 batches per invocation; shipped CLI defaults to 100 × 10. Do not run an unbounded catch-up loop in a request handler.

Users refreshing history see expiry; a still-open page with pending requests refreshes every 30 seconds and on focus. The SQL decision remains authoritative if a button is stale or the browser clock is wrong. An expired owner can submit a new request with a new retry key if the sitter and dogs are available.
