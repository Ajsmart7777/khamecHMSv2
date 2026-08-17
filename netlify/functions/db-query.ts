import { Handler } from '@netlify/functions';
import { getCrdbClient } from './_shared/crdb.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const client = getCrdbClient();
  try {
    await client.connect();
    const body = JSON.parse(event.body || '{}');
    const { action, table, rpc, args, filters, select, limit, offset, order, user_id, user_role } = body;

    // The database compatibility layer reads these settings through
    // hms_current_user_id()/hms_current_user_role(). They are scoped to this
    // connection and are never stored in the database.
    await client.query('SELECT set_config(\'hms.user_id\', $1, false), set_config(\'hms.user_role\', $2, false)', [
      user_id || '',
      user_role || ''
    ]);

    if (action === 'rpc') {
      const paramKeys = args ? Object.keys(args) : [];
      const paramPlaceholders = paramKeys.map((_, idx) => `$${idx + 1}`).join(', ');
      const paramValues = paramKeys.map(k => args[k]);
      const setReturningRpcs = new Set(['get_store_bin_cards', 'get_inventory_catalog', 'get_pharmacy_stock', 'get_pharmacy_inventory', 'get_pending_store_transfers']);
      const query = setReturningRpcs.has(rpc)
        ? `SELECT * FROM public.${rpc}(${paramPlaceholders})`
        : `SELECT public.${rpc}(${paramPlaceholders})`;
      const result = await client.query(query, paramValues);
      const data = setReturningRpcs.has(rpc)
        ? result.rows
        : (result.rows[0]?.[rpc] ?? result.rows[0]);
      await client.end();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, error: null })
      };
    }

    if (action === 'select' || !action) {
      let queryCols = select ? select.replace('*', '*') : '*';
      let sql = `SELECT ${queryCols} FROM public.${table}`;
      const values: any[] = [];
      let paramIdx = 1;

      if (filters && typeof filters === 'object') {
        const clauses: string[] = [];
        for (const [key, val] of Object.entries(filters)) {
          clauses.push(`${key} = $${paramIdx++}`);
          values.push(val);
        }
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(' AND ')}`;
        }
      }

      if (order) {
        sql += ` ORDER BY ${order.column} ${order.ascending === false ? 'DESC' : 'ASC'}`;
      }

      if (limit) {
        sql += ` LIMIT $${paramIdx++}`;
        values.push(limit);
      }
      if (offset) {
        sql += ` OFFSET $${paramIdx++}`;
        values.push(offset);
      }

      const result = await client.query(sql, values);
      await client.end();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.rows, error: null })
      };
    }

    await client.end();
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err: any) {
    try { await client.end(); } catch {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: err.message })
    };
  }
};
