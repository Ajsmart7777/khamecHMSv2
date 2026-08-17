import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({ host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud', port: 26257, user: 'dev_walid', password, database: 'khamec', ssl: { rejectUnauthorized: false } });
const statements = [
  'DROP TYPE IF EXISTS public.__hms_probe_patient',
  'CREATE TYPE public.__hms_probe_patient AS (id UUID, account_type TEXT)',
  `CREATE OR REPLACE FUNCTION public.__hms_probe_composite() RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _p public.__hms_probe_patient; BEGIN SELECT id, account_type INTO _p FROM public.patients LIMIT 1; RETURN (_p).id; END; $$`,
];
try {
  await client.connect();
  for (const sql of statements) {
    try { await client.query(sql); console.log(JSON.stringify({ ok: true, sql })); }
    catch (error) { console.log(JSON.stringify({ ok: false, sql, error: error instanceof Error ? error.message : String(error) })); }
  }
  await client.query('DROP FUNCTION IF EXISTS public.__hms_probe_composite()');
  await client.query('DROP TYPE IF EXISTS public.__hms_probe_patient');
} finally { await client.end().catch(() => undefined); }
