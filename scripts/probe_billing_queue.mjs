import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });

await client.connect();
try {
  const result = await client.query(`
    SELECT id, patient_id, order_type, target_station, status, invoice_id,
           matched_items, ocr_text, created_at
    FROM public.snap_orders
    ORDER BY created_at DESC
    LIMIT 50
  `);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
