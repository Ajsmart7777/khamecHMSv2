import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: process.env.CRDB_DATABASE ?? 'khamec',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  query_timeout: 10000,
});
await client.connect();
const result = await client.query("SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public'");
console.log(JSON.stringify(result.rows));
await client.end();

