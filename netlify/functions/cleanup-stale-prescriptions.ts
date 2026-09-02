import type { Handler } from '@netlify/functions';
import { getCRDB } from './_shared/crdb';

/**
 * One-time cleanup: finds prescriptions still stuck at 'pending' even though
 * all their corresponding pharmacy snap_orders are already 'fulfilled'.
 *
 * POST /netlify/functions/cleanup-stale-prescriptions
 *   Body: {} (no parameters needed)
 *
 * Safe to run multiple times — it only touches prescriptions that are still
 * 'pending' and whose snap_orders are all fulfilled.
 */
export const handler: Handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const sql = await getCRDB();

    // Find all prescriptions that are still 'pending'
    const { rows: pendingRx } = await sql`
      SELECT id, patient_id FROM prescriptions WHERE status = 'pending'
    `;

    if (pendingRx.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'No pending prescriptions found', fixed: 0 }),
      };
    }

    let fixed = 0;
    const fixedIds: string[] = [];

    for (const rx of pendingRx) {
      // Check if this patient has any remaining 'paid' pharmacy snap_orders
      const { rows: remainingPaid } = await sql`
        SELECT id FROM snap_orders
        WHERE patient_id = ${rx.patient_id}
          AND target_station = 'pharmacy'
          AND status = 'paid'
        LIMIT 1
      `;

      if (remainingPaid.length === 0) {
        // No remaining paid pharmacy work — mark this prescription as dispensed
        await sql`
          UPDATE prescriptions SET status = 'dispensed' WHERE id = ${rx.id}
        `;
        // Also mark all its items as dispensed
        await sql`
          UPDATE prescription_items SET dispensed = true WHERE prescription_id = ${rx.id}
        `;
        fixed++;
        fixedIds.push(rx.id);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: `Cleaned up ${fixed} stale prescription(s)`,
        fixed,
        fixedIds,
        totalPending: pendingRx.length,
      }),
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
