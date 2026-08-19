import fs from 'node:fs';
import pg from 'pg';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const tables = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('payroll_payments', 'payroll_entries')
    ORDER BY table_name, ordinal_position
  `);
  const counts = await client.query(`
    SELECT 'payroll_payments' AS table_name, COUNT(*)::int AS row_count FROM public.payroll_payments
    UNION ALL
    SELECT 'payroll_entries' AS table_name, COUNT(*)::int AS row_count FROM public.payroll_entries
  `);
  console.log(JSON.stringify({ columns: tables.rows, counts: counts.rows }, null, 2));
} finally {
  await client.end();
}
