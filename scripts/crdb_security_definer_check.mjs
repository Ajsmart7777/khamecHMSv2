import pg from 'pg';
const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({ host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud', port: 26257, user: 'dev_walid', password, database: 'defaultdb', ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS crdb_probe');
    await client.query('CREATE TABLE IF NOT EXISTS crdb_probe.items (id UUID PRIMARY KEY DEFAULT gen_random_uuid())');
    await client.query(`CREATE OR REPLACE FUNCTION crdb_probe.read_items() RETURNS INT LANGUAGE SQL SECURITY DEFINER AS $$ SELECT count(*)::INT FROM crdb_probe.items $$`);
    const result = await client.query('SELECT crdb_probe.read_items() AS value');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ supported: true, value: result.rows[0]?.value ?? null }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.log(JSON.stringify({ supported: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  }
} finally { await client.end().catch(() => undefined); }
