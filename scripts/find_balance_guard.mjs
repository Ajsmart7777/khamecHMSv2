import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
await client.connect();
try {
  const functions = await client.query(`
    SELECT p.oid, n.nspname AS schema_name, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_args,
           p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosrc ILIKE '%allow_balance_write%'
    ORDER BY n.nspname, p.proname
  `);
  const triggers = await client.query(`
    SELECT trigger_schema, event_object_schema, event_object_table, trigger_name,
           action_statement, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE action_statement ILIKE '%balance%'
    ORDER BY event_object_table, trigger_name
  `);
  console.log(JSON.stringify({functions: functions.rows, triggers: triggers.rows}, null, 2));
} finally { await client.end(); }
