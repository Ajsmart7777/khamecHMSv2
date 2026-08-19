import fs from 'node:fs';

const raw = fs.readFileSync('/tmp/live_routine_definitions_after.json', 'utf8');
const parsed = JSON.parse(raw);
const collection = parsed.routineRows ?? parsed.functions ?? parsed.routines ?? parsed;
const rows = Array.isArray(collection) ? collection : Object.values(collection);
const affected = rows
  .filter((row) => {
    const text = JSON.stringify(row);
    return text.includes('settle_invoice_atomic') || text.includes('adjust_patient_balance') || text.includes('create_admitted_snap');
  })
  .map((row) => ({
    name: row.routine_name ?? row.name ?? row.identity ?? null,
    args: row.identity_args ?? row.args ?? null,
    hasUnsupported: String(row.routine_definition ?? JSON.stringify(row)).includes('app.allow_balance_write'),
  }));
console.log(JSON.stringify(affected, null, 2));

if (affected.some((row) => row.hasUnsupported)) process.exitCode = 2;

autoCheck();
function autoCheck() {
  if (affected.length === 0) {
    console.error('No affected routines found in saved audit output');
    process.exitCode = 3;
  }
}

// Keep this script read-only: it parses only a locally saved audit artifact.
void autoCheck;
