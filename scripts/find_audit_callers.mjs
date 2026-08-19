import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const result = await client.query(`
  SELECT specific_name, routine_name, data_type, routine_definition
  FROM information_schema.routines
  WHERE specific_schema = 'public'
    AND lower(coalesce(routine_definition, '')) LIKE '%write_audit_log%'
  ORDER BY routine_name, specific_name
  LIMIT 200
`);
console.log(JSON.stringify(result.rows, null, 2));
await client.end();
