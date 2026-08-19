import fs from 'fs';
const raw = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/live_balance_guard.json', 'utf8'));
const rows = raw.pgRows || raw.functions || [];
for (const row of rows) {
  const text = JSON.stringify(row);
  if (text.includes('app.allow_balance_write')) {
    console.log(JSON.stringify({ proname: row.proname, identity_args: row.identity_args, oid: row.oid }, null, 2));
  }
}
