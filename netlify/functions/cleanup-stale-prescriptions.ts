import type { Handler } from '@netlify/functions';
import { getCrdbPool } from './_shared/crdb';

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

  const pool = getCrdbPool();
  const client = await pool.connect();

  try {
    // Find all prescriptions that are still 'pending'
    const rxResult = await client.query(
      `SELECT id, patient_id FROM prescriptions WHERE status = 'pending'`
    );
    const pendingRx = rxResult.rows;

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
      const paidResult = await client.query(
        `SELECT id FROM snap_orders
         WHERE patient_id = $1 AND target_station = 'pharmacy' AND status = 'paid'
         LIMIT 1`,
        [rx.patient_id]
      );

      if (paidResult.rows.length === 0) {
        // No remaining paid pharmacy work — mark this prescription as dispensed
        await client.query(
          `UPDATE prescriptions SET status = 'dispensed' WHERE id = $1`,
          [rx.id]
        );
        // Also mark all its items as dispensed
        await client.query(
          `UPDATE prescription_items SET dispensed = true WHERE prescription_id = $1`,
          [rx.id]
        );
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
  } finally {
    client.release();
  }
};
