import type { Handler } from '@netlify/functions';
import { getCrdbClient } from './_shared/crdb.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertTable(table: unknown): asserts table is string {
  assertIdentifier(table, 'table name');
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

  const client = getCrdbClient();
  try {
    await client.connect();
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
      const paramPlaceholders = paramKeys.map((_, idx) => `$${idx + 1}`).join(', ');
      const paramValues = paramKeys.map(key => args[key]);
      assertIdentifier(rpc, 'RPC name');
      const setReturningRpcs = new Set([
        'get_store_bin_cards',
        'get_inventory_catalog',
        'get_pharmacy_stock',
        'get_pharmacy_inventory',
        'get_pending_store_transfers',
      ]);
      const query = setReturningRpcs.has(rpc)
        ? `SELECT * FROM public.${rpc}(${paramPlaceholders})`
        : `SELECT public.${rpc}(${paramPlaceholders})`;
      const result = await client.query(query, paramValues);
      await client.end();
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
          params.push(row[column] === undefined ? null : row[column]);
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      const sql = `INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${rowPlaceholders.join(', ')} RETURNING *`;
      const result = await client.query(sql, params);
      await client.end();
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
        params.push(value === undefined ? null : value);
        return `${column} = $${params.length}`;
      });
      const whereSql = buildWhereClause(filterOperations, params);
      const sql = `UPDATE public.${table} SET ${setSql.join(', ')} WHERE ${whereSql} RETURNING *`;
      const result = await client.query(sql, params);
      await client.end();
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
      await client.end();
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
      await client.end();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.rows, error: null }),
      };
    }

    await client.end();
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err: any) {
    try { await client.end(); } catch {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: err.message || 'Database request failed' }),
    };
  }
};

export default handler;
