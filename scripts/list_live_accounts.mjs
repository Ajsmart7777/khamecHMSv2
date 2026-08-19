import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const accounts = await client.query(`
  SELECT email, created_at, updated_at
  FROM public.auth_users
  ORDER BY email
  LIMIT 20
`);
const patients = await client.query(`
  SELECT first_name, last_name, status, account_type
  FROM public.patients
  ORDER BY first_name, last_name
  LIMIT 20
`);
console.log(JSON.stringify({ accounts: accounts.rows, patients: patients.rows }, null, 2));
await client.end();
