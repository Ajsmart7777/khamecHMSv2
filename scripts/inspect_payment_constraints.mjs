import fs from 'node:fs';
import pg from 'pg';
const connectionString = process.env.CRDB_CONNECTION_STRING || fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString });
async function main() {
  await client.connect();
  try {
    const tables = ['patients', 'invoices', 'balance_transactions'];
    const columns = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
    `, [tables]);
    const constraints = await client.query(`
      SELECT table_name, constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, constraint_name
    `, [tables]);
    const create = await client.query(`SHOW CREATE TABLE public.balance_transactions`);
    console.log(JSON.stringify({ columns: columns.rows, constraints: constraints.rows, balanceTransactionsCreate: create.rows }, null, 2));
  } finally { await client.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
