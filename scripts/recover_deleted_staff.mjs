#!/usr/bin/env node
/**
 * Recover a staff member removed by public.purge_staff_member().
 *
 * purge_staff_member() deletes the staff row, the Staff / Staff Family patient
 * accounts and every record hanging off them. Nothing is kept in the database,
 * so the only surviving copy is CockroachDB's time-travel history
 * (AS OF SYSTEM TIME, bounded by the range's GC TTL - 4 hours by default).
 *
 * The audit_logs entry written by the purge records the staff id and the exact
 * moment of the delete. This script:
 *   1. locates that audit entry for the requested staff name,
 *   2. reads the staff row and its patients back from the snapshot taken just
 *      before the delete,
 *   3. walks the foreign keys out of public.staff / public.patients and reads
 *      every dependent row from the same snapshot (all reads complete before
 *      any write, because CockroachDB cannot read history inside a read-write
 *      transaction),
 *   4. reinserts everything in dependency order inside a single transaction,
 *   5. relinks invoices that were sponsored by the staff member and records a
 *      'staff_restored' audit entry so the recovery is never repeated.
 *
 * Usage:
 *   node scripts/recover_deleted_staff.mjs --name "esther ibe"           # preview only
 *   node scripts/recover_deleted_staff.mjs --name "esther ibe" --apply   # restore
 *
 * It is safe to run repeatedly: an existing staff row or an earlier
 * 'staff_restored' audit entry makes it a no-op, and expired history is
 * reported instead of failing a deploy.
 */
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.CRDB_CONNECTION_STRING || process.env.DATABASE_URL;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const nameFlag = args.indexOf('--name');
const targetName = (nameFlag >= 0 ? args[nameFlag + 1] : process.env.RECOVER_STAFF_NAME) || 'esther ibe';
const log = (message) => console.log(`[staff-recovery] ${message}`);
const warn = (message) => console.warn(`[staff-recovery] ${message}`);

const normalize = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const quote = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

if (!connectionString) {
  log('skipped: CRDB_CONNECTION_STRING / DATABASE_URL is not set in this environment.');
  process.exit(0);
}

const client = new Client({
  connectionString,
  ssl: /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 300000,
});

const metaCache = new Map();

async function findDeletionEvent() {
  const { rows } = await client.query(`
    SELECT resource_id, details, created_at
    FROM public.audit_logs
    WHERE action = 'staff_deleted'
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return rows.find((row) => normalize(row.details?.staff_name) === normalize(targetName)) ?? null;
}

async function tableMeta(table) {
  if (metaCache.has(table)) return metaCache.get(table);
  const { rows } = await client.query(
    `SELECT column_name,
            data_type,
            COALESCE(is_generated, 'NEVER') AS is_generated,
            COALESCE(is_identity, 'NO') AS is_identity
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  const meta = new Map(rows.map((row) => [row.column_name, row]));
  metaCache.set(table, meta);
  return meta;
}

function coerce(value, dataType) {
  if (value === null || value === undefined) return null;
  if (dataType === 'json' || dataType === 'jsonb') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function insertRows(table, rows) {
  if (!rows.length) return 0;
  const meta = await tableMeta(table);
  const available = new Set(Object.keys(rows[0]));
  const columns = [...meta.entries()]
    .filter(([name, info]) => available.has(name) && info.is_generated !== 'ALWAYS' && info.is_identity !== 'YES')
    .map(([name]) => name);
  if (!columns.length) {
    warn(`no insertable columns found for public.${table}; skipped ${rows.length} row(s)`);
    return 0;
  }

  const chunkSize = 150;
  let inserted = 0;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(coerce(row[column], meta.get(column)?.data_type));
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const result = await client.query(
      `INSERT INTO public.${quote(table)} (${columns.map(quote).join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING`,
      params,
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function loadForeignKeyEdges() {
  const { rows } = await client.query(`
    SELECT ch.relname AS child_table,
           pa.relname AS parent_table,
           chc.attname AS child_column,
           pac.attname AS parent_column
      FROM pg_constraint c
      JOIN pg_class ch ON ch.oid = c.conrelid
      JOIN pg_class pa ON pa.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = ch.relnamespace
      JOIN pg_namespace pn ON pn.oid = pa.relnamespace
      JOIN pg_attribute chc ON chc.attrelid = ch.oid AND chc.attnum = c.conkey[1]
      JOIN pg_attribute pac ON pac.attrelid = pa.oid AND pac.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND n.nspname = 'public'
       AND pn.nspname = 'public'
       AND COALESCE(array_length(c.conkey, 1), 0) = 1
  `);
  return rows;
}

/** Read every recoverable row out of the pre-delete snapshot, parents first. */
async function collectPlan({ asOf, staffId, staffRows, patientRows, order, incoming, selfColumns }) {
  const plan = new Map();
  const restored = new Map();
  const record = (table, rows) => {
    if (!plan.has(table)) plan.set(table, []);
    if (!restored.has(table)) restored.set(table, new Set());
    for (const row of rows) {
      plan.get(table).push(row);
      if (row.id) restored.get(table).add(row.id);
    }
  };

  record('staff', staffRows);
  record('patients', patientRows);

  // Two passes so rows reachable only through a second parent still land.
  for (let pass = 1; pass <= 2; pass += 1) {
    for (const table of order.slice(2)) {
      const filters = (incoming.get(table) ?? [])
        .map((edge) => ({ column: edge.child_column, ids: [...(restored.get(edge.parent_table) ?? [])] }))
        .filter((filter) => filter.ids.length > 0);
      if (!filters.length) continue;

      const params = [];
      const where = filters
        .map((filter) => {
          params.push(filter.ids);
          return `${quote(filter.column)} = ANY($${params.length})`;
        })
        .join(' OR ');

      const rows = (await client.query(`SELECT * FROM public.${quote(table)} ${asOf} WHERE ${where}`, params)).rows;
      if (!rows.length) continue;

      const known = restored.get(table) ?? new Set();
      const fresh = rows.filter((row) => !row.id || !known.has(row.id));
      if (fresh.length) record(table, fresh);
    }
  }

  // Self-references (snap_orders.parent_snap_id) are cleared on insert because
  // a parent row may be written after its child in the same batch.
  const selfLinks = [];
  for (const [table, rows] of plan) {
    const columns = selfColumns.get(table) ?? [];
    if (!columns.length) continue;
    for (const row of rows) {
      for (const column of columns) {
        if (row[column]) selfLinks.push({ table, id: row.id, column, value: row[column] });
        row[column] = null;
      }
    }
  }

  return { plan, selfLinks };
}

async function main() {
  await client.connect();

  const deletion = await findDeletionEvent();
  if (!deletion) {
    log(`no recorded deletion of "${targetName}" in audit_logs. Nothing to recover.`);
    return;
  }

  const staffId = deletion.resource_id;
  const deletedAt = new Date(deletion.created_at);
  log(`found delete of "${normalize(deletion.details?.staff_name)}" (${staffId}) at ${deletedAt.toISOString()}`);

  const current = await client.query('SELECT id FROM public.staff WHERE id = $1', [staffId]);
  if (current.rowCount) {
    log('the staff row already exists again. Nothing to do.');
    return;
  }

  const sameName = await client.query(
    `SELECT id, employee_id FROM public.staff
      WHERE lower(btrim(first_name || ' ' || last_name)) = lower($1)
      LIMIT 1`,
    [normalize(targetName)],
  );
  if (sameName.rowCount) {
    warn(`a different staff row already uses that name (employee_id ${sameName.rows[0].employee_id}); skipped to avoid a duplicate.`);
    return;
  }

  const marker = await client.query(
    `SELECT id FROM public.audit_logs WHERE action = 'staff_restored' AND resource_id = $1 LIMIT 1`,
    [staffId],
  );
  if (marker.rowCount) {
    log('this staff member was already recovered once. Nothing to do.');
    return;
  }

  // Rows removed by the delete are still readable one instant before it.
  const snapshot = new Date(deletedAt.getTime() - 2000).toISOString();
  const asOf = `AS OF SYSTEM TIME '${snapshot}'`;

  const staffRows = (await client.query(`SELECT * FROM public.staff ${asOf} WHERE id = $1`, [staffId])).rows;
  if (!staffRows.length) {
    warn(`history for ${snapshot} no longer contains the staff row: CockroachDB's GC window (4 hours by default) has passed.`);
    warn('Recover it from a CockroachDB Cloud cluster backup instead (restore to a new cluster, then copy the rows).');
    return;
  }

  const collision = await client.query(
    `SELECT employee_id FROM public.staff WHERE employee_id = $1 OR email = $2 LIMIT 1`,
    [staffRows[0].employee_id, staffRows[0].email],
  );
  if (collision.rowCount) {
    warn(`employee id or email of the deleted row is now used by ${collision.rows[0].employee_id}; skipped to avoid a conflict.`);
    return;
  }

  if (staffRows[0].auth_user_id) {
    const authUser = await client.query('SELECT 1 FROM public.auth_users WHERE id = $1', [staffRows[0].auth_user_id]);
    if (!authUser.rowCount) {
      warn('the login account behind this staff member no longer exists; the staff record will be restored without a login.');
      staffRows[0].auth_user_id = null;
    }
  }

  const linkedPatientIds = [
    ...(await client.query(`SELECT id FROM public.patients ${asOf} WHERE staff_link_id = $1`, [staffId])).rows,
    ...(await client.query(`SELECT patient_id AS id FROM public.staff_family_members ${asOf} WHERE staff_id = $1`, [staffId])).rows,
  ].map((row) => row.id);

  const patientRows = linkedPatientIds.length
    ? (await client.query(`SELECT * FROM public.patients ${asOf} WHERE id = ANY($1)`, [linkedPatientIds])).rows
    : [];

  log(`snapshot contains 1 staff row and ${patientRows.length} linked patient account(s)`);

  const edges = await loadForeignKeyEdges();
  if (!edges.length) {
    warn('could not read foreign keys from pg_constraint, so dependent records cannot be located safely. Aborted.');
    return;
  }

  const childrenByParent = new Map();
  const incoming = new Map();
  const selfColumns = new Map();
  for (const edge of edges) {
    if (!childrenByParent.has(edge.parent_table)) childrenByParent.set(edge.parent_table, []);
    childrenByParent.get(edge.parent_table).push(edge);
    if (edge.child_table === edge.parent_table) {
      if (!selfColumns.has(edge.child_table)) selfColumns.set(edge.child_table, []);
      selfColumns.get(edge.child_table).push(edge.child_column);
      continue;
    }
    if (!incoming.has(edge.child_table)) incoming.set(edge.child_table, []);
    incoming.get(edge.child_table).push(edge);
  }

  const order = ['staff', 'patients'];
  const seen = new Set(order);
  for (let index = 0; index < order.length; index += 1) {
    for (const edge of childrenByParent.get(order[index]) ?? []) {
      if (!seen.has(edge.child_table)) {
        seen.add(edge.child_table);
        order.push(edge.child_table);
      }
    }
  }

  const { plan, selfLinks } = await collectPlan({ asOf, staffId, staffRows, patientRows, order, incoming, selfColumns });

  if (!apply) {
    log('preview (nothing written): these rows are available in the snapshot:');
    let total = 0;
    for (const [table, rows] of plan) {
      total += rows.length;
      log(`  ${table}: ${rows.length}`);
    }
    log(`total ${total} row(s). Re-run with --apply to restore them.`);
    return;
  }

  const authUserId = staffRows[0].auth_user_id;
  const historicRoles = authUserId
    ? (await client.query(`SELECT * FROM public.user_roles ${asOf} WHERE user_id = $1`, [authUserId])).rows
    : [];
  const sponsoredInvoiceIds = (
    await client.query(`SELECT id FROM public.invoices ${asOf} WHERE staff_sponsor_id = $1`, [staffId])
  ).rows.map((row) => row.id);

  await client.query('BEGIN');
  try {
    let restoredRows = 0;
    for (const [table, rows] of plan) {
      restoredRows += await insertRows(table, rows);
    }

    for (const link of selfLinks) {
      await client.query(
        `UPDATE public.${quote(link.table)} SET ${quote(link.column)} = $1
          WHERE id = $2 AND ${quote(link.column)} IS NULL`,
        [link.value, link.id],
      );
    }

    // The purge detached this staff member from invoices they sponsored for
    // other patients; put the link back.
    let relinked = 0;
    if (sponsoredInvoiceIds.length) {
      const result = await client.query(
        `UPDATE public.invoices SET staff_sponsor_id = $1
          WHERE id = ANY($2) AND staff_sponsor_id IS NULL`,
        [staffId, sponsoredInvoiceIds],
      );
      relinked = result.rowCount ?? 0;
    }

    // The purge removed the staff member's login roles; restore them when the
    // login currently has none.
    let rolesRestored = 0;
    if (authUserId && historicRoles.length) {
      const existingRoles = await client.query('SELECT 1 FROM public.user_roles WHERE user_id = $1 LIMIT 1', [authUserId]);
      if (!existingRoles.rowCount) rolesRestored = await insertRows('user_roles', historicRoles);
    }

    await client.query(
      `INSERT INTO public.audit_logs (action, resource_type, resource_id, details, status)
       VALUES ('staff_restored', 'staff', $1, $2::jsonb, 'success')`,
      [
        staffId,
        JSON.stringify({
          staff_name: `${staffRows[0].first_name} ${staffRows[0].last_name}`.trim(),
          snapshot,
          rows: restoredRows,
        }),
      ],
    );

    await client.query('COMMIT');

    log(`restored ${restoredRows} row(s) from the snapshot at ${snapshot}:`);
    for (const [table, rows] of plan) log(`  ${table}: ${rows.length}`);
    if (relinked) log(`  invoices re-linked to the staff sponsor: ${relinked}`);
    if (rolesRestored) log(`  login roles restored: ${rolesRestored}`);
    log('done. Refresh the Register Staff tab to see the recovered record.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    warn(`restore rolled back, nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  await main();
} catch (error) {
  warn(`failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.end().catch(() => undefined);
}
