# ADR 001: keep marketplace and standalone installations independent

Accepted for the local prototype, 2026-11-07.

The released product scopes bookings by a dog represented through an owner account and gives its single administrator global visibility. Retrofitting tenants would put existing authorization, calendar sharing, notifications and singleton scheduling at risk. A feature flag cannot protect private production data from a missing tenant predicate.

Choose a separate Next.js application in the same public repository, with separate PostgreSQL, authentication, environment variables, migration history and restricted roles. Reuse only pure date/hydration helpers and the root dependency lock. No credentials or data import. Keep all standalone application files and migrations unchanged.

Alternatives rejected: in-place tenant retrofit (large unsafe migration); separate repository immediately (unnecessary dependency/review duplication); microservices/PostGIS/queue at the demo stage (no measured need yet). When the app needs independent releases, split its package/lock or repository while retaining tests and MIT attribution.

Consequences: two builds and two auth configurations; explicit SQL invariants and validation parity tests; no seamless existing-user import. A consent-based import and independent production rollout require separate design and authorization.
