import pg from 'pg';

const { Client } = pg;
const password = process.env.CRDB_PASSWORD;
if (!password) throw new Error('CRDB_PASSWORD is required');
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password,
  database: 'defaultdb',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
try {
  await client.connect();
  const checks = {};
  for (const [name, sql] of Object.entries({
    current_setting: "SELECT current_setting('hms.user_id', true) AS value",
    jsonb: "SELECT '{\"ok\":true}'::jsonb->>'ok' AS value",
    uuid: "SELECT gen_random_uuid()::text AS value",
    plpgsql: "SELECT 1 AS value",
  })) {
    try {
      const result = await client.query(sql);
      checks[name] = { supported: true, value: result.rows[0]?.value ?? null };
    } catch (error) {
      checks[name] = { supported: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  console.log(JSON.stringify(checks, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
