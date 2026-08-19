import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string','utf8').trim();
const client = new pg.Client({connectionString, ssl:{rejectUnauthorized:false}, connectionTimeoutMillis:15000, query_timeout:20000});
await client.connect();
try {
  const patients = await client.query(`SELECT id, first_name, last_name, card_number FROM public.patients WHERE card_number IN ('P-002','P-003','P-004') ORDER BY card_number LIMIT 10`);
  const visits = await client.query(`SELECT v.id, v.patient_id, p.card_number, v.status, v.opened_at FROM public.visits v JOIN public.patients p ON p.id=v.patient_id WHERE p.card_number IN ('P-002','P-003','P-004') ORDER BY v.opened_at LIMIT 50`);
  const rows = await client.query(`SELECT i.id, i.patient_id, p.card_number, i.visit_id, i.invoice_number, i.total_amount, i.paid_amount, i.status, i.payment_method, i.created_at, count(ii.id)::int AS item_count FROM public.invoices i JOIN public.patients p ON p.id=i.patient_id LEFT JOIN public.invoice_items ii ON ii.invoice_id=i.id WHERE p.card_number IN ('P-002','P-003','P-004') GROUP BY i.id,p.card_number ORDER BY i.created_at LIMIT 50`);
  const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (lower(table_name) LIKE '%bill%' OR lower(table_name) LIKE '%invoice%') ORDER BY table_name LIMIT 50`);
  console.log(JSON.stringify({patients:patients.rows, visits:visits.rows, invoices:rows.rows, bill_invoice_tables:tables.rows},null,2));
} finally { await client.end(); }
