import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
const patientIds = [
  '16ccc4ff-f882-4b66-a325-7c73646f3da6', // Nafisa snap verification
  'ed12cc69-57e0-4965-954c-cf429b98907e', // Yasir typed verification
  '94ff867b-1a3f-49be-a97c-1d483b422c20', // Tanimu typed verification
];
await client.connect();
try {
  for (const patientId of patientIds) {
    const patient = await client.query(`
      SELECT id, first_name, last_name, status, last_visit, balance, updated_at
      FROM public.patients WHERE id = $1 LIMIT 1
    `, [patientId]);
    const visits = await client.query(`
      SELECT id, patient_id, status, created_at, updated_at
      FROM public.visits WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10
    `, [patientId]);
    const journey = await client.query(`
      SELECT id, patient_id, visit_id, current_state, owner_role, owner_user_id, department, location, updated_at
      FROM public.patient_journey WHERE patient_id = $1 LIMIT 5
    `, [patientId]);
    const history = await client.query(`
      SELECT id, patient_id, visit_id, from_state, to_state, reason, created_at
      FROM public.patient_journey_history WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 20
    `, [patientId]);
    const snaps = await client.query(`
      SELECT id, visit_id, parent_snap_id, order_type, status, source_role, target_station, returned_to,
             result_text, photo_path, ocr_text, created_at, returned_at, fulfilled_at
      FROM public.snap_orders WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 20
    `, [patientId]);
    const labRequests = await client.query(`
      SELECT id, visit_id, status, requested_at, completed_at, results
      FROM public.lab_requests WHERE patient_id = $1 ORDER BY requested_at DESC LIMIT 20
    `, [patientId]);
    console.log(JSON.stringify({ patient: patient.rows, visits: visits.rows, journey: journey.rows, history: history.rows, snaps: snaps.rows, labRequests: labRequests.rows }, null, 2));
  }
} finally {
  await client.end();
}
