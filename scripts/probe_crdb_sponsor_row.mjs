import pg from 'pg';
const { Client } = pg;
const client = new Client({ host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud', port: 26257, user: 'dev_walid', password: process.env.CRDB_PASSWORD, database: 'khamec', ssl: { rejectUnauthorized: false } });
const probes = [
  `CREATE OR REPLACE FUNCTION public.__hms_probe_sponsor1(_sponsor_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _sponsor public.corporate_accounts; BEGIN SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id; RETURN (_sponsor).id; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_sponsor2(_sponsor_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _sponsor public.corporate_accounts; BEGIN SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id; IF (_sponsor).id IS NULL THEN RAISE EXCEPTION 'missing'; END IF; RETURN (_sponsor).id; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_sponsor3(_sponsor_id UUID) RETURNS UUID LANGUAGE plpgsql AS $$ DECLARE _sponsor public.corporate_accounts; BEGIN SELECT * INTO _sponsor FROM public.corporate_accounts WHERE id = _sponsor_id; IF (_sponsor).account_type NOT IN ('corporate','retainer') THEN RAISE EXCEPTION 'bad'; END IF; RETURN (_sponsor).id; END; $$`,
];
try {
  await client.connect();
  for (let i = 0; i < probes.length; i += 1) {
    try { await client.query(probes[i]); console.log(JSON.stringify({ probe: i + 1, ok: true })); }
    catch (error) { console.log(JSON.stringify({ probe: i + 1, ok: false, error: error instanceof Error ? error.message : String(error) })); }
  }
  for (const name of ['__hms_probe_sponsor1', '__hms_probe_sponsor2', '__hms_probe_sponsor3']) await client.query(`DROP FUNCTION IF EXISTS public.${name}(uuid)`);
} finally { await client.end().catch(() => undefined); }
