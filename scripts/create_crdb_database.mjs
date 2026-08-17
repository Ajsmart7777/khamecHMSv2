import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({ host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud', port: 26257, user: 'dev_walid', password, database: 'defaultdb', ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query('CREATE DATABASE IF NOT EXISTS khamec');
  console.log(JSON.stringify({ created: true, database: 'khamec' }, null, 2));
} finally { await client.end().catch(() => undefined); }
