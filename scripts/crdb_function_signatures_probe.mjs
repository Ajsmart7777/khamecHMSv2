import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const routines = await client.query(`
  SELECT specific_schema, specific_name, routine_name, data_type, routine_definition
  FROM information_schema.routines
  WHERE specific_schema = 'public'
    AND routine_name IN ('settle_invoice_atomic', 'write_audit_log')
  ORDER BY routine_name, specific_name
  LIMIT 20
`);
const params = await client.query(`
  SELECT specific_name, ordinal_position, parameter_name, parameter_mode, data_type, udt_name, parameter_default
  FROM information_schema.parameters
  WHERE specific_schema = 'public'
    AND specific_name LIKE ANY (ARRAY['settle_invoice_atomic_%', 'write_audit_log_%'])
  ORDER BY specific_name, ordinal_position
  LIMIT 100
`);
console.log(JSON.stringify({ routines: routines.rows, parameters: params.rows }, null, 2));
await client.end();
