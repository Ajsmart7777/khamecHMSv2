# Neon compatibility notes

## Official documentation verified on 2026-08-16

Neon Data API uses JWTs for access control and requires a JWT `sub` claim for RLS. Managed Better Auth provides the JWT. The Neon Data API exposes `auth.user_id()` and `auth.uid()` helpers; `auth.uid()` is suitable when the application column is UUID. The Data API schema cache must be refreshed after schema changes. Source: https://neon.com/docs/data-api/get-started

Managed Better Auth stores authentication state in the `neon_auth` schema, uses the `neon_auth.user` table, and provides a React/Vite client SDK. Source: https://neon.com/docs/auth/overview

The official JavaScript SDK supports a Supabase-compatible auth adapter. Its documented migration path uses `createClient` from `@neondatabase/neon-js` with `SupabaseAuthAdapter()`, after which existing `auth.*` methods and `.from(...).select/insert/update/delete` queries can remain source-compatible. The object form accepts explicit Auth and Data API URLs. Source: https://neon.com/docs/auth/migrate/from-supabase

The SDK reference documents `@neondatabase/neon-js`, SupabaseAuthAdapter, database query compatibility, RPC calls, and explicit `{ auth: { url }, dataApi: { url } }` initialization. Source: https://neon.com/docs/reference/javascript-sdk

The PostgreSQL/PostgREST guide confirms standard REST filtering and stored procedure endpoints, and explains JWT claims/RLS behavior. Source: https://neon.com/docs/guides/postgrest

## Migration design decision

The HMS migration set is transformed only to remove Supabase Realtime publication statements, Supabase Storage `storage.objects` policies, and unsupported `pg_cron`/`pg_net` extension statements. Clinical tables, functions, triggers, indexes, constraints, and application RLS policies are retained. `auth.users` foreign keys are retargeted to `neon_auth.user`. Cloudflare R2 remains the file store.

## Managed Better Auth administration

Neon’s Managed Better Auth Admin plugin is available through the Neon SDK and supports `admin.createUser`, `admin.listUsers`, `admin.setRole`, `admin.setUserPassword`, `admin.updateUser`, and `admin.removeUser`. Admin operations require the caller to hold the Managed Better Auth `admin` role. The Netlify staff-account function forwards the incoming bearer token through the official vanilla adapter and keeps the HMS `public.user_roles` table synchronized. Sources: https://neon.com/docs/auth/guides/plugins/admin and https://neon.com/guides/admin-dashboard-neon-auth
