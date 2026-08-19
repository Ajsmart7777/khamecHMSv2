import fs from 'fs';
import pg from 'pg';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT p.oid::INT8 AS oid, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'public'::REGNAMESPACE
      AND p.proname IN ('adjust_patient_balance','create_admitted_snap','enforce_patient_field_permissions')
    ORDER BY p.proname, p.oid
  `);
  console.log(JSON.stringify(rows.map((row) => ({ oid: row.oid, name: row.proname, identity_args: row.identity_args, definition: row.definition }))));
} finally {
  await client.end().catch(() => {});
}
