import pg from 'pg';

const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
const database = process.env.CRDB_DATABASE ?? 'khamec';
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  database,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

const statements = [
  `CREATE TABLE IF NOT EXISTS public.auth_users (
    id UUID PRIMARY KEY,
    email STRING UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE OR REPLACE FUNCTION public.hms_current_user_id()
   RETURNS UUID
   LANGUAGE SQL
   STABLE
   AS $$ SELECT NULLIF(current_setting('hms.user_id', true), '')::UUID $$`,
  `CREATE OR REPLACE FUNCTION public.hms_current_user_role()
   RETURNS STRING
   LANGUAGE SQL
   STABLE
   AS $$ SELECT COALESCE(NULLIF(current_setting('hms.user_role', true), ''), 'anon') $$`,
  `CREATE ROLE IF NOT EXISTS anon`,
  `CREATE ROLE IF NOT EXISTS authenticated`,
  `CREATE ROLE IF NOT EXISTS service_role`,
  `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`,
  `GRANT SELECT ON public.auth_users TO anon, authenticated, service_role`,
];

try {
  await client.connect();
  const results = [];
  for (const sql of statements) {
    try {
      await client.query(sql);
      results.push({ ok: true, statement: sql.split('\\n')[0] });
    } catch (error) {
      results.push({ ok: false, statement: sql.split('\\n')[0], error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  console.log(JSON.stringify({ applied: true, results }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
