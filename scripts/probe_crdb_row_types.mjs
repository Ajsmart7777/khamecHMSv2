import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  database: 'khamec',
  ssl: { rejectUnauthorized: false },
});
const probes = [
  `CREATE OR REPLACE FUNCTION public.__hms_probe_row1() RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _p public.patients%ROWTYPE; BEGIN SELECT * INTO _p FROM public.patients LIMIT 1; RETURN _p.id; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_row2() RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _p public.patients; BEGIN SELECT * INTO _p FROM public.patients LIMIT 1; RETURN (_p).id; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_row3() RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _p RECORD; BEGIN SELECT id INTO _p FROM public.patients LIMIT 1; RETURN _p.id; END; $$`,
];
try {
  await client.connect();
  for (let i = 0; i < probes.length; i += 1) {
    try { await client.query(probes[i]); console.log(JSON.stringify({ probe: i + 1, ok: true })); }
    catch (error) { console.log(JSON.stringify({ probe: i + 1, ok: false, error: error instanceof Error ? error.message : String(error) })); }
  }
  for (const name of ['__hms_probe_row1', '__hms_probe_row2', '__hms_probe_row3']) await client.query(`DROP FUNCTION IF EXISTS public.${name}()`);
} finally { await client.end().catch(() => undefined); }
