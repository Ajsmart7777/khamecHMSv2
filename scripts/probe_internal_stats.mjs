import pg from 'pg';

const { Client } = pg;
const client = new Client({
  host: process.env.CRDB_HOST || 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: Number(process.env.CRDB_PORT || 26257),
  database: process.env.CRDB_DATABASE || 'khamec',
  user: process.env.CRDB_USER || 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  query_timeout: 20000,
});

await client.connect();
try {
  const relations = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'crdb_internal'
      AND (table_name ILIKE '%size%' OR table_name ILIKE '%stat%' OR table_name ILIKE '%storage%')
    ORDER BY table_name
  `);
  console.log(JSON.stringify(relations.rows, null, 2));
  const columns = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'crdb_internal'
      AND table_name = 'table_row_statistics'
    ORDER BY ordinal_position
  `);
  console.log(JSON.stringify(columns.rows, null, 2));
  await client.query("SELECT set_config('allow_unsafe_internals', 'true', false)");
  const storeColumns = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'crdb_internal'
      AND table_name = 'kv_store_status'
    ORDER BY ordinal_position
  `);
  console.log(JSON.stringify(storeColumns.rows, null, 2));
  const storeStats = await client.query('SELECT * FROM crdb_internal.kv_store_status LIMIT 2');
  console.log(JSON.stringify(storeStats.rows, null, 2));
  const routines = await client.query(`
    SELECT routine_schema, routine_name, data_type
    FROM information_schema.routines
    WHERE routine_schema IN ('crdb_internal', 'public')
      AND (routine_name ILIKE '%size%' OR routine_name ILIKE '%stat%')
    ORDER BY routine_schema, routine_name
    LIMIT 50
  `);
  console.log(JSON.stringify(routines.rows, null, 2));
} finally {
  await client.end();
}
