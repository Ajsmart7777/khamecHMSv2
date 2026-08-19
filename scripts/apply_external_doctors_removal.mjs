import fs from 'node:fs';
import pg from 'pg';

const migrationPath = '/home/ubuntu/khameccockroach-repo/supabase/migrations/20260819143000_remove_external_doctor_feature.sql';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const sql = fs.readFileSync(migrationPath, 'utf8');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(JSON.stringify({ applied: true, migration: migrationPath }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
