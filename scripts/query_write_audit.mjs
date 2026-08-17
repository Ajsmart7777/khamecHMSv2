import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: 26257,
  user: 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: 'khamec',
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const result = await client.query("SELECT specific_schema, specific_name, ordinal_position, parameter_name, parameter_mode, data_type, udt_name FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'write_audit_log_%' ORDER BY specific_name, ordinal_position LIMIT 40");
console.log(JSON.stringify(result.rows, null, 2));
await client.end();
