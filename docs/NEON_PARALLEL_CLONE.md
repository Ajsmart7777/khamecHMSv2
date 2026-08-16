# Khamec HMS — Neon Parallel Clone

This repository is a **parallel development clone** of Khamec HMS. The current Supabase project and its GitHub repository remain the production source of truth and are not modified by this clone.

## Safety boundary

The clone must use a separate Neon project, a separate authentication/test environment, and a separate R2 test prefix or bucket. It must never point at the live Supabase database or production R2 paths during development.

The cloned frontend currently preserves the existing application behavior. The Neon migration is intentionally staged rather than pretending that a PostgreSQL connection string can replace the browser-facing Supabase client. The current application depends on Supabase Auth, REST-style table access, RPC calls, Realtime subscriptions, Row Level Security helpers, and Edge Functions. These services must be replaced behind a server-side API before production cutover.

## Target architecture

| Concern | Parallel-clone target |
|---|---|
| Relational database | Neon Postgres, isolated project/branch |
| Browser data access | Authenticated server-side API; no privileged database URL in the browser |
| Authentication | Separate test auth implementation, to be selected and tested before cutover |
| Authorization | Server-side role checks plus PostgreSQL authorization policies where appropriate |
| Realtime | Separate event/SSE/WebSocket or polling layer, tested against queue freshness requirements |
| Files | Cloudflare R2 under a non-production test prefix |
| Migrations | Git-tracked SQL, applied to Neon branch first, then Neon production project |
| Production | Existing Supabase + R2 system remains unchanged until formal cutover approval |

## Migration order

1. Create the isolated Neon project and a disposable branch.
2. Export schema and functions from the current database without copying secrets.
3. Port and test tables, indexes, constraints, functions, and triggers.
4. Import a sanitized test dataset; do not copy live patient data into an unsecured development environment.
5. Build the server-side API and role enforcement.
6. Replace direct Supabase reads, writes, RPC calls, and subscriptions behind the API.
7. Test clinic workflow, billing, cashier settlement, inventory, archive, and realtime queue behavior.
8. Run a parallel read-only comparison before any write cutover.
9. Keep a rollback path to the current Supabase deployment.

## What “exact clone” means here

The repository contains the current application code and the latest intended UI changes. It is not yet a claim of functional parity with Neon. Functional parity is achieved only after the database schema, RPC behavior, authentication, authorization, realtime events, and R2 test paths all pass the regression suite.

## Required secrets

Use a local or hosting-provider secret manager. Never commit a Neon connection string, Supabase service-role key, R2 secret, or production credential.

Expected future server-side variables include:

```text
NEON_DATABASE_URL=
TEST_AUTH_SECRET=
R2_TEST_BUCKET=
R2_TEST_PREFIX=khamec-neon-clone/
```

The frontend must only receive public configuration and short-lived authenticated session material. It must never receive `NEON_DATABASE_URL`.
