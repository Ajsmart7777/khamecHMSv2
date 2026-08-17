import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const config = {
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
};
const client = new Client({ ...config, database: 'defaultdb' });
try {
  await client.connect();
  await client.query('DROP DATABASE IF EXISTS khamec CASCADE');
  await client.query('CREATE DATABASE khamec');
  console.log(JSON.stringify({ reset: true, database: 'khamec' }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
