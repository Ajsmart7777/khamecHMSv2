import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const result = {};
const tables = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('external_doctors', 'standing_orders')
  ORDER BY table_name
  LIMIT 10
`);
const presentTables = new Set(tables.rows.map((row) => row.table_name));
result.present_tables = tables.rows.map((row) => row.table_name);

for (const table of ['external_doctors', 'standing_orders']) {
  if (presentTables.has(table)) {
    const count = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
    result[`${table}_count`] = count.rows[0].count;
  } else {
    result[`${table}_count`] = null;
  }
}

if (presentTables.has('standing_orders')) {
  const standingColumns = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'standing_orders'
      AND column_name IN ('external_doctor_id', 'external_doctor_name')
    ORDER BY column_name
    LIMIT 10
  `);
  result.standing_orders_legacy_columns = standingColumns.rows.map((row) => row.column_name);
} else {
  result.standing_orders_legacy_columns = [];
}

const foreignKeys = await client.query(`
  SELECT tc.constraint_name, tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND (tc.table_name = 'standing_orders' OR ccu.table_name = 'external_doctors')
  ORDER BY tc.table_name, tc.constraint_name
  LIMIT 50
`);
result.foreign_keys = foreignKeys.rows;

console.log(JSON.stringify(result, null, 2));
await client.end();
