import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
const marker = `LEDGER_AUDIT_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
const card = `${marker}_CARD`;
const mini = `${marker}_MINI`;
const invoiceNumber = `${marker}_INV`;
const results = [];
let patientId, visitId, prescriptionId, prescriptionItemId, labRequestId, pharmacySnapId, labSnapId, invoiceId, invoiceItemId, admissionId, balanceTxId;

async function q(text, params = []) { return client.query(text, params); }
async function stage(name, fn) {
  const started = Date.now();
  await fn();
  const s = await q(`
    SELECT
      (SELECT count(*)::int FROM public.visits WHERE id=$1) AS visits,
      (SELECT count(*)::int FROM public.prescriptions WHERE patient_id=$2) AS prescriptions,
      (SELECT count(*)::int FROM public.prescription_items WHERE prescription_id=$3) AS prescription_items,
      (SELECT count(*)::int FROM public.lab_requests WHERE patient_id=$2) AS lab_requests,
      (SELECT count(*)::int FROM public.snap_orders WHERE patient_id=$2) AS snap_orders,
      (SELECT count(*)::int FROM public.invoices WHERE id=$4) AS invoices,
      (SELECT count(*)::int FROM public.invoice_items WHERE invoice_id=$4) AS invoice_items,
      (SELECT count(*)::int FROM public.admissions WHERE id=$5) AS admissions,
      (SELECT count(*)::int FROM public.balance_transactions WHERE patient_id=$2) AS balance_transactions
  `, [visitId, patientId, prescriptionId, invoiceId, admissionId]);
  results.push({ stage: name, ms: Date.now() - started, source_counts: s.rows[0] });
}

async function cleanup() {
  // Recover from any failed statement before attempting guarded cleanup.
  try { await q('ROLLBACK'); } catch {}
  // Child rows first; all predicates are marker-scoped or id-scoped.
  await q('DELETE FROM public.balance_transactions WHERE id=$1', [balanceTxId]);
  await q('DELETE FROM public.admissions WHERE id=$1', [admissionId]);
  await q('DELETE FROM public.invoice_items WHERE invoice_id=$1', [invoiceId]);
  await q('DELETE FROM public.invoices WHERE id=$1', [invoiceId]);
  await q('DELETE FROM public.snap_orders WHERE id IN ($1,$2)', [pharmacySnapId, labSnapId]);
  await q('DELETE FROM public.lab_requests WHERE id=$1', [labRequestId]);
  await q('DELETE FROM public.prescription_items WHERE id=$1', [prescriptionItemId]);
  await q('DELETE FROM public.prescriptions WHERE id=$1', [prescriptionId]);
  await q('DELETE FROM public.vitals WHERE visit_id=$1', [visitId]);
  await q('DELETE FROM public.visits WHERE id=$1', [visitId]);
  await q('DELETE FROM public.patients WHERE id=$1', [patientId]);
}

await client.connect();
try {
  await q('BEGIN');
  const p = await q(`INSERT INTO public.patients
    (card_number, mini_card_number, first_name, last_name, date_of_birth, gender, phone, address, status, account_type)
    VALUES ($1,$2,'Ledger','Audit','1990-01-01','male','08000000000','verification-only','registered','normal')
    RETURNING id`, [card, mini]);
  patientId = p.rows[0].id;
  const v = await q(`INSERT INTO public.visits
    (visit_number, patient_id, status, presenting_complaint, sponsor_type)
    VALUES ($1,$2,'open','Ledger verification only','cash') RETURNING id`, [`${marker}_VISIT`, patientId]);
  visitId = v.rows[0].id;
  await q('COMMIT');
  await stage('patient_and_visit', async () => {});

  await q(`INSERT INTO public.vitals (patient_id, visit_id, temperature, blood_pressure, pulse, recorded_by)
    VALUES ($1,$2,36.8,'120/80',72,'Ledger audit')`, [patientId, visitId]);
  await stage('vitals', async () => {});

  const rx = await q(`INSERT INTO public.prescriptions (patient_id, visit_id, diagnosis, notes, status, created_by)
    VALUES ($1,$2,'Ledger verification','Verification pharmacy order','pending','Ledger audit') RETURNING id`, [patientId, visitId]);
  prescriptionId = rx.rows[0].id;
  const rxi = await q(`INSERT INTO public.prescription_items (prescription_id, medication, dosage, frequency, duration, quantity)
    VALUES ($1,'Verification Paracetamol','500mg','Once','1 day',1) RETURNING id`, [prescriptionId]);
  prescriptionItemId = rxi.rows[0].id;
  await q(`INSERT INTO public.snap_orders
    (patient_id, visit_id, order_type, target_station, source_role, status, intent, note, matched_items, ocr_text)
    VALUES ($1,$2,'prescription','pharmacy','doctor','pending_billing','typed_order','Verification pharmacy order','[]',$3)
    RETURNING id`, [patientId, visitId, `LINKED_PRESCRIPTION:${prescriptionId}`]).then(r => { pharmacySnapId = r.rows[0].id; });
  await stage('pharmacy_order', async () => {});

  const lab = await q(`INSERT INTO public.lab_requests
    (patient_id, visit_id, request_number, tests, diagnosis, status, requested_by)
    VALUES ($1,$2,$3,ARRAY['Verification CBC'],'Ledger verification','pending','Ledger audit') RETURNING id`, [patientId, visitId, `${marker}_LAB`]);
  labRequestId = lab.rows[0].id;
  await q(`INSERT INTO public.snap_orders
    (patient_id, visit_id, order_type, target_station, source_role, status, intent, note, matched_items, ocr_text)
    VALUES ($1,$2,'lab','lab','nurse','pending_billing','typed_order','Verification lab order','[]',$3)
    RETURNING id`, [patientId, visitId, `LINKED_LAB_REQUEST:${labRequestId}`]).then(r => { labSnapId = r.rows[0].id; });
  await stage('lab_order', async () => {});

  const inv = await q(`INSERT INTO public.invoices
    (patient_id, visit_id, invoice_number, total_amount, paid_amount, status, payment_method, created_by, notes)
    VALUES ($1,$2,$3,1500,0,'pending',NULL,'Ledger audit','Verification custom bill') RETURNING id`, [patientId, visitId, invoiceNumber]);
  invoiceId = inv.rows[0].id;
  const item = await q(`INSERT INTO public.invoice_items
    (invoice_id, description, quantity, unit_price, total, category)
    VALUES ($1,'Verification custom bill item',1,1500,1500,'general') RETURNING id`, [invoiceId]);
  invoiceItemId = item.rows[0].id;
  await stage('custom_bill_invoice', async () => {});

  await q(`UPDATE public.invoices SET paid_amount=500, status='partial', payment_method='cash', updated_at=now() WHERE id=$1`, [invoiceId]);
  await stage('partial_payment', async () => {});

  await q(`UPDATE public.invoices SET paid_amount=1500, status='paid', payment_method='cash', paid_at=now(), updated_at=now() WHERE id=$1`, [invoiceId]);
  await stage('full_payment', async () => {});

  await q(`UPDATE public.prescriptions SET status='fulfilled', updated_at=now() WHERE id=$1`, [prescriptionId]);
  await q(`UPDATE public.snap_orders SET status='paid', updated_at=now() WHERE id=$1`, [pharmacySnapId]);
  await q(`UPDATE public.snap_orders SET status='fulfilled', fulfilled_at=now(), updated_at=now() WHERE id=$1`, [pharmacySnapId]);
  await stage('pharmacy_fulfilled', async () => {});

  await q(`UPDATE public.lab_requests SET status='completed', completed_at=now(), results=$2, updated_at=now() WHERE id=$1`, [labRequestId, JSON.stringify({ 'Verification CBC': 'Normal' })]);
  await q(`UPDATE public.snap_orders SET status='paid', updated_at=now() WHERE id=$1`, [labSnapId]);
  await q(`UPDATE public.snap_orders SET status='fulfilled', result_text='Verification typed lab result', fulfilled_at=now(), updated_at=now() WHERE id=$1`, [labSnapId]);
  await stage('lab_result_returned', async () => {});

  const adm = await q(`INSERT INTO public.admissions
    (patient_id, visit_id, reason, status, admitted_at, admission_note)
    VALUES ($1,$2,'Ledger verification','active',now(),'Verification admission') RETURNING id`, [patientId, visitId]);
  admissionId = adm.rows[0].id;
  await stage('admission', async () => {});

  await q(`UPDATE public.admissions SET status='discharged', discharged_at=now(), discharge_notes='Verification discharge', updated_at=now() WHERE id=$1`, [admissionId]);
  await stage('discharge', async () => {});

  // This mirrors the debt/wallet event source used by settle_invoice_atomic.
  const bt = await q(`INSERT INTO public.balance_transactions
    (patient_id, transaction_type, amount, balance_before, balance_after, payment_method, related_invoice_id, notes)
    VALUES ($1,'debt_incurred',250,0,-250,'cash',$2,'Verification debt event') RETURNING id`, [patientId, invoiceId]);
  balanceTxId = bt.rows[0].id;
  await stage('balance_transaction_payment_event', async () => {});

  const rows = await q(`
    SELECT 'snap_order' AS source, id::text, order_type, status, created_at FROM public.snap_orders WHERE patient_id=$1
    UNION ALL SELECT 'lab_request', id::text, 'lab', status, created_at FROM public.lab_requests WHERE patient_id=$1
    UNION ALL SELECT 'prescription', id::text, 'prescription', status, created_at FROM public.prescriptions WHERE patient_id=$1
    UNION ALL SELECT 'invoice', id::text, invoice_number, status, created_at FROM public.invoices WHERE id=$2
    UNION ALL SELECT 'balance_transaction', id::text, transaction_type, payment_method, created_at FROM public.balance_transactions WHERE patient_id=$1
    ORDER BY created_at
  `, [patientId, invoiceId]);
  console.log(JSON.stringify({ marker, patientId, visitId, invoiceId, source_rows: rows.rows, stages: results }, null, 2));
} finally {
  try {
    await cleanup();
    const left = await q(`SELECT count(*)::int AS count FROM public.patients WHERE card_number=$1`, [card]);
    console.log(JSON.stringify({ cleanup_remaining_patients: left.rows[0].count }));
  } catch (error) {
    console.error(JSON.stringify({ cleanup_error: error.message, marker, patientId, visitId, invoiceId }));
    process.exitCode = 1;
  }
  await client.end();
}
