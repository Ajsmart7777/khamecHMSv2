import fs from 'fs';
const raw = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/live_balance_guard.json', 'utf8'));
console.log(JSON.stringify(raw, null, 2));
