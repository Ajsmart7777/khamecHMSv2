import fs from 'node:fs';
import pg from 'pg';
const connectionString = process.env.CRDB_CONNECTION_STRING || fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString });
async function main() {
  await client.connect();
  try {
    const result = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('patients','invoices','balance_requests','balance_transactions','snap_orders')
      ORDER BY table_name, ordinal_position
    `);
    const names = new Set(['balance','total_amount','paid_amount','status','debt_amount','debt_reason','invoice_id','patient_id','amount','request_type','request_status','reason','notes','transaction_type','balance_before','balance_after']);
    console.log(JSON.stringify(result.rows.filter((row) => names.has(row.column_name)), null, 2));
  } finally { await client.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
