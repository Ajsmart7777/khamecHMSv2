import pg from 'pg';
import fs from 'fs';
const connectionString = fs.readFileSync('/home/ubuntu/.crdb_connection_string', 'utf8').trim();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const user = await client.query("SELECT id FROM public.auth_users WHERE email = 'admin@gmail.com' LIMIT 1");
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error('admin user not found');
  await client.query("SELECT set_config('hms.user_id', $1, false), set_config('hms.user_role', 'admin', false)", [userId]);
  try {
    await client.query(`SELECT public.settle_invoice_atomic(
      '00000000-0000-0000-0000-000000000000'::uuid,
      0::numeric,
      0::numeric,
      0::numeric,
      'cash'::text,
      NULL::text,
      false::boolean
    )`);
    console.log(JSON.stringify({ resolved: true, outcome: 'unexpected success' }));
  } catch (error) {
    console.log(JSON.stringify({ resolved: true, error: error.message }));
  }
} finally {
  await client.end();
}
