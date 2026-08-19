import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
const patientId = '94ff867b-1a3f-49be-a97c-1d483b422c20';
const visitId = '94b8f46f-9636-4782-9b38-31277a6550c0';
const parentId = '2878acae-7984-4f79-92f9-4f2dca38f72c';
const resultId = 'b752974c-e0e5-40d5-88de-f171aa857b02';
const historyId = '8b3f3640-d06b-437f-9994-45451d386789';
const paidAt = '2026-08-19T11:08:20.278Z';
await client.connect();
try {
  await client.query('BEGIN');
  const child = await client.query(`SELECT id, parent_snap_id, result_text, status FROM public.snap_orders WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1`, [resultId, patientId, visitId]);
  if (child.rowCount !== 1 || child.rows[0].parent_snap_id !== parentId || child.rows[0].result_text !== 'Verification result: within reference range.' || child.rows[0].status !== 'returned') {
    throw new Error('Refusing cleanup: verification child does not match the expected exact row');
  }
  const parent = await client.query(`SELECT id, status, fulfilled_at, fulfilled_by FROM public.snap_orders WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1`, [parentId, patientId, visitId]);
  if (parent.rowCount !== 1 || parent.rows[0].status !== 'fulfilled') {
    throw new Error('Refusing cleanup: parent is not the expected fulfilled lab snap');
  }
  const history = await client.query(`SELECT id, from_state, to_state, reason FROM public.patient_journey_history WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1`, [historyId, patientId, visitId]);
  if (history.rowCount !== 1 || history.rows[0].from_state !== 'in_lab' || history.rows[0].to_state !== 'with_doctor' || history.rows[0].reason !== 'Laboratory result returned to the original requester') {
    throw new Error('Refusing cleanup: journey history row does not match the expected verification return');
  }
  await client.query(`DELETE FROM public.patient_journey_history WHERE id = $1`, [historyId]);
  await client.query(`DELETE FROM public.snap_orders WHERE id = $1`, [resultId]);
  await client.query(`UPDATE public.snap_orders SET status = 'paid', fulfilled_by = NULL, fulfilled_at = NULL WHERE id = $1`, [parentId]);
  await client.query(`UPDATE public.patient_journey SET visit_id = $2, current_state = 'in_lab', owner_role = 'lab_tech', owner_user_id = NULL, department = NULL, location = NULL, updated_at = now() WHERE patient_id = $1`, [patientId, visitId]);
  await client.query(`UPDATE public.patients SET status = 'in_lab', last_visit = $2, updated_at = now() WHERE id = $1`, [patientId, paidAt]);
  await client.query('COMMIT');
  console.log(JSON.stringify({removed_result_id: resultId, removed_history_id: historyId, restored_parent_id: parentId, restored_status: 'paid', restored_patient_status: 'in_lab', cashier_payment_untouched: true}, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error(error);
  process.exitCode = 1;
} finally { await client.end(); }
