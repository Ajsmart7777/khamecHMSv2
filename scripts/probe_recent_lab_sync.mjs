import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
await client.connect();
try {
  const resultChildren = await client.query(`
    SELECT id, patient_id, visit_id, parent_snap_id, order_type, status,
           source_role, target_station, returned_to, result_text, photo_path,
           ocr_text, created_at, returned_at
    FROM public.snap_orders
    WHERE parent_snap_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 10
  `);
  const linked = [];
  for (const row of resultChildren.rows) {
    const parent = await client.query(`
      SELECT id, patient_id, visit_id, status, ocr_text, fulfilled_at
      FROM public.snap_orders WHERE id = $1 LIMIT 1
    `, [row.parent_snap_id]);
    const marker = String(parent.rows[0]?.ocr_text ?? '');
    const requestId = marker.startsWith('LINKED_LAB_REQUEST:') ? marker.slice('LINKED_LAB_REQUEST:'.length) : null;
    let labRequest = [];
    if (requestId) {
      const lr = await client.query(`
        SELECT id, patient_id, visit_id, status, requested_at, completed_at, results
        FROM public.lab_requests WHERE id = $1 LIMIT 1
      `, [requestId]);
      labRequest = lr.rows;
    }
    linked.push({ child: row, parent: parent.rows, requestId, labRequest });
  }
  console.log(JSON.stringify(linked, null, 2));
} finally {
  await client.end();
}
