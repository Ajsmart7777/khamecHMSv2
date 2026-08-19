import pg from 'pg';
import fs from 'fs';

const parentId = '2878acae-7984-4f79-92f9-4f2dca38f72c';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });

await client.connect();
try {
  const parent = await client.query(`
    SELECT id, patient_id, visit_id, order_type, status, source_role, target_station,
           parent_snap_id, result_text, photo_path, returned_to, returned_at, fulfilled_at
    FROM public.snap_orders
    WHERE id = $1
    LIMIT 1
  `, [parentId]);
  const children = await client.query(`
    SELECT id, patient_id, visit_id, order_type, status, source_role, target_station,
           parent_snap_id, result_text, photo_path, returned_to, returned_at, created_at
    FROM public.snap_orders
    WHERE parent_snap_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [parentId]);
  console.log(JSON.stringify({ parent: parent.rows, children: children.rows }, null, 2));
} finally {
  await client.end();
}
