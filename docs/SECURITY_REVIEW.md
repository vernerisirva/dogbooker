# Release security and validation review

Review completed: 2026-11-07 (started 2026-11-06). Scope: this public source release, its locked dependencies, the locally available source application's complete Git object database, and an independent local installation. This is an engineering review, not a penetration-test or security certification.

## Isolation and publication boundary

The release was copied into an independent directory using an explicit source/test/configuration allowlist. A new Git repository was initialized without copying the original `.git`, branches, remotes, tags or commit metadata. Original application files were recorded by hash for a final unchanged check. No production database connection, deployment action or account mutation was used for release preparation.

Excluded material includes original operational documentation, live-verification and deployment scripts, all real environment files, private local evidence, invitation files, test account passwords, deployment project links, generated workflow code, build output and dependency directories. Source/test names and deployment URLs were replaced with fictional examples. `.env.example` contains placeholders only. All distributed screenshots are from synthetic local fixtures.

## History and sensitive-data review

- Inspected all 504 locally stored Git objects, including unreachable objects, and scanned the 325 blob/commit/tag payloads. There were 24 reachable source commits.
- Gitleaks 8.30.1 (official archive, checksum verified) scanned all refs/full history and the extracted payloads: **zero credential-rule findings**.
- A targeted scan for personal/deployment references, literal invitation URLs and exact current secret values identified **87 objects containing personal/deployment references**; no exact current-secret or literal invitation-URL match was found. Those objects were not copied into public history.
- The exact 141-file publishable tree and fresh single-commit public history were scanned with Gitleaks and targeted private-identifier/current-secret checks: **zero findings**. Raw audit evidence remains outside this repository; no private values are included in this report.

Local Git storage cannot reveal remote-only objects or already-deleted server records. Automated scans cannot prove the absence of all secrets; the allowlist, manual content review, fresh history and exact-value checks provide additional layers.

## Application controls reviewed

Invitation-only authentication, password hashing, hashed/expiring one-use invitation tokens, database-backed rate limits, active-user/session checks, administrator-only mutations, owner-scoped reads, origin checks and Swedish validation errors remain in place. No private notes or owner contact details enter another owner's calendar projection. Confirmed companion dog names/dates are intentionally shared within the installation and must be explained to owners.

Database exclusion constraints protect bookings even under concurrent transactions. Owner-account limits now use configuration with serialized invitation creation; labels count three or more dogs correctly, including duplicate names. Arrival/pickup proposal revisions, separate reminders, cancellation/history rules and outbox lease/uncertain-delivery handling are retained. The new portable worker uses the existing durable database services.

Production operators must configure a trusted reverse proxy, TLS, secure secrets, backups, scheduler health and appropriate data retention. SMTP uncertainty is held for human reconciliation, not blindly retried. `MAX_OWNERS` is an account cap, not boarding capacity. This release remains one sitter/administrator per installation and one dog per owner account.

## Dependencies and licensing

The lockfile is committed and CI uses `npm ci`. All locked dependency entries are inventoried in `docs/dependencies.json`; missing package metadata was resolved using the package's shipped Apache-2.0 LICENSE. See `THIRD_PARTY_NOTICES.md` for MPL/LGPL/data-attribution obligations when redistributing built artifacts.

The initial moderate minimatch advisory was fixed through a targeted override to patched 11.0.1+. The post-fix npm audit reports **zero vulnerabilities**. This result is a snapshot of registry advisories, not a guarantee against undisclosed issues. CI checks at moderate severity and Dependabot tracks updates. ESLint 9 is end-of-support development tooling retained for the installed plugins' declared peer compatibility; this is recorded in the third-party review.

## Validation evidence

Validation on dedicated local PostgreSQL 16 databases with generated auth secrets and no Gmail credentials. The clean checkout repeated the complete suite; its 13 browser tests passed in 44.2 seconds and left the checkout clean:

| Check | Result |
| --- | --- |
| Fresh empty database, all nine migrations | Passed |
| Unit tests | 132 passed |
| PostgreSQL integration tests | 93 passed |
| TypeScript and ESLint | Passed |
| Optimized production build | Passed |
| Sample seed and portable worker | Passed; mail correctly reports unconfigured |
| Setup secrets, file permissions, refusal to overwrite | Passed |
| Browser suite | 13 passed (50.8 seconds) |
| Synthetic screenshots | Captured locally and visually reviewed |
| Docker Compose configuration | Validated with compose config |
| Fresh Git checkout in a separate directory, no production environment | Passed: install, generated configuration, migration/re-run, admin bootstrap, lint/typecheck, 132 unit + 93 integration + 13 browser tests, license regeneration and production build |

Integration coverage includes same-dog/block races at multiple isolation levels, five different dogs on the same dates, concurrent account-limit enforcement, privacy/authorization, invitation replay, approvals, revisions, time windows, cancellation visibility/history, reminder eligibility and notification retries.

No live email was sent, no hosted deployment was created, and no production account or schema was touched. Real inbox delivery and hosting-provider configuration require a future operator-owned deployment check.
