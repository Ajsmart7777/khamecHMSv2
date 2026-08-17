import fs from 'node:fs/promises';
const path = process.argv[2];
const payload = JSON.parse(await fs.readFile(path, 'utf8'));
for (const [index, sql] of (payload.sqlStatements || []).entries()) {
  if (/discharge_admission|bill_admission_bed_days|apply_wallet_to_outstanding|adjust_patient_balance|create_admitted_snap|has_wallet|copay_percent/i.test(sql)) {
    console.log(`--- statement ${index + 1} ---`);
    if (process.env.FULL === '1' || index + 1 >= 50) console.log(sql);
    else console.log(sql.slice(0, 220).replace(/\n/g, ' '));
  }
}
console.log(`total=${(payload.sqlStatements || []).length}`);
