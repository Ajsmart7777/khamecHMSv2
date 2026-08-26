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

const [mainSql, repairSql, patientFeeSql, manualEmergencySql, clinicalLabSql] = await Promise.all([
  fs.readFile(new URL('../supabase/migrations/20260825162000_separate_emergency_billing.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260825170000_repair_emergency_billing_trigger_order.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826090000_fix_patient_fee_role_context.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826100000_manual_emergency_invoice_lines.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260826110000_shared_clinical_lab_result_routing.sql', import.meta.url), 'utf8'),
]);
const mainStatements = splitSql(mainSql);
const repairStatements = splitSql(repairSql);
const patientFeeStatements = splitSql(patientFeeSql);
const manualEmergencyStatements = splitSql(manualEmergencySql);
const clinicalLabStatements = splitSql(clinicalLabSql);
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
