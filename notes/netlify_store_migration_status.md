# Netlify Store migration status

Source: https://app.netlify.com/projects/khameccockroach/configuration/env

The authenticated Netlify project `khameccockroach` contains the production environment variable `CRDB_CONNECTION_STRING`, scoped to all deploy contexts. The value was not copied into this note.

Source: https://app.netlify.com/projects/khameccockroach/deploys/6a834ac36e70bf00070ae394

The deployment for commit `e8639ed` (`Rebuild Store Bin Card workflow for CockroachDB`) completed the Vite build and function bundling and was still in the final deploying/post-processing stage when last checked. The build log reported no secrets detected in build output.

The current CockroachDB code includes the simplified Store 1/Store 2 Bin Card workflow, Store-versus-Pharmacy transaction handling, authenticated session context in the SQL gateway, and migration file `20260817130000_simplify_store_bin_card_flow.sql`. The remaining operational step is to apply and verify that migration against the configured CockroachDB production database without exposing the connection value.

The environment page shows `CRDB_CONNECTION_STRING` and `JWT_SECRET` entries; no values are recorded here.

Saved on 2026-08-17.
