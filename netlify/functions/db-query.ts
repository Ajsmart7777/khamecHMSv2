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

function getFilterEntries(filters: unknown): [string, any][] {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error('Write operations require filters');
  }
  const entries = Object.entries(filters as Record<string, any>);
  if (!entries.length) throw new Error('Write operations require at least one filter');
  entries.forEach(([column]) => assertIdentifier(column, 'filter column'));
  return entries;
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
      const filterEntries = getFilterEntries(filters);
      const params: any[] = [];
      const setSql = updateEntries.map(([column, value]) => {
        params.push(value === undefined ? null : value);
        return `${column} = $${params.length}`;
      });
      const whereSql = filterEntries.map(([column, value]) => {
        params.push(value);
        return `${column} = $${params.length}`;
      });
      const sql = `UPDATE public.${table} SET ${setSql.join(', ')} WHERE ${whereSql.join(' AND ')} RETURNING *`;
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
      const filterEntries = getFilterEntries(filters);
      const params: any[] = [];
      const whereSql = filterEntries.map(([column, value]) => {
        params.push(value);
        return `${column} = $${params.length}`;
      });
      const sql = `DELETE FROM public.${table} WHERE ${whereSql.join(' AND ')} RETURNING *`;
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

      if (filters && typeof filters === 'object') {
        const clauses: string[] = [];
        for (const [key, val] of Object.entries(filters)) {
          assertIdentifier(key, 'filter column');
          clauses.push(`${key} = $${paramIdx++}`);
          queryValues.push(val);
        }
        if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`;
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
