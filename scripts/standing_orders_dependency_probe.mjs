import pg from 'pg';
import fs from 'fs';

const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const triggers = await client.query(`
  SELECT trigger_name, event_manipulation, action_statement
  FROM information_schema.triggers
  WHERE event_object_schema = 'public'
    AND event_object_table = 'standing_orders'
  ORDER BY trigger_name, event_manipulation
  LIMIT 50
`);

const routines = await client.query(`
  SELECT routine_name, routine_type, data_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND (lower(routine_definition) LIKE '%external_doctor_id%' OR lower(routine_definition) LIKE '%external_doctor_name%')
  ORDER BY routine_name
  LIMIT 50
`);

const table = await client.query('SHOW CREATE TABLE public.standing_orders');
console.log(JSON.stringify({ triggers: triggers.rows, routines: routines.rows, show_create_table: table.rows }, null, 2));
await client.end();
