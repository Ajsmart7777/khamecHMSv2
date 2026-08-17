import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  database: process.env.CRDB_DATABASE ?? 'khamec',
  ssl: { rejectUnauthorized: false },
});
try {
  await client.connect();
  const statements = [
    'DROP TABLE IF EXISTS public.__hms_probe_table CASCADE',
    'CREATE TABLE public.__hms_probe_table (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), value INT)',
    `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`,
    `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger2() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$`,
    `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger3() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN SELECT (NEW).id; RETURN NEW; END; $$`,
    `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger4() RETURNS TRIGGER LANGUAGE plpgsql AS $$ DECLARE _id UUID; BEGIN _id := NEW.id; SELECT _id; RETURN NEW; END; $$`,
    'CREATE TRIGGER __hms_probe_trigger AFTER INSERT OR UPDATE ON public.__hms_probe_table FOR EACH ROW EXECUTE FUNCTION public.__hms_probe_trigger()',
    'DROP TRIGGER IF EXISTS __hms_probe_trigger ON public.__hms_probe_table',
    'CREATE TRIGGER __hms_probe_trigger AFTER INSERT OR UPDATE OR DELETE ON public.__hms_probe_table FOR EACH ROW EXECUTE FUNCTION public.__hms_probe_trigger()',
    'CREATE TRIGGER __hms_probe_trigger3 AFTER INSERT OR UPDATE ON public.__hms_probe_table FOR EACH ROW EXECUTE FUNCTION public.__hms_probe_trigger3()',
    'CREATE TRIGGER __hms_probe_trigger4 AFTER INSERT OR UPDATE ON public.__hms_probe_table FOR EACH ROW EXECUTE FUNCTION public.__hms_probe_trigger4()',
  ];
  for (const sql of statements) {
    try { await client.query(sql); console.log(JSON.stringify({ ok: true, sql })); }
    catch (error) { console.log(JSON.stringify({ ok: false, sql, error: error instanceof Error ? error.message : String(error) })); }
  }
  await client.query('DROP TABLE IF EXISTS public.__hms_probe_table CASCADE');
  await client.query('DROP FUNCTION IF EXISTS public.__hms_probe_trigger()');
  await client.query('DROP FUNCTION IF EXISTS public.__hms_probe_trigger2()');
  await client.query('DROP FUNCTION IF EXISTS public.__hms_probe_trigger3()');
  await client.query('DROP FUNCTION IF EXISTS public.__hms_probe_trigger4()');
} finally {
  await client.end().catch(() => undefined);
}
