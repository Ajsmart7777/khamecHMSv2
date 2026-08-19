import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('/home/ubuntu/crdb_audit_callers.json', 'utf8'));
for (const row of rows) {
  const def = String(row.routine_definition || '').replace(/\\n/g, '\n');
  const calls = [];
  let start = 0;
  while (true) {
    const pos = def.toLowerCase().indexOf('write_audit_log', start);
    if (pos < 0) break;
    const snippet = def.slice(Math.max(0, pos - 40), Math.min(def.length, pos + 220)).replace(/\s+/g, ' ');
    calls.push(snippet);
    start = pos + 15;
  }
  console.log(`${row.routine_name} [${row.specific_name}]`);
  for (const call of calls) console.log(`  ${call}`);
}
