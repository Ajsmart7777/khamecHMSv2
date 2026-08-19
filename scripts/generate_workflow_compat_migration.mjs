import fs from 'fs';

const defs = JSON.parse(fs.readFileSync('/tmp/live_routine_definitions.json', 'utf8'));
const balance = JSON.parse(fs.readFileSync('/tmp/live_balance_guard_summary.txt', 'utf8'));
const wanted = new Set(['adjust_patient_balance', 'create_admitted_snap', 'settle_invoice_atomic', 'enforce_patient_field_permissions']);
const pgRows = (defs.pgRows || []).filter((row) => wanted.has(row.proname));
const byName = new Map(pgRows.map((row) => [row.proname, row.definition]));
const fallbackRows = balance.functions || [];
for (const row of fallbackRows) {
  if (!byName.has(row.proname)) {
    const args = row.identity_args || '';
    const returnType = row.proname === 'adjust_patient_balance' ? 'DECIMAL' : row.proname === 'create_admitted_snap' ? 'UUID' : 'trigger';
    const stripBalanceConfig = (source) => String(source || '')
      .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write':::STRING, 'on':::STRING, true\);/g, "\nSELECT set_config('application_name', 'hms-balance-write', true);")
      .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write':::STRING, 'off':::STRING, true\);/g, "\nSELECT set_config('application_name', '', true);")
      .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write', 'on', true\);/g, "\nSELECT set_config('application_name', 'hms-balance-write', true);")
      .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write', 'off', true\);/g, "\nSELECT set_config('application_name', '', true);");
    const body = stripBalanceConfig(row.prosrc || '');
    const headers = {
      adjust_patient_balance: '(_patient_id UUID, _delta DECIMAL, _transaction_type STRING, _payment_method STRING DEFAULT NULL::STRING, _related_request_id UUID DEFAULT NULL::UUID, _related_invoice_id UUID DEFAULT NULL::UUID, _notes STRING DEFAULT NULL::STRING)',
      create_admitted_snap: '(_patient_id UUID, _order_type STRING, _target_station STRING, _photo_path STRING, _note STRING, _items JSONB, _total DECIMAL, _allow_debt BOOL DEFAULT false, _debt_reason STRING DEFAULT NULL::STRING)',
      settle_invoice_atomic: '(_invoice_id UUID, _cash_amount DECIMAL DEFAULT 0::DECIMAL, _balance_amount DECIMAL DEFAULT 0::DECIMAL, _debt_amount DECIMAL DEFAULT 0::DECIMAL, _payment_method STRING DEFAULT \'cash\'::STRING, _notes STRING DEFAULT NULL::STRING, _sponsored BOOL DEFAULT false, _is_salary_deduction BOOL DEFAULT false)',
      enforce_patient_field_permissions: '()',
    };
    byName.set(row.proname, `CREATE OR REPLACE FUNCTION public.${row.proname}${headers[row.proname] || `(${args})`} RETURNS ${returnType} LANGUAGE plpgsql SECURITY DEFINER AS $$${body}$$;`);
  }
}
let out = `-- CockroachDB compatibility repair for cashier, lab results, and billing JSONB writes\n`;
out += `-- Generated from read-only live routine definitions; review before applying to another database.\n\n`;
out += `ALTER TABLE public.snap_orders ADD COLUMN IF NOT EXISTS result_text STRING;\n`;
out += `COMMENT ON COLUMN public.snap_orders.result_text IS 'Typed laboratory result returned to the requesting clinical station';\n`;
out += `CREATE INDEX IF NOT EXISTS idx_snap_orders_result_text ON public.snap_orders (result_text) WHERE result_text IS NOT NULL;\n`;
out += `ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS check_balance_non_negative;\n`;
out += `ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS check_transaction_type;\n`;
out += `ALTER TABLE public.balance_transactions DROP CONSTRAINT IF EXISTS balance_transactions_transaction_type_check;\n`;
out += `ALTER TABLE public.balance_transactions ADD CONSTRAINT balance_transactions_transaction_type_check CHECK (transaction_type IN ('topup','refund','invoice_deduction','staff_family_coverage','staff_coverage','adjustment','debt_incurred','debt_cleared','admitted_deduction','overpayment_credit','manual_adjustment'));\n\n`;
for (const name of ['adjust_patient_balance', 'create_admitted_snap', 'settle_invoice_atomic']) {
  const definition = byName.get(name);
  if (!definition) throw new Error(`Missing live definition for ${name}`);
  out += definition
    .replace(/^CREATE FUNCTION public\./, 'CREATE OR REPLACE FUNCTION public.')
    .replace(/^CREATE OR REPLACE FUNCTION public\.settle_invoice_atomic\([^\n]+/m, "CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(_invoice_id UUID, _cash_amount DECIMAL DEFAULT 0::DECIMAL, _balance_amount DECIMAL DEFAULT 0::DECIMAL, _debt_amount DECIMAL DEFAULT 0::DECIMAL, _payment_method STRING DEFAULT 'cash'::STRING, _notes STRING DEFAULT NULL::STRING, _sponsored BOOL DEFAULT false, _is_salary_deduction BOOL DEFAULT false)")
    .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write':::STRING, 'on':::STRING, true\);/g, "\nSELECT set_config('application_name', 'hms-balance-write', true);")
    .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write':::STRING, 'off':::STRING, true\);/g, "\nSELECT set_config('application_name', '', true);")
    .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write', 'on', true\);/g, "\nSELECT set_config('application_name', 'hms-balance-write', true);")
    .replace(/\s*SELECT\s+set_config\('app\.allow_balance_write', 'off', true\);/g, "\nSELECT set_config('application_name', '', true);")
    .replace(/\$\$\s*$/, () => '$$;')
    + '\n\n';
}
const enforce = byName.get('enforce_patient_field_permissions');
if (enforce) {
  out += enforce
    .replaceAll("current_setting('app.allow_balance_write', true)", "current_setting('application_name', true)")
    .replaceAll("COALESCE(current_setting('application_name', true), '') != 'on'", "COALESCE(current_setting('application_name', true), '') != 'hms-balance-write'")
    + '\n';
}
fs.writeFileSync('/home/ubuntu/khameccockroach-repo/supabase/migrations/20260819120000_crdb_workflow_compatibility.sql', out);
console.log(`generated ${out.length} bytes`);
console.log([...byName.keys()].join(', '));
