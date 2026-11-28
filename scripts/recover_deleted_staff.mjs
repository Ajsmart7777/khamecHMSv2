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
 * moment of the delete, and the earlier soft delete (status = 'deleted', shown
 * as "Deactivated" in Register Staff) leaves its own entry. This script:
 *   1. locates those audit entries for the requested staff name,
 *   2. reads the staff row and its patients back from the snapshot taken just
 *      before the *deactivation* (or, when that history has expired, just
 *      before the purge), so status, is_system_user and the deletion columns
 *      are the originals rather than the deactivated copies,
 *   3. walks the foreign keys out of public.staff / public.patients and reads
 *      every dependent row from the same snapshot (all reads complete before
 *      any write, because CockroachDB cannot read history inside a read-write
 *      transaction),
 *   4. reinserts everything in dependency order inside a single transaction,
 *      or - when the staff row still exists but is deactivated - refreshes it
 *      from the snapshot and puts it back to 'active',
 *   5. relinks invoices that were sponsored by the staff member, clears the
 *      patient migration flags left by the deactivation, and records the
 *      recovery in audit_logs so it is never repeated.
 *
 * Usage:
 *   node scripts/recover_deleted_staff.mjs --name "esther ibe"           # preview only
 *   node scripts/recover_deleted_staff.mjs --name "esther ibe" --apply   # restore
 *
 * It is safe to run repeatedly: an active staff row or the earlier
 * 'staff_restored' / 'staff_reactivated' audit entries make it a no-op, and
 * expired history is reported instead of failing a deploy.
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
const DEACTIVATED_STATUSES = new Set(['deleted', 'inactive']);

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

/** The soft delete that marked the staff member "Deactivated", if it is logged. */
async function findDeactivationEvent(staffId) {
  const { rows } = await client.query(
    `SELECT resource_id, details, created_at
       FROM public.audit_logs
      WHERE action = 'staff_deactivated_for_patient_migration'
        AND resource_id = $1
      ORDER BY created_at ASC
      LIMIT 1`,
    [staffId],
  );
  return rows[0] ?? null;
}

async function findStaffByName(name) {
  const { rows } = await client.query(
    `SELECT * FROM public.staff
      WHERE lower(btrim(first_name || ' ' || last_name)) = lower($1)
      ORDER BY created_at DESC
      LIMIT 5`,
    [normalize(name)],
  );
  return rows;
}

async function auditExists(action, staffId) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM public.audit_logs WHERE action = $1 AND resource_id = $2 LIMIT 1`,
    [action, staffId],
  );
  return rowCount > 0;
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

/** The status to write back: never leave the record in a deactivated state. */
const liveStatus = (status) => (DEACTIVATED_STATUSES.has(normalize(status)) ? 'active' : status);

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

/** Rewrite an existing staff row with the snapshot values, back to active. */
async function updateStaffFromSnapshot(snapshotRow, staffId) {
  const meta = await tableMeta('staff');
  const columns = [...meta.entries()]
    .filter(([name, info]) => name !== 'id' && name !== 'updated_at'
      && info.is_generated !== 'ALWAYS' && info.is_identity !== 'YES'
      && Object.prototype.hasOwnProperty.call(snapshotRow, name))
    .map(([name]) => name);
  if (!columns.length) {
    warn('no columns available to refresh the staff row from the snapshot.');
    return 0;
  }

  const params = [];
  const assignments = columns.map((column) => {
    let value = coerce(snapshotRow[column], meta.get(column)?.data_type);
    if (column === 'status') value = liveStatus(snapshotRow.status);
    if (['deleted_at', 'deleted_by', 'deletion_reason'].includes(column)) value = null;
    params.push(value);
    return `${quote(column)} = $${params.length}`;
  });
  if (meta.has('updated_at')) assignments.push('updated_at = now()');
  params.push(staffId);

  const result = await client.query(
    `UPDATE public.staff SET ${assignments.join(', ')} WHERE id = $${params.length}`,
    params,
  );
  return result.rowCount ?? 0;
}

/** Minimal reactivation used when the history window no longer holds the row. */
async function reactivateStaffRow(staffId) {
  const meta = await tableMeta('staff');
  const assignments = [];
  if (meta.has('status')) assignments.push(`status = 'active'`);
  for (const column of ['deleted_at', 'deleted_by', 'deletion_reason']) {
    if (meta.has(column)) assignments.push(`${quote(column)} = NULL`);
  }
  if (meta.has('updated_at')) assignments.push('updated_at = now()');
  if (!assignments.length) return 0;
  const result = await client.query(
    `UPDATE public.staff SET ${assignments.join(', ')} WHERE id = $1`,
    [staffId],
  );
  return result.rowCount ?? 0;
}

/** Drop the "linked staff was deactivated" flags from the staff's patients. */
async function clearPatientMigrationFlags(staffId) {
  const meta = await tableMeta('patients');
  const flags = [
    'staff_migration_required',
    'staff_migration_staff_id',
    'staff_migration_marked_at',
    'staff_migration_marked_reason',
  ].filter((column) => meta.has(column));
  if (!meta.has('staff_migration_required')) return 0;

  const assignments = flags.map((column) => {
    if (column === 'staff_migration_required') return `${quote(column)} = false`;
    return `${quote(column)} = NULL`;
  });
  const result = await client.query(
    `UPDATE public.patients
        SET ${assignments.join(', ')}
      WHERE staff_migration_required = true
        AND (staff_link_id = $1
             OR id IN (SELECT patient_id FROM public.staff_family_members WHERE staff_id = $1))`,
    [staffId],
  );
  return result.rowCount ?? 0;
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
async function collectPlan({ asOf, staffRows, patientRows, order, incoming, selfColumns }) {
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

/**
 * CockroachDB refuses AS OF SYSTEM TIME older than the range's GC window
 * ("batch timestamp ... must be after replica GC threshold"). When the table
 * itself postdates the requested time it answers "relation does not exist"
 * instead. Both mean the same thing here: no usable snapshot.
 */
const HISTORY_EXPIRED = /gc threshold|batch timestamp|must be after|garbage|does not exist/i;

/** First snapshot that still holds the staff row, or null when history expired. */
async function readSnapshot(staffId, candidates) {
  for (const moment of candidates) {
    const snapshot = new Date(moment.getTime() - 2000).toISOString();
    const asOf = `AS OF SYSTEM TIME '${snapshot}'`;
    let rows;
    try {
      rows = (await client.query(`SELECT * FROM public.staff ${asOf} WHERE id = $1`, [staffId])).rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Expired history is expected days later and must not abort the run - the
      // live row can still be reactivated below.
      if (!HISTORY_EXPIRED.test(message)) throw error;
      warn(`history at ${snapshot} is no longer available: ${message}`);
      continue;
    }
    if (rows.length) return { snapshot, asOf, staff: rows[0] };
  }
  return null;
}

/**
 * The deleted-staff guard (public.prevent_deleted_staff_reactivation) raises
 * STAFF_DELETED on any update that moves a deleted row to another status.
 * reactivate_staff_member() opens it with a transactional row in
 * staff_reactivation_grants, so the script uses the same marker. Databases that
 * predate that migration simply have no guard to bypass.
 */
async function allowReactivation(staffId) {
  try {
    await client.query(
      'INSERT INTO public.staff_reactivation_grants (staff_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [staffId],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/does not exist|undefined_table|42P01/i.test(message)) throw error;
    warn('staff_reactivation_grants is not present yet; continuing without opening the deleted-staff guard.');
  }
}

async function closeReactivation(staffId) {
  try {
    await client.query('DELETE FROM public.staff_reactivation_grants WHERE staff_id = $1', [staffId]);
  } catch {
    // The table may not exist on this database; nothing to release.
  }
}

async function main() {
  await client.connect();

  const deletion = await findDeletionEvent();
  if (!deletion) {
    const matches = await findStaffByName(targetName);
    const deactivated = matches.find((row) => DEACTIVATED_STATUSES.has(normalize(row.status)));
    if (!deactivated) {
      log(`no recorded deletion of "${targetName}" in audit_logs. Nothing to recover.`);
      return;
    }

    // The record is still there but marked "Deactivated" - reactivate it.
    if (await auditExists('staff_reactivated', deactivated.id)) {
      log('this staff member was already reactivated once. Nothing to do.');
      return;
    }
    if (!apply) {
      log(`"${normalize(targetName)}" exists but is marked "${deactivated.status}". Re-run with --apply to set it back to active.`);
      return;
    }
    await client.query('BEGIN');
    try {
      await allowReactivation(deactivated.id);
      await reactivateStaffRow(deactivated.id);
      await closeReactivation(deactivated.id);
      const cleared = await clearPatientMigrationFlags(deactivated.id);
      await client.query(
        `INSERT INTO public.audit_logs (action, resource_type, resource_id, details, status)
         VALUES ('staff_reactivated', 'staff', $1, $2::jsonb, 'success')`,
        [
          deactivated.id,
          JSON.stringify({
            staff_name: `${deactivated.first_name} ${deactivated.last_name}`.trim(),
            previous_status: deactivated.status,
            source: 'live row',
          }),
        ],
      );
      await client.query('COMMIT');
      log(`"${normalize(targetName)}" set back to active (was "${deactivated.status}").`);
      if (cleared) log(`  patient migration flags cleared: ${cleared}`);
      log('done. Refresh the Register Staff tab to see the active record.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      warn(`reactivation rolled back, nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  const deletionStaffId = deletion.resource_id;
  const deletedAt = new Date(deletion.created_at);
  log(`found delete of "${normalize(deletion.details?.staff_name)}" (${deletionStaffId}) at ${deletedAt.toISOString()}`);

  const current = await client.query('SELECT * FROM public.staff WHERE id = $1', [deletionStaffId]);
  const existing = current.rows[0] ?? null;

  if (existing && !DEACTIVATED_STATUSES.has(normalize(existing.status))) {
    log('the staff record is already present and active. Nothing to do.');
    return;
  }
  if (existing && (await auditExists('staff_reactivated', deletionStaffId))) {
    log('this staff member was already reactivated once. Nothing to do.');
    return;
  }
  if (!existing && (await auditExists('staff_restored', deletionStaffId))) {
    log('this staff member was already recovered once. Nothing to do.');
    return;
  }

  const mode = existing ? 'reactivate' : 'restore';
  const staffId = existing ? existing.id : deletionStaffId;
  log(`mode: ${mode}${existing ? ` (current status "${existing.status}")` : ''}`);

  if (mode === 'restore') {
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
  }

  // Prefer the state before the soft delete: it keeps the real status,
  // is_system_user and the patient accounts before they were flagged.
  const deactivation = await findDeactivationEvent(staffId);
  const candidates = [];
  if (deactivation) candidates.push(new Date(deactivation.created_at));
  candidates.push(deletedAt);
  if (deactivation) log(`found deactivation at ${new Date(deactivation.created_at).toISOString()}`);

  const history = await readSnapshot(staffId, candidates);
  if (!history && mode === 'restore') {
    warn(`history for ${deletedAt.toISOString()} no longer contains the staff row: CockroachDB's GC window (4 hours by default) has passed.`);
    warn('Recover it from a CockroachDB Cloud cluster backup instead (restore to a new cluster, then copy the rows).');
    return;
  }
  if (history) log(`snapshot at ${history.snapshot} (${history.snapshot === new Date(deletedAt.getTime() - 2000).toISOString() ? 'pre-delete' : 'pre-deactivation'})`);

  let plan = new Map();
  let selfLinks = [];
  let historicRoles = [];
  let sponsoredInvoiceIds = [];
  let patientRows = [];

  if (history) {
    const staffRows = [history.staff];
    const { asOf } = history;

    const linkedPatientIds = [
      ...(await client.query(`SELECT id FROM public.patients ${asOf} WHERE staff_link_id = $1`, [staffId])).rows,
      ...(await client.query(`SELECT patient_id AS id FROM public.staff_family_members ${asOf} WHERE staff_id = $1`, [staffId])).rows,
    ].map((row) => row.id);

    patientRows = linkedPatientIds.length
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

    ({ plan, selfLinks } = await collectPlan({ asOf, staffRows, patientRows, order, incoming, selfColumns }));

    const authUserId = staffRows[0].auth_user_id;
    if (authUserId) {
      historicRoles = (await client.query(`SELECT * FROM public.user_roles ${asOf} WHERE user_id = $1`, [authUserId])).rows;
      const authUser = await client.query('SELECT 1 FROM public.auth_users WHERE id = $1', [authUserId]);
      if (!authUser.rowCount) {
        warn('the login account behind this staff member no longer exists; the staff record will be restored without a login.');
        staffRows[0].auth_user_id = null;
      }
    }
    sponsoredInvoiceIds = (
      await client.query(`SELECT id FROM public.invoices ${asOf} WHERE staff_sponsor_id = $1`, [staffId])
    ).rows.map((row) => row.id);

    if (mode === 'restore') {
      const collision = await client.query(
        `SELECT employee_id FROM public.staff WHERE employee_id = $1 OR email = $2 LIMIT 1`,
        [staffRows[0].employee_id, staffRows[0].email],
      );
      if (collision.rowCount) {
        warn(`employee id or email of the deleted row is now used by ${collision.rows[0].employee_id}; skipped to avoid a conflict.`);
        return;
      }
    }
  } else {
    warn('the deactivation is older than the history window, so only the status can be reset; details stay as they are.');
  }

  if (!apply) {
    log('preview (nothing written):');
    if (history) {
      let total = 0;
      for (const [table, rows] of plan) {
        total += rows.length;
        log(`  ${table}: ${rows.length}`);
      }
      log(`total ${total} row(s) available in the snapshot.`);
    }
    log(`would set status "${history ? liveStatus(history.staff.status) : 'active'}" and clear the deletion columns. Re-run with --apply to restore.`);
    return;
  }

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
    if (history?.staff.auth_user_id && historicRoles.length) {
      const existingRoles = await client.query('SELECT 1 FROM public.user_roles WHERE user_id = $1 LIMIT 1', [history.staff.auth_user_id]);
      if (!existingRoles.rowCount) rolesRestored = await insertRows('user_roles', historicRoles);
    }

    // Existing but deactivated rows are refreshed from the snapshot so no
    // detail stays behind the deactivation.
    let refreshed = 0;
    if (mode === 'reactivate') {
      await allowReactivation(staffId);
      refreshed = history ? await updateStaffFromSnapshot(history.staff, staffId) : await reactivateStaffRow(staffId);
      await closeReactivation(staffId);
    }

    const clearedFlags = await clearPatientMigrationFlags(staffId);

    await client.query(
      `INSERT INTO public.audit_logs (action, resource_type, resource_id, details, status)
       VALUES ($1, 'staff', $2, $3::jsonb, 'success')`,
      [
        mode === 'reactivate' ? 'staff_reactivated' : 'staff_restored',
        staffId,
        JSON.stringify({
          staff_name: `${(history?.staff ?? existing).first_name} ${(history?.staff ?? existing).last_name}`.trim(),
          snapshot: history?.snapshot ?? null,
          previous_status: existing?.status ?? null,
          rows: restoredRows,
        }),
      ],
    );

    await client.query('COMMIT');

    log(`restored ${restoredRows} row(s)${history ? ` from the snapshot at ${history.snapshot}` : ''}:`);
    for (const [table, rows] of plan) log(`  ${table}: ${rows.length}`);
    if (relinked) log(`  invoices re-linked to the staff sponsor: ${relinked}`);
    if (rolesRestored) log(`  login roles restored: ${rolesRestored}`);
    if (refreshed) {
      log(history
        ? `  staff row refreshed from the snapshot and set to active: ${refreshed}`
        : `  staff row set back to active, saved details kept: ${refreshed}`);
    }
    if (clearedFlags) log(`  patient migration flags cleared: ${clearedFlags}`);
    log(`done. "${normalize(targetName)}" is active again. Refresh the Register Staff tab.`);
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
