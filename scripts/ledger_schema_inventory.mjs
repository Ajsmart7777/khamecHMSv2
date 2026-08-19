import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
const tables = [
  'patients', 'visits', 'vitals', 'visit_attachments', 'snap_orders',
  'lab_requests', 'prescriptions', 'prescription_items', 'invoices',
  'invoice_items', 'admissions', 'balance_transactions', 'payment_transactions'
];
await client.connect();
try {
  const rows = await client.query(`
    SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
     ORDER BY table_name, ordinal_position
  `, [tables]);
  const existing = await client.query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)
     ORDER BY table_name
  `, [tables]);
  console.log(JSON.stringify({ existing: existing.rows.map(r => r.table_name), columns: rows.rows }, null, 2));
} finally {
  await client.end();
}
