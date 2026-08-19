import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('/tmp/workflow_function_headers.json', 'utf8'));
for (const row of rows) {
  const def = row.definition || '';
  const header = def.slice(0, def.indexOf('AS $$')).replace(/\s+/g, ' ').trim();
  console.log(`${row.name}(${row.identity_args})`);
  console.log(header);
}
