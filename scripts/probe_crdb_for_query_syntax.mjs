import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: process.env.CRDB_DATABASE ?? 'khamec',
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const probes = [
  ['for_as_select', `CREATE OR REPLACE FUNCTION public.__probe_for_as_select() RETURNS int LANGUAGE plpgsql AS $$ DECLARE x int; total int := 0; BEGIN FOR x AS SELECT 1 UNION ALL SELECT 2 LOOP total := total + x; END LOOP; RETURN total; END; $$;`],
  ['for_parenthesized_select', `CREATE OR REPLACE FUNCTION public.__probe_for_parenthesized_select() RETURNS int LANGUAGE plpgsql AS $$ DECLARE x int; total int := 0; BEGIN FOR x IN (SELECT 1 UNION ALL SELECT 2) LOOP total := total + x; END LOOP; RETURN total; END; $$;`],
];
for (const [name, sql] of probes) {
  try {
    await client.query(sql);
    console.log(JSON.stringify({ name, ok: true }));
  } catch (error) {
    console.log(JSON.stringify({ name, ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}
try { await client.query('DROP FUNCTION IF EXISTS public.__probe_for_as_select()'); } catch {}
try { await client.query('DROP FUNCTION IF EXISTS public.__probe_for_parenthesized_select()'); } catch {}
await client.end();
