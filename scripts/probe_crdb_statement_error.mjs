import fs from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;
const payload = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const statement = payload.sqlStatements[31];
const client = new Client({ host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud', port: 26257, user: 'dev_walid', password: process.env.CRDB_PASSWORD, database: 'khamec', ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(statement);
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: error.message, code: error.code, position: error.position, detail: error.detail, hint: error.hint, where: error.where }, null, 2));
} finally { await client.end().catch(() => undefined); }
