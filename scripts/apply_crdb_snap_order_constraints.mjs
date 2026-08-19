import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });

await client.connect();
try {
  await client.query('BEGIN');
  await client.query('ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_order_type');
  await client.query('ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_target_station');
  await client.query('ALTER TABLE public.snap_orders DROP CONSTRAINT IF EXISTS check_status');
  await client.query('COMMIT');
  console.log(JSON.stringify({ applied: true, database: (await client.query('SELECT current_database() AS database')).rows[0].database }, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
