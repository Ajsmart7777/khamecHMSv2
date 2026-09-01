/**
 * Netlify Function: reconcile-payroll
 *
 * One-time reconciliation endpoint to fix payroll payments stuck in
 * "processing" status. Queries all stuck records, verifies each against
 * the Flutterwave API, and updates the database accordingly.
 *
 * Call this once after deploying:
 *   POST /.netlify/functions/reconcile-payroll
 *   Body: {} (or { "secret": "..." } if RECONCILE_SECRET is set)
 *
 * Required environment variables (already in Netlify):
 *   FLUTTERWAVE_SECRET_KEY  – Flutterwave v3 secret key
 *   CRDB_CONNECTION_STRING  – CockroachDB connection string
 */

import type { Handler } from '@netlify/functions';
import { getCrdbClient } from './_shared/crdb.js';

const FLW_SECRET = process.env.FLUTTERWAVE_SECRET_KEY || '';
const FLW_BASE = 'https://api.flutterwave.com/v3';

function json(statusCode: number, data: Record<string, unknown>) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

async function flwVerifyTransfer(transferId: string): Promise<any> {
  const res = await fetch(`${FLW_BASE}/transfers/${transferId}`, {
    headers: {
      Authorization: `Bearer ${FLW_SECRET}`,
      'Content-Type': 'application/json',
    },
  });
  const body = (await res.json()) as any;
  if (body.status !== 'success') {
    throw new Error(body.message || `Flutterwave verify failed: ${body.status}`);
  }
  return body.data;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!FLW_SECRET) {
    return json(500, { error: 'FLUTTERWAVE_SECRET_KEY is not configured' });
  }

  const db = getCrdbClient();
  await db.connect();

  try {
    // Find all payments stuck in 'processing' status
    const { rows: stuckPayments } = await db.query(`
      SELECT id, payroll_entry_id, provider_transfer_code, provider_reference, status, amount
      FROM public.payroll_payments
      WHERE status = 'processing'
        AND provider = 'flutterwave'
      ORDER BY created_at DESC
    `);

    if (stuckPayments.length === 0) {
      return json(200, { message: 'No stuck payments found', updated: 0, verified: 0, failed: 0 });
    }

    const results = {
      total: stuckPayments.length,
      updated: 0,
      already_paid: 0,
      verified_and_paid: 0,
      failed_verification: 0,
      no_transfer_id: 0,
      errors: [] as string[],
    };

    for (const payment of stuckPayments) {
      const transferId = payment.provider_transfer_code || payment.provider_reference;
      if (!transferId) {
        results.no_transfer_id++;
        continue;
      }

      try {
        const fwData = await flwVerifyTransfer(String(transferId));
        const fwStatus = String(fwData.status || '').toUpperCase();
        let newStatus: string;

        if (fwStatus === 'SUCCESSFUL' || fwStatus === 'SUCCESS' || fwStatus === 'COMPLETED') {
          newStatus = 'paid';
        } else if (fwStatus === 'FAILED' || fwStatus === 'REJECTED' || fwStatus === 'CANCELLED') {
          newStatus = 'failed';
        } else if (fwStatus === 'REVERSED') {
          newStatus = 'reversed';
        } else {
          // Still processing on Flutterwave side, skip
          continue;
        }

        await db.query('BEGIN');

        await db.query(
          `UPDATE public.payroll_payments
           SET status = $1,
               paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
               failure_reason = CASE WHEN $1 IN ('failed', 'reversed') THEN $2 ELSE NULL END,
               updated_at = now()
           WHERE id = $3::uuid`,
          [newStatus, fwData.complete_message || fwData.failure_reason || null, payment.id],
        );

        await db.query(
          `UPDATE public.payroll_entries
           SET status = $1, updated_at = now()
           WHERE id = $2::uuid`,
          [newStatus, payment.payroll_entry_id],
        );

        await db.query('COMMIT');

        results.updated++;
        if (newStatus === 'paid') results.verified_and_paid++;
      } catch (err: any) {
        await db.query('ROLLBACK').catch(() => {});
        results.errors.push(`${transferId}: ${err.message}`);
        results.failed_verification++;
      }
    }

    return json(200, results);
  } finally {
    await db.end().catch(() => {});
  }
};
