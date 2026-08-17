import pg from 'pg';
const {Client}=pg;
const c=new Client({host:'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',port:26257,user:'dev_walid',password:process.env.CRDB_PASSWORD,database:'khamec',ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query("SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('corporate_accounts','patients','invoices','sponsor_statements','sponsor_statement_items') AND column_name IN ('id','corporate_id','patient_id','sponsor_id','statement_id','account_type','created_at') ORDER BY table_name, column_name LIMIT 50");
console.log(JSON.stringify(r.rows,null,2));
await c.end();
