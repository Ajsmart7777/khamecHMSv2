import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const result = await client.query(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'patients'
  ORDER BY ordinal_position
  LIMIT 100
`);
console.log(JSON.stringify(result.rows, null, 2));
await client.end();
