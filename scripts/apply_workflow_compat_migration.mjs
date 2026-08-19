import fs from 'fs';
import pg from 'pg';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const sql = fs.readFileSync('/home/ubuntu/khameccockroach-repo/supabase/migrations/20260819120000_crdb_workflow_compatibility.sql', 'utf8');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('workflow compatibility migration applied');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error(`migration failed: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
