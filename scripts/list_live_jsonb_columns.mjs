import fs from 'fs';
const raw = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/audit_live_workflows.json', 'utf8'));
const columns = raw.columns || [];
for (const c of columns) {
  if (String(c.udt_name).toLowerCase() === 'jsonb' || String(c.data_type).toLowerCase() === 'jsonb') {
    console.log(`${c.table_name}.${c.column_name} ${c.data_type}/${c.udt_name}`);
  }
}
