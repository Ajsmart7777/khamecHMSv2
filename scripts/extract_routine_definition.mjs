import fs from 'fs';
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const name = process.argv[3];
const rows = raw.pgRows || raw.functions || [];
const row = rows.find((item) => item.proname === name);
if (!row) process.exit(2);
const definition = row.definition || row.routine_definition || (row.prosrc ? `CREATE FUNCTION public.${row.proname}(${row.identity_args || ''}) AS $$\n${row.prosrc}\n$$` : '');
console.log(definition);
