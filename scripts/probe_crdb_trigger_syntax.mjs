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
const probes = [
  `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'INSERT' THEN RETURN NEW; ELSIF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM public.write_audit_log('probe', 'probe', NEW.id::text, jsonb_build_object('target_user_id', NEW.user_id, 'role', NEW.role)); RETURN NEW; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT 1; RETURN NEW; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT public.write_audit_log('probe', '{}'::jsonb, NULL::uuid, 'probe', 'success'); RETURN NEW; END; $$`,
  `CREATE OR REPLACE FUNCTION public.__hms_probe_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF TG_OP = 'INSERT' THEN PERFORM public.write_audit_log('probe', 'probe', NEW.id::text, jsonb_build_object('target_user_id', NEW.user_id, 'role', NEW.role)); RETURN NEW; ELSIF TG_OP = 'DELETE' THEN PERFORM public.write_audit_log('probe', 'probe', OLD.id::text, jsonb_build_object('target_user_id', OLD.user_id, 'role', OLD.role)); RETURN OLD; ELSIF TG_OP = 'UPDATE' AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN PERFORM public.write_audit_log('probe', 'probe', NEW.id::text, jsonb_build_object('target_user_id', NEW.user_id, 'old_role', OLD.role, 'new_role', NEW.role)); RETURN NEW; END IF; RETURN NEW; END; $$`,
];
try {
  await client.connect();
  for (let i = 0; i < probes.length; i += 1) {
    try {
      await client.query(probes[i]);
      console.log(JSON.stringify({ probe: i + 1, ok: true }));
    } catch (error) {
      console.log(JSON.stringify({ probe: i + 1, ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  await client.query('DROP FUNCTION IF EXISTS public.__hms_probe_trigger()');
} finally {
  await client.end().catch(() => undefined);
}
