import fs from 'node:fs';

const files = [
  ['/tmp/final_workflow_audit.json', 'workflow audit'],
  ['/tmp/final_cleanliness.json', 'cleanliness probe'],
  ['/tmp/final_signatures.json', 'routine signatures'],
];
for (const [file, label] of files) {
  const raw = fs.readFileSync(file, 'utf8');
  let value;
  try { value = JSON.parse(raw); } catch { console.log(`--- ${label} ---\n${raw.slice(0, 4000)}`); continue; }
  console.log(`--- ${label} ---`);
  if (label === 'cleanliness probe') {
    console.log(JSON.stringify(value, null, 2).slice(0, 12000));
  } else if (label === 'routine signatures') {
    const rows = value.rows ?? value.routineRows ?? value.functions ?? value;
    const list = Array.isArray(rows) ? rows : [];
    const byName = new Map();
    for (const row of list) {
      const name = row.routine_name ?? row.specific_name ?? row.function_name ?? row.name;
      if (name && !byName.has(name)) byName.set(name, row);
    }
    console.log(JSON.stringify([...byName.keys()].filter(n => /settle_invoice_atomic|write_audit_log|adjust_patient_balance|create_admitted_snap/.test(n)), null, 2));
    console.log('containsUnsupportedSetting=', raw.includes('app.allow_balance_write'));
  } else {
    const tables = value.tables ?? value.tableColumns ?? value;
    if (Array.isArray(tables)) {
      console.log(JSON.stringify(tables.filter(x => /patients|visits|invoices|lab_requests|snap_orders|balance|transaction|auth_users/i.test(JSON.stringify(x))).slice(0, 40), null, 2));
    } else {
      console.log(JSON.stringify(value, null, 2).slice(0, 12000));
    }
  }
}
