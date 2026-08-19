import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const statements = [
  'DROP FUNCTION IF EXISTS public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean)',
  'DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, uuid, text, text)',
  'DROP FUNCTION IF EXISTS public.write_audit_log(text, jsonb, text, text, text)',
  'DROP FUNCTION IF EXISTS public.write_audit_log(text, text, text, jsonb)',
];
await client.query('BEGIN');
for (const sql of statements) {
  try {
    await client.query(sql);
    console.log(`OK ${sql}`);
  } catch (error) {
    console.log(`FAIL ${sql}: ${error.message}`);
  }
}
await client.query('ROLLBACK');
await client.end();
