import pg from 'pg';

const { Client } = pg;
const client = new Client({
  host: process.env.CRDB_HOST || 'swell-gorgon-32055.j77.aws-eu-central-1.cockroachlabs.cloud',
  port: Number(process.env.CRDB_PORT || 26257),
  user: process.env.CRDB_USER || 'dev_walid',
  password: process.env.CRDB_PASSWORD,
  database: process.env.CRDB_DATABASE || 'khamec',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const statements = [
  `DROP TRIGGER IF EXISTS crdb_probe_invoice_trigger ON public.invoices`,
  `DROP FUNCTION IF EXISTS public.crdb_probe_invoice_trigger()`,
  `CREATE OR REPLACE FUNCTION public.crdb_probe_invoice_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'UPDATE public.visits v SET total_charged = COALESCE((SELECT SUM(total_amount) FROM public.invoices WHERE visit_id = $1), 0) WHERE v.id = $1' USING CASE WHEN TG_OP = 'DELETE' THEN (OLD).visit_id ELSE (NEW).visit_id END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$`,
  `CREATE TRIGGER crdb_probe_invoice_trigger AFTER INSERT OR UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.crdb_probe_invoice_trigger()`,
];
try {
  for (const sql of statements) {
    await client.query(sql);
    console.log(JSON.stringify({ ok: true, sql: sql.split('\\n')[0] }));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code, message: error.message, detail: error.detail, hint: error.hint }));
  process.exitCode = 1;
} finally {
  try { await client.query('DROP TRIGGER IF EXISTS crdb_probe_invoice_trigger ON public.invoices'); } catch {}
  try { await client.query('DROP FUNCTION IF EXISTS public.crdb_probe_invoice_trigger()'); } catch {}
  await client.end();
}
