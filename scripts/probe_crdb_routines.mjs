import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: process.env.CRDB_DATABASE ?? 'khamec',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  query_timeout: 15000,
});
await client.connect();
const result = await client.query(`
  SHOW FUNCTIONS FROM public
`);
console.log(JSON.stringify({ database: (await client.query('SELECT current_database() AS database')).rows[0].database, rowCount: result.rows.length, columns: result.fields.map((field) => field.name), rows: result.rows.slice(0, 200) }, null, 2));
await client.end();
