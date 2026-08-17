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
  const server = await client.query(`
    SELECT version() AS version,
           current_database() AS database,
           current_user AS current_user
  `);
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS public_tables,
      (SELECT count(*)::int FROM information_schema.routines WHERE routine_schema = 'public') AS public_routines,
      (SELECT count(*)::int FROM information_schema.triggers WHERE trigger_schema = 'public') AS public_triggers
  `);
  console.log(JSON.stringify({ connected: true, server: server.rows[0], counts: counts.rows[0] }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
