import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('DROP FUNCTION IF EXISTS public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS public.write_audit_log(text, text, text, jsonb)');
  await client.query('GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(uuid, numeric, numeric, numeric, text, text, boolean, boolean) TO authenticated');
  await client.query('COMMIT');
  const result = await client.query(`
    SELECT routine_name, specific_name
    FROM information_schema.routines
    WHERE specific_schema = 'public'
      AND routine_name IN ('settle_invoice_atomic', 'write_audit_log')
    ORDER BY routine_name, specific_name
    LIMIT 20
  `);
  console.log(JSON.stringify(result.rows, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
