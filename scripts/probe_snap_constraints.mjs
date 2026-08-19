import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });

await client.connect();
try {
  const result = await client.query('SHOW CREATE TABLE public.snap_orders');
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
