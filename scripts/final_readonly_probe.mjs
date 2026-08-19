import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = ['patients', 'visits', 'invoices', 'lab_requests', 'auth_users'];
const counts = {};
for (const table of tables) {
  const result = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
  counts[table] = result.rows[0].count;
}

const markers = await client.query(`
  SELECT id, first_name, last_name, phone
  FROM public.patients
  WHERE lower(first_name || ' ' || last_name) LIKE '%verification%'
     OR lower(first_name || ' ' || last_name) LIKE '%test%'
     OR lower(first_name || ' ' || last_name) LIKE '%do not keep%'
  ORDER BY first_name, last_name
  LIMIT 50
`);

const routines = await client.query(`
  SELECT routine_name, count(*)::int AS overload_count
  FROM information_schema.routines
  WHERE specific_schema = 'public'
    AND routine_name IN ('settle_invoice_atomic', 'write_audit_log')
  GROUP BY routine_name
  ORDER BY routine_name
  LIMIT 20
`);

console.log(JSON.stringify({ counts, verification_markers: markers.rows, routines: routines.rows }, null, 2));
await client.end();
