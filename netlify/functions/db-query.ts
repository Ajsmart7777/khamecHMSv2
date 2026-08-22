import type { Handler } from '@netlify/functions';
import { getCrdbPool } from './_shared/crdb.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertTable(table: unknown): asserts table is string {
  assertIdentifier(table, 'table name');
}

function normalizeRpcValue(value: any): any {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return value;

  // Some Supabase-compatible callers send JSONB values through more than one
  // JSON.stringify layer. In that case the inner object arrives with escaped
  // quotes (for example {\\"name\\":\\"Panadol\\"}), which CockroachDB
  // correctly rejects as JSONB until it is unescaped. Decode only values that
  // clearly look like JSON; ordinary notes and free text are left unchanged.
  let current: any = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1) {
    const candidate = current.trim();
    const looksLikeJson = candidate.startsWith('{') || candidate.startsWith('[') || candidate.startsWith('"');
    if (looksLikeJson) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed === current) break;
        current = parsed;
        continue;
      } catch {
        // Fall through to the escaped-object recovery below.
      }
    }

    // Recover one escaped JSON layer when the payload is visibly an object or
    // array whose quotes were escaped before reaching this endpoint.
    if (candidate.startsWith('{\\"') || candidate.startsWith('[{\\"') || candidate.includes('\\"')) {
      try {
        // A few callers historically double-escaped JSONB before it reached
        // this compatibility gateway (e.g. {\\"medication\\":\\"Panadol\\"}).
        // Remove only JSON quote escapes, then decode the recovered object.
        const unescaped = candidate.replace(/\\"/g, '"');
        const parsed = JSON.parse(unescaped);
        current = parsed;
        continue;
      } catch {
        // It was not valid JSON after all; preserve the original text.
      }
    }
    break;
  }
  return current;
}

const JSONB_COLUMNS: Record<string, Set<string>> = {
  audit_logs: new Set(['details']),
  lab_requests: new Set(['results']),
  patients: new Set(['member_id_data']),
  snap_orders: new Set(['matched_items', 'ocr_matches', 'ocr_reviewed_lines']),
  visits: new Set(['claim_reason_details', 'sponsor_auth']),
};

function normalizeWriteValue(table: string, column: string, value: any): any {
  if (!JSONB_COLUMNS[table]?.has(column)) return value;
  const normalized = normalizeRpcValue(value);
  // node-postgres treats a JavaScript array as a SQL array parameter. JSONB
  // columns need JSON text instead, otherwise CockroachDB receives `{...}` and
  // rejects it even though the payload is a valid JSON array/object.
  return normalized !== null && typeof normalized === 'object'
    ? JSON.stringify(normalized)
    : normalized;
}

function normalizeRows(values: any): Record<string, any>[] {
  const rows = Array.isArray(values) ? values : [values];
  if (!rows.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Write values must be an object or a non-empty array of objects');
  }
  return rows;
}

type FilterOperation = { column: string; operator: string; value: any };

function normalizeFilterOperations(filters: unknown, filterOps: unknown, requireFilter = false): FilterOperation[] {
  const operations: FilterOperation[] = [];

  if (filters !== undefined && filters !== null) {
    if (typeof filters !== 'object' || Array.isArray(filters)) {
      throw new Error('Filters must be an object');
    }
    for (const [column, value] of Object.entries(filters as Record<string, any>)) {
      assertIdentifier(column, 'filter column');
      operations.push({ column, operator: 'eq', value });
    }
  }

  if (filterOps !== undefined && filterOps !== null) {
    if (!Array.isArray(filterOps)) throw new Error('Filter operations must be an array');
    for (const operation of filterOps as any[]) {
      if (!operation || typeof operation !== 'object') throw new Error('Invalid filter operation');
      const { column, operator, value } = operation as FilterOperation;
      assertIdentifier(column, 'filter column');
      if (typeof operator !== 'string' || !/^(eq|in|is|neq|gt|gte|lt|lte|like|ilike|not_(eq|in|is|neq|gt|gte|lt|lte|like|ilike))$/.test(operator)) {
        throw new Error(`Unsupported filter operator: ${operator}`);
      }
      operations.push({ column, operator, value });
    }
  }

  if (requireFilter && operations.length === 0) {
    throw new Error('Write operations require at least one filter');
  }
  return operations;
}

function buildWhereClause(operations: FilterOperation[], params: any[]): string {
  return operations.map(({ column, operator, value }) => {
    const addParam = (param: any) => {
      params.push(param);
      return `$${params.length}`;
    };

    switch (operator) {
      case 'eq':
        return value === null ? `${column} IS NULL` : `${column} = ${addParam(value)}`;
      case 'neq':
        return value === null ? `${column} IS NOT NULL` : `${column} <> ${addParam(value)}`;
      case 'is':
        if (value === null) return `${column} IS NULL`;
        if (value === true) return `${column} IS TRUE`;
        if (value === false) return `${column} IS FALSE`;
        throw new Error('The is filter only supports null, true, or false');
      case 'in': {
        if (!Array.isArray(value)) throw new Error(`The in filter for ${column} must receive an array`);
        if (value.length === 0) return 'FALSE';
        return `${column} IN (${value.map(addParam).join(', ')})`;
      }
      case 'not_in': {
        if (!Array.isArray(value)) throw new Error(`The not.in filter for ${column} must receive an array`);
        if (value.length === 0) return 'TRUE';
        return `${column} NOT IN (${value.map(addParam).join(', ')})`;
      }
      case 'gt': return `${column} > ${addParam(value)}`;
      case 'gte': return `${column} >= ${addParam(value)}`;
      case 'lt': return `${column} < ${addParam(value)}`;
      case 'lte': return `${column} <= ${addParam(value)}`;
      case 'like': return `${column} LIKE ${addParam(value)}`;
      case 'ilike': return `${column} ILIKE ${addParam(value)}`;
      case 'not_eq': return value === null ? `${column} IS NOT NULL` : `${column} <> ${addParam(value)}`;
      case 'not_is':
        if (value === null) return `${column} IS NOT NULL`;
        if (value === true) return `${column} IS NOT TRUE`;
        if (value === false) return `${column} IS NOT FALSE`;
        throw new Error('The not.is filter only supports null, true, or false');
      case 'not_gt': return `${column} <= ${addParam(value)}`;
      case 'not_gte': return `${column} < ${addParam(value)}`;
      case 'not_lt': return `${column} >= ${addParam(value)}`;
      case 'not_lte': return `${column} > ${addParam(value)}`;
      case 'not_like': return `${column} NOT LIKE ${addParam(value)}`;
      case 'not_ilike': return `${column} NOT ILIKE ${addParam(value)}`;
      default: throw new Error(`Unsupported filter operator: ${operator}`);
    }
  }).join(' AND ');
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const client = await getCrdbPool().connect();
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      action,
      table,
      rpc,
      args,
      filters,
      filterOps,
      select,
      limit,
      offset,
      order,
      values,
      user_id,
      user_role,
    } = body;

    // The compatibility functions read these settings through
    // hms_current_user_id()/hms_current_user_role(). They are scoped to this
    // connection and are never stored in the database.
    await client.query(
      "SELECT set_config('hms.user_id', $1, false), set_config('hms.user_role', $2, false)",
      [user_id || '', user_role || '']
    );

    if (action === 'rpc') {
      const paramKeys = args ? Object.keys(args) : [];
      const rpcCastSignatures: Record<string, string[]> = {
        create_prescription_from_typed: ['uuid', 'uuid', 'text', 'text', 'jsonb'],
        create_lab_request_from_typed: ['uuid', 'uuid', 'text', 'text[]'],
        register_inventory_bin_card: ['uuid', 'text'],
        record_inventory_receipt: ['text', 'text', 'jsonb', 'text', 'text', 'text', 'date'],
        create_store_to_pharmacy_transfer: ['jsonb', 'text', 'text'],
        prepare_patient_archive: ['text', 'jsonb'],
        record_archive_r2_cleanup: ['text', 'jsonb'],
        purge_archived_cases: ['uuid[]', 'text'],
        receive_store_transfer: ['uuid'],
        reject_store_transfer: ['uuid', 'text'],
        mark_item_unavailable: ['uuid', 'text'],
        refund_invoice_item: ['uuid', 'text'],
        dispense_inventory_invoice_item: ['uuid'],
        settle_invoice_atomic: ['uuid', 'numeric', 'numeric', 'numeric', 'text', 'text', 'boolean', 'boolean'],
        finalize_referral: ['uuid', 'text'],
        request_admission: ['uuid', 'text', 'text', 'text', 'uuid'],
        assign_admission_bed: ['uuid', 'uuid'],
        send_admission_to_cashier: ['uuid', 'text'],
        discharge_admission: ['uuid', 'text', 'text', 'numeric', 'text', 'numeric'],
        discharge_admission_atomic: ['uuid', 'text', 'text', 'numeric', 'text', 'numeric'],
        advance_journey: ['uuid', 'text', 'text', 'uuid', 'text', 'text', 'uuid', 'text'],
        open_visit_for_patient: ['uuid', 'text', 'boolean', 'text'],
        calculate_payroll_deductions: ['uuid', 'date', 'date'],
        check_archive_eligibility: ['uuid[]'],
        confirm_archive_download: ['text'],
      };
      const casts = rpcCastSignatures[rpc] || [];
      const paramPlaceholders = paramKeys.map((_, idx) => `$${idx + 1}${casts[idx] ? `::${casts[idx]}` : ''}`).join(', ');
      const paramValues = paramKeys.map((key, index) => {
        const normalized = normalizeRpcValue(args[key]);
        // node-postgres treats JavaScript arrays as SQL arrays. Typed
        // prescription RPCs expect _items as JSONB, so always pass JSON text
        // for RPC parameters declared as jsonb.
        return casts[index] === 'jsonb' && normalized !== null && typeof normalized === 'object'
          ? JSON.stringify(normalized)
          : normalized;
      });
      assertIdentifier(rpc, 'RPC name');
      const setReturningRpcs = new Set([
        'get_store_bin_cards',
        'get_inventory_catalog',
        'get_pharmacy_stock',
        'get_pharmacy_inventory',
        'get_pending_store_transfers',
        'check_archive_eligibility',
        'record_archive_storage_measurement',
        'get_database_size',
        'get_staff_directory',
      ]);
      const query = setReturningRpcs.has(rpc)
        ? `SELECT * FROM public.${rpc}(${paramPlaceholders})`
        : `SELECT public.${rpc}(${paramPlaceholders})`;
      const result = await client.query(query, paramValues);
      const data = setReturningRpcs.has(rpc)
        ? result.rows
        : (result.rows[0]?.[rpc] ?? result.rows[0]);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, error: null }),
      };
    }

    if (action === 'insert') {
      assertTable(table);
      const rows = normalizeRows(values);
      const columns = Object.keys(rows[0]);
      if (!columns.length) throw new Error('Insert values cannot be empty');
      columns.forEach(column => assertIdentifier(column, 'insert column'));

      const params: any[] = [];
      const rowPlaceholders = rows.map(row => {
        const placeholders = columns.map(column => {
          params.push(row[column] === undefined ? null : normalizeWriteValue(table, column, row[column]));
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      const sql = `INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${rowPlaceholders.join(', ')} RETURNING *`;
      const result = await client.query(sql, params);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.rows, error: null }),
      };
    }

    if (action === 'update') {
      assertTable(table);
      const updateRows = normalizeRows(values);
      if (updateRows.length !== 1) throw new Error('Update accepts one object');
      const updateEntries = Object.entries(updateRows[0]);
      if (!updateEntries.length) throw new Error('Update values cannot be empty');
      updateEntries.forEach(([column]) => assertIdentifier(column, 'update column'));
      const filterOperations = normalizeFilterOperations(filters, filterOps, true);
      const params: any[] = [];
      const setSql = updateEntries.map(([column, value]) => {
        params.push(value === undefined ? null : normalizeWriteValue(table, column, value));
        return `${column} = $${params.length}`;
      });
      const whereSql = buildWhereClause(filterOperations, params);
      const sql = `UPDATE public.${table} SET ${setSql.join(', ')} WHERE ${whereSql} RETURNING *`;
      const result = await client.query(sql, params);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.rows, error: null }),
      };
    }

    if (action === 'delete') {
      assertTable(table);
      const filterOperations = normalizeFilterOperations(filters, filterOps, true);
      const params: any[] = [];
      const whereSql = buildWhereClause(filterOperations, params);
      const sql = `DELETE FROM public.${table} WHERE ${whereSql} RETURNING *`;
      const result = await client.query(sql, params);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.rows, error: null }),
      };
    }

    if (action === 'select' || !action) {
      assertTable(table);
      const queryCols = select ? select.replace('*', '*') : '*';
      let sql = `SELECT ${queryCols} FROM public.${table}`;
      const queryValues: any[] = [];
      let paramIdx = 1;

      const filterOperations = normalizeFilterOperations(filters, filterOps);
      if (filterOperations.length > 0) {
        const whereSql = buildWhereClause(filterOperations, queryValues);
        paramIdx = queryValues.length + 1;
        sql += ` WHERE ${whereSql}`;
      }

      if (order) {
        assertIdentifier(order.column, 'order column');
        sql += ` ORDER BY ${order.column} ${order.ascending === false ? 'DESC' : 'ASC'}`;
      }
      if (limit) {
        sql += ` LIMIT $${paramIdx++}`;
        queryValues.push(limit);
      }
      if (offset) {
        sql += ` OFFSET $${paramIdx++}`;
        queryValues.push(offset);
      }

      const result = await client.query(sql, queryValues);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.rows, error: null }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: err.message || 'Database request failed' }),
    };
  } finally {
    try { client.release(); } catch {}
  }
};

export default handler;
