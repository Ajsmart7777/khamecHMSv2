import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
const database = process.env.CRDB_DATABASE ?? 'khamec';
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  database,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000,
});
await client.connect();
for (const table of ['patients', 'admissions', 'invoice_items']) {
  const result = await client.query(`SHOW COLUMNS FROM public.${table}`);
  console.log(JSON.stringify({ table, columns: result.rows.map((row) => row.column_name) }, null, 2));
}
await client.end();
