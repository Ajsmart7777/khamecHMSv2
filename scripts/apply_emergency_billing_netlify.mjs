import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.CRDB_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) {
  console.log('CRDB migration skipped: connection string is not configured in this build environment.');
  process.exit(0);
}

function splitSql(sql) {
  const statements = [];
  let start = 0;
  let dollarTag = null;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (!quote && !dollarTag && ch === '-' && next === '-') { lineComment = true; i += 1; continue; }
    if (!quote && !dollarTag && ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (quote) {
      if (ch === quote && sql[i - 1] !== '\\') {
        if (quote === "'" && next === "'") { i += 1; } else quote = null;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; dollarTag = null; }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) { dollarTag = match[0]; i += dollarTag.length - 1; continue; }
    }
    if (ch === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

const [mainSql, repairSql, patientFeeSql, manualEmergencySql, clinicalLabSql, sharedClinicalConstraintSql, payrollSafetySql, payrollBatchSql, unifiedEmergencyLabSql, emergencyLabBackfillSql, emergencyLabRepairSql, emergencyCategoryBillingSql, fadimatuRepairSql, reconciliationSql, directAdmissionSql, fulfilledSnapWorkflowSql, staffFamilySalaryDeductionSql, salaryDeductionMarkerRepairSql, pharmacyDischargeAndAmountRepairSql, emergencyBillingNeverAffectsPatientFlowSql, emergencySingleInvoiceSql] = await Promise.all([
  fs.readFile(new URL('../supabase/migrations/20260825162000_separate_emergency_billing.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260825170000_repair_emergency_billing_trigger_order.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826090000_fix_patient_fee_role_context.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826100000_manual_emergency_invoice_lines.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826110000_shared_clinical_lab_result_routing.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260827130000_allow_shared_clinical_lab_results.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260814144431_payroll_transfer_state_safety.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826130000_optional_payroll_batches.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260827140000_unify_emergency_lab_queue.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260827143000_backfill_emergency_lab_queue.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260827150000_repair_legacy_emergency_lab_queue.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260827160000_emergency_category_billing.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260829150000_repair_fadimatu_alqaseem_dispensed_status.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260830110000_sponsor_month_end_reconciliation.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260830130000_direct_admission_without_snap.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260831120000_fix_fulfilled_snap_workflow.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260901103000_fix_staff_family_salary_deduction_visibility.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260901120000_repair_salary_deduction_marker.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260901130000_repair_pharmacy_discharge_and_staff_deduction_amounts.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260903120000_emergency_billing_never_affects_patient_flow.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260903150000_emergency_single_invoice_billing.sql', import.meta.url), 'utf8'),
]);
const mainStatements = splitSql(mainSql);
const repairStatements = splitSql(repairSql);
const patientFeeStatements = splitSql(patientFeeSql);
const manualEmergencyStatements = splitSql(manualEmergencySql);
const clinicalLabStatements = splitSql(clinicalLabSql);
const sharedClinicalConstraintStatements = splitSql(sharedClinicalConstraintSql);
const payrollSafetyStatements = splitSql(payrollSafetySql);
const payrollBatchStatements = splitSql(payrollBatchSql);
const unifiedEmergencyLabStatements = splitSql(unifiedEmergencyLabSql);
const emergencyLabBackfillStatements = splitSql(emergencyLabBackfillSql);
const emergencyLabRepairStatements = splitSql(emergencyLabRepairSql);
const emergencyCategoryBillingStatements = splitSql(emergencyCategoryBillingSql);
const fadimatuRepairStatements = splitSql(fadimatuRepairSql);
const reconciliationStatements = splitSql(reconciliationSql);
const directAdmissionStatements = splitSql(directAdmissionSql);
const fulfilledSnapWorkflowStatements = splitSql(fulfilledSnapWorkflowSql);
const staffFamilySalaryDeductionStatements = splitSql(staffFamilySalaryDeductionSql);
const salaryDeductionMarkerRepairStatements = splitSql(salaryDeductionMarkerRepairSql);
const pharmacyDischargeAndAmountRepairStatements = splitSql(pharmacyDischargeAndAmountRepairSql);
const emergencyBillingNeverAffectsPatientFlowStatements = splitSql(emergencyBillingNeverAffectsPatientFlowSql);
const emergencySingleInvoiceStatements = splitSql(emergencySingleInvoiceSql);
const completeEmergency = mainStatements.find(sql => sql.includes('CREATE OR REPLACE FUNCTION public.complete_emergency_billing_draft('));
const repairByPrefix = prefix => repairStatements.find(sql => sql.trimStart().startsWith(prefix));
const dropSnapTrigger = repairByPrefix('DROP TRIGGER');
const dropInvoiceTrigger = repairStatements.find(sql => sql.includes('DROP TRIGGER') && sql.includes('invoices_require_emergency_billing'));
const autoFinalize = repairByPrefix('CREATE OR REPLACE FUNCTION public.auto_finalize_emergency_for_normal_order');
const preventGate = repairByPrefix('CREATE OR REPLACE FUNCTION public.prevent_invoice_before_emergency_billing');
const createSnapTrigger = repairByPrefix('CREATE TRIGGER snap_orders_auto_finalize_emergency');
const createInvoiceTrigger = repairByPrefix('CREATE TRIGGER invoices_require_emergency_billing');
const grants = repairStatements.filter(sql => sql.trimStart().startsWith('GRANT EXECUTE'));
const emergencyStatements = [dropSnapTrigger, dropInvoiceTrigger, completeEmergency, autoFinalize, preventGate, createSnapTrigger, createInvoiceTrigger, ...grants];
if (emergencyStatements.some(statement => !statement)) throw new Error('Emergency migration runner could not assemble the required SQL statements.');
const migrations = [
  { version: '20260825170000_repair_emergency_billing_trigger_order', statements: emergencyStatements },
  { version: '20260826090000_fix_patient_fee_role_context', statements: patientFeeStatements },
  { version: '20260826100000_manual_emergency_invoice_lines', statements: manualEmergencyStatements },
  { version: '20260826110000_shared_clinical_lab_result_routing', statements: clinicalLabStatements },
  { version: '20260827130000_allow_shared_clinical_lab_results', statements: sharedClinicalConstraintStatements },
  { version: '20260814144431_payroll_transfer_state_safety', statements: payrollSafetyStatements },
  { version: '20260826130000_optional_payroll_batches', statements: payrollBatchStatements },
  { version: '20260827140000_unify_emergency_lab_queue', statements: unifiedEmergencyLabStatements },
  { version: '20260827143000_backfill_emergency_lab_queue', statements: emergencyLabBackfillStatements },
  { version: '20260827150000_repair_legacy_emergency_lab_queue', statements: emergencyLabRepairStatements },
  { version: '20260827160000_emergency_category_billing', statements: emergencyCategoryBillingStatements },
  { version: '20260829150000_repair_fadimatu_alqaseem_dispensed_status', statements: fadimatuRepairStatements },
  { version: '20260830110000_sponsor_month_end_reconciliation', statements: reconciliationStatements },
  { version: '20260830130000_direct_admission_without_snap', statements: directAdmissionStatements },
  { version: '20260831120000_fix_fulfilled_snap_workflow', statements: fulfilledSnapWorkflowStatements },
  { version: '20260901103000_fix_staff_family_salary_deduction_visibility', statements: staffFamilySalaryDeductionStatements },
  { version: '20260901120000_repair_salary_deduction_marker', statements: salaryDeductionMarkerRepairStatements },
  { version: '20260901130000_repair_pharmacy_discharge_and_staff_deduction_amounts', statements: pharmacyDischargeAndAmountRepairStatements },
  { version: '20260903120000_emergency_billing_never_affects_patient_flow', statements: emergencyBillingNeverAffectsPatientFlowStatements },
  { version: '20260903150000_emergency_single_invoice_billing', statements: emergencySingleInvoiceStatements },
];

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 300000 });
try {
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS public.hms_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  // CockroachDB runs DDL through background schema-change jobs. Each DDL
  // statement is sent separately, and trigger/function replacements are retried
  // while the preceding DROP/TRIGGER job finishes propagating.
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ddl = /^(DROP TRIGGER|CREATE TRIGGER|CREATE OR REPLACE FUNCTION|CREATE TABLE|ALTER TABLE|GRANT|REVOKE)/i;
  const retryableSchemaChange = /already exists|active trigger|schema change|descriptor|being modified|only implemented in the declarative schema changer/i;
  for (const migration of migrations) {
    const existing = await client.query('SELECT version FROM public.hms_schema_migrations WHERE version = $1 LIMIT 1', [migration.version]);
    if (existing.rowCount) {
      console.log(`CRDB migration already applied: ${migration.version}`);
      continue;
    }
    for (const statement of migration.statements) {
      let lastError;
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        try {
          await client.query(statement);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          // A previous partial run may have recreated a trigger before its
          // migration marker was written. The function definitions are already
          // authoritative, so an existing trigger with the same name is safe.
          if (/^CREATE TRIGGER/i.test(statement) && /already exists/i.test(message)) {
            lastError = undefined;
            break;
          }
          if (!ddl.test(statement) || !retryableSchemaChange.test(message) || attempt === 12) throw error;
          await sleep(Math.min(2500, 350 + attempt * 250));
        }
      }
      if (lastError) throw lastError;
      if (/^(DROP TRIGGER|CREATE TRIGGER)/i.test(statement)) await sleep(1000);
    }
    await client.query('INSERT INTO public.hms_schema_migrations(version) VALUES ($1)', [migration.version]);
    console.log(`CRDB migration applied: ${migration.version}`);
  }
} finally {
  await client.end().catch(() => undefined);
}
