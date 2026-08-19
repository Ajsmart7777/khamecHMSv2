import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });

const cases = [
  {
    label: 'Nafisa snap verification',
    patientId: '16ccc4ff-f882-4b66-a325-7c73646f3da6',
    visitId: '4ac5700b-bb75-4732-b5a2-09cf90a50cad',
    parentId: '81d62f90-68d1-4f22-ab76-6c42bdcad8b6',
    childId: '2334beae-6dde-43e1-a6a9-0b2ad03117fe',
    requestId: '082cc22e-4868-437d-b488-970af9284589',
    historyId: '14a90237-2bb6-4d9b-a7b5-701060665494',
    expectedPhoto: '4ac5700b-bb75-4732-b5a2-09cf90a50cad/lab-result-a8d49b5a-9090-400f-bd86-ef4098e9dfda.jpg',
    paidAt: '2026-08-19T09:38:22.821Z',
  },
  {
    label: 'Yasir typed verification',
    patientId: 'ed12cc69-57e0-4965-954c-cf429b98907e',
    visitId: '274e6e8b-6418-49cc-8222-8fcadfa213f2',
    parentId: '5868a7f1-2824-4a50-bd00-355b36adf21c',
    childId: 'aa17fd03-0b0c-4921-be1f-4e7ba083926b',
    requestId: '566cb8a3-18ea-4af6-a76c-8c223ebb8a69',
    historyId: '1c66a11e-38ce-4bdb-a6a4-56ecb31caf39',
    expectedText: 'Verification typed result: within reference range.',
    paidAt: '2026-08-19T09:36:49.657Z',
  },
  {
    label: 'Tanimu typed verification',
    patientId: '94ff867b-1a3f-49be-a97c-1d483b422c20',
    visitId: '94b8f46f-9636-4782-9b38-31277a6550c0',
    parentId: '2878acae-7984-4f79-92f9-4f2dca38f72c',
    childId: '70c71d99-fb23-4f2c-a054-cf07c8d791a4',
    requestId: 'e04961a8-8e12-4b8a-895d-2898e2a9ee4f',
    historyId: '6a320d16-d1ee-4f3a-8b7e-42ca946930af',
    expectedText: 'Verification result: within reference range. This entry is for workflow verification only.',
    expectedRequestStatus: 'pending',
    paidAt: '2026-08-19T11:08:20.278Z',
  },
];

await client.connect();
try {
  await client.query('BEGIN');
  for (const c of cases) {
    const child = await client.query(`
      SELECT id, patient_id, visit_id, parent_snap_id, order_type, status, result_text, photo_path
      FROM public.snap_orders WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1
    `, [c.childId, c.patientId, c.visitId]);
    if (child.rowCount !== 1) throw new Error(`${c.label}: verification child not found`);
    const row = child.rows[0];
    if (row.parent_snap_id !== c.parentId || row.order_type !== 'lab' || row.status !== 'returned') {
      throw new Error(`${c.label}: child guard failed`);
    }
    if (c.expectedText !== undefined && row.result_text !== c.expectedText) throw new Error(`${c.label}: result text guard failed`);
    if (c.expectedPhoto !== undefined && row.photo_path !== c.expectedPhoto) throw new Error(`${c.label}: photo path guard failed`);

    const parent = await client.query(`
      SELECT id, patient_id, visit_id, status, order_type, target_station, fulfilled_at, fulfilled_by, ocr_text
      FROM public.snap_orders WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1
    `, [c.parentId, c.patientId, c.visitId]);
    if (parent.rowCount !== 1 || parent.rows[0].status !== 'fulfilled' || parent.rows[0].order_type !== 'lab' || parent.rows[0].target_station !== 'lab') {
      throw new Error(`${c.label}: parent guard failed`);
    }
    if (parent.rows[0].ocr_text !== `LINKED_LAB_REQUEST:${c.requestId}`) throw new Error(`${c.label}: parent linkage guard failed`);

    const request = await client.query(`
      SELECT id, patient_id, visit_id, status, completed_at, results
      FROM public.lab_requests WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1
    `, [c.requestId, c.patientId, c.visitId]);
    const expectedRequestStatus = c.expectedRequestStatus || 'completed';
    if (request.rowCount !== 1 || request.rows[0].status !== expectedRequestStatus) throw new Error(`${c.label}: lab request guard failed`);

    const history = await client.query(`
      SELECT id, patient_id, visit_id, from_state, to_state, reason
      FROM public.patient_journey_history WHERE id = $1 AND patient_id = $2 AND visit_id = $3 LIMIT 1
    `, [c.historyId, c.patientId, c.visitId]);
    if (history.rowCount !== 1 || history.rows[0].from_state !== 'in_lab' || history.rows[0].to_state !== 'with_doctor' || history.rows[0].reason !== 'Laboratory result returned to the original requester') {
      throw new Error(`${c.label}: journey history guard failed`);
    }

    const journey = await client.query(`
      SELECT current_state, owner_role FROM public.patient_journey WHERE patient_id = $1 AND visit_id = $2 LIMIT 1
    `, [c.patientId, c.visitId]);
    if (journey.rowCount !== 1 || journey.rows[0].current_state !== 'with_doctor' || journey.rows[0].owner_role !== 'doctor1') {
      throw new Error(`${c.label}: current journey guard failed`);
    }

    await client.query('DELETE FROM public.patient_journey_history WHERE id = $1', [c.historyId]);
    await client.query('DELETE FROM public.snap_orders WHERE id = $1', [c.childId]);
    await client.query(`UPDATE public.snap_orders SET status = 'paid', fulfilled_by = NULL, fulfilled_at = NULL WHERE id = $1`, [c.parentId]);
    await client.query(`UPDATE public.lab_requests SET status = 'pending', completed_at = NULL, results = NULL WHERE id = $1`, [c.requestId]);
    await client.query(`
      UPDATE public.patient_journey
      SET visit_id = $2, current_state = 'in_lab', owner_role = 'lab_tech', owner_user_id = NULL,
          department = NULL, location = NULL, updated_at = now()
      WHERE patient_id = $1 AND visit_id = $2
    `, [c.patientId, c.visitId]);
    await client.query(`UPDATE public.patients SET status = 'in_lab', last_visit = $2, updated_at = now() WHERE id = $1`, [c.patientId, c.paidAt]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ cleaned: cases.map(c => c.label), cashier_payment_untouched: true, restored_state: 'paid / pending / in_lab' }, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
