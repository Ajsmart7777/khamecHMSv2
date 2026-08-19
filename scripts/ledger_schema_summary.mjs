import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
const tables = ['patients','visits','vitals','visit_attachments','snap_orders','lab_requests','prescriptions','prescription_items','invoices','invoice_items','admissions','balance_transactions','payment_transactions'];
await client.connect();
try {
 const rows = await client.query(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name, ordinal_position`, [tables]);
 const grouped = {};
 for (const r of rows.rows) (grouped[r.table_name] ??= []).push(`${r.column_name}:${r.data_type}${r.is_nullable==='NO'?'!':''}${r.column_default?`=${r.column_default}`:''}`);
 console.log(JSON.stringify(grouped, null, 2));
} finally { await client.end(); }
