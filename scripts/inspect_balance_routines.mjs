import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
await client.connect();
try {
  const result = await client.query(`
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('adjust_patient_balance','hms_current_user_id','hms_current_user_role','is_authenticated_staff')
    ORDER BY p.proname, identity_args
  `);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
