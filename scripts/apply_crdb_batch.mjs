import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
const database = process.env.CRDB_DATABASE ?? 'khamec';
const batchPath = process.argv[2];
if (!password || !batchPath) throw new Error('CRDB_PASSWORD and batch path are required');
const sql = await fs.readFile(batchPath, 'utf8');
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  database,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
try {
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    console.log(JSON.stringify({ applied: true, batch: batchPath }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(JSON.stringify({ applied: false, batch: batchPath, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
} finally {
  await client.end().catch(() => undefined);
}
