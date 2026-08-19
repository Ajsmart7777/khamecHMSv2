import fs from 'fs';
const file = process.argv[2] || '/tmp/live_routines.json';
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const row of raw.pgRows || []) {
  const name = row.proname || row.routine_name || '';
  if (!['settle_invoice_atomic', 'adjust_patient_balance', 'enforce_patient_field_permissions'].includes(name)) continue;
  console.log(`\n=== ${name} (${row.identity_args || ''}) ===`);
  const definition = row.definition || row.routine_definition || '';
  console.log(definition);
}
for (const [name, value] of Object.entries(raw.createStatements || {})) {
  if (!['settle_invoice_atomic', 'adjust_patient_balance', 'enforce_patient_field_permissions'].includes(name)) continue;
  if (value?.error) console.log(`\n=== ${name} ERROR ===\n${value.error}`);
}
const cols = (raw.columns || []).filter((c) => ['snap_orders', 'lab_requests', 'invoices', 'invoice_items', 'patients', 'balance_transactions'].includes(c.table_name));
console.log('\n=== RELEVANT COLUMNS ===');
for (const c of cols) console.log(`${c.table_name}.${c.column_name} ${c.data_type}/${c.udt_name} nullable=${c.is_nullable}`);
