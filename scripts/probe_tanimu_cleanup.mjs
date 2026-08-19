import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
await client.connect();
try {
  const patientId = '94ff867b-1a3f-49be-a97c-1d483b422c20';
  const visitId = '94b8f46f-9636-4782-9b38-31277a6550c0';
  const parentId = '2878acae-7984-4f79-92f9-4f2dca38f72c';
  const [patient, lab, snaps, journey, history] = await Promise.all([
    client.query(`SELECT id, status, assigned_doctor, last_visit FROM public.patients WHERE id = $1 LIMIT 1`, [patientId]),
    client.query(`SELECT * FROM public.lab_requests WHERE patient_id = $1 AND visit_id = $2 ORDER BY created_at DESC LIMIT 10`, [patientId, visitId]),
    client.query(`SELECT id, parent_snap_id, status, order_type, target_station, source_role, original_sender_role, result_text, returned_to, returned_at, fulfilled_at, fulfilled_by FROM public.snap_orders WHERE patient_id = $1 AND visit_id = $2 ORDER BY created_at DESC LIMIT 10`, [patientId, visitId]),
    client.query(`SELECT * FROM public.patient_journey WHERE patient_id = $1 AND visit_id = $2 ORDER BY created_at DESC LIMIT 10`, [patientId, visitId]),
    client.query(`SELECT * FROM public.patient_journey_history WHERE patient_id = $1 AND visit_id = $2 ORDER BY created_at DESC LIMIT 20`, [patientId, visitId]),
  ]);
  console.log(JSON.stringify({patient: patient.rows, lab: lab.rows, snaps: snaps.rows, journey: journey.rows, history: history.rows}, null, 2));
} finally { await client.end(); }
