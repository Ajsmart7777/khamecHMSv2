import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: process.env.CRDB_HOST || 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: Number(process.env.CRDB_PORT || 26257),
  user: process.env.CRDB_USER || 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: process.env.CRDB_DATABASE || 'khamec',
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const tables = await client.query(`SHOW TABLES FROM public`);
const functions = await client.query(`SHOW FUNCTIONS FROM public`);
const selected = functions.rows;
console.log(JSON.stringify({ tableCount: tables.rows.length, selected }, null, 2));
await client.end();
