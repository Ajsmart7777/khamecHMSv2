import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 20000 });

const tables = ['invoices','invoice_items','patients','visits','lab_requests','snap_orders','balance_transactions','audit_logs','corporate_transactions'];
const routines = ['settle_invoice_atomic','advance_journey','write_audit_log','refund_invoice_item','create_lab_request_from_typed'];

await client.connect();
try {
  const columns = await client.query(`
    SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1)
    ORDER BY table_name, ordinal_position
  `, [tables]);
  const functions = await client.query(`SHOW FUNCTIONS FROM public`);
  const affectedFunctions = functions.rows.filter((row) => {
    const name = String(row.function_name ?? row.name ?? '').toLowerCase();
    return routines.includes(name);
  });
  const createStatements = {};
  for (const routine of routines) {
    try {
      const result = await client.query(`SHOW CREATE FUNCTION public.${routine}`);
      createStatements[routine] = result.rows;
    } catch (error) {
      createStatements[routine] = { error: error.message };
    }
  }
  const counts = {};
  for (const table of tables) {
    try {
      const result = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
      counts[table] = result.rows[0]?.count ?? null;
    } catch (error) {
      counts[table] = { error: error.message };
    }
  }
  console.log(JSON.stringify({
    database: (await client.query('SELECT current_database() AS database')).rows[0].database,
    columns: columns.rows,
    affectedFunctions,
    createStatements,
    counts,
  }, null, 2));
} finally {
  await client.end();
}
