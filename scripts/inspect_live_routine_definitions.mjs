import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });
await client.connect();
try {
  const routineRows = await client.query(`
    SELECT routine_schema, routine_name, specific_name, data_type, routine_definition
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name IN ('settle_invoice_atomic','advance_journey','refund_invoice_item','write_audit_log','create_lab_request_from_typed')
    ORDER BY routine_name, specific_name
  `);
  let pgRows = [];
  try {
    pgRows = (await client.query(`
      SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
             pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('settle_invoice_atomic','advance_journey','refund_invoice_item','write_audit_log','create_lab_request_from_typed')
      ORDER BY p.proname, identity_args
    `)).rows;
  } catch (error) {
    pgRows = [{ error: error.message }];
  }
  console.log(JSON.stringify({routineRows: routineRows.rows, pgRows}, null, 2));
} finally {
  await client.end();
}
