import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const version = '20260825170000_repair_emergency_billing_trigger_order';
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

const [mainSql, repairSql] = await Promise.all([
  fs.readFile(new URL('../supabase/migrations/20260825162000_separate_emergency_billing.sql', import.meta.url), 'utf8'),
  fs.readFile(new URL('../supabase/migrations/20260825170000_repair_emergency_billing_trigger_order.sql', import.meta.url), 'utf8'),
]);
const mainStatements = splitSql(mainSql);
const repairStatements = splitSql(repairSql);
const completeEmergency = mainStatements.find(sql => sql.includes('CREATE OR REPLACE FUNCTION public.complete_emergency_billing_draft('));
const repairByPrefix = prefix => repairStatements.find(sql => sql.trimStart().startsWith(prefix));
const dropSnapTrigger = repairByPrefix('DROP TRIGGER');
const dropInvoiceTrigger = repairStatements.find(sql => sql.includes('DROP TRIGGER') && sql.includes('invoices_require_emergency_billing'));
const autoFinalize = repairByPrefix('CREATE OR REPLACE FUNCTION public.auto_finalize_emergency_for_normal_order');
const preventGate = repairByPrefix('CREATE OR REPLACE FUNCTION public.prevent_invoice_before_emergency_billing');
const createSnapTrigger = repairByPrefix('CREATE TRIGGER snap_orders_auto_finalize_emergency');
const createInvoiceTrigger = repairByPrefix('CREATE TRIGGER invoices_require_emergency_billing');
const grants = repairStatements.filter(sql => sql.trimStart().startsWith('GRANT EXECUTE'));
const required = [dropSnapTrigger, dropInvoiceTrigger, completeEmergency, autoFinalize, preventGate, createSnapTrigger, createInvoiceTrigger, ...grants];
if (required.some(statement => !statement)) throw new Error('Emergency migration runner could not assemble the required SQL statements.');

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 300000 });
try {
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS public.hms_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const existing = await client.query('SELECT version FROM public.hms_schema_migrations WHERE version = $1 LIMIT 1', [version]);
  if (existing.rowCount) {
    console.log(`CRDB migration already applied: ${version}`);
    process.exit(0);
  }
  // Every DDL statement is deliberately sent in its own implicit transaction.
  for (const statement of required) await client.query(statement);
  await client.query('INSERT INTO public.hms_schema_migrations(version) VALUES ($1)', [version]);
  console.log(`CRDB migration applied: ${version}`);
} finally {
  await client.end().catch(() => undefined);
}
