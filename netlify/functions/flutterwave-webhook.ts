import { getCrdbClient } from './_shared/crdb.js';
import crypto from 'crypto';

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, verif-hash, x-flutterwave-signature',
      'Content-Type': 'text/plain',
    },
  });
}

/**
 * Verify the webhook request using whichever method Flutterwave uses:
 *  - Old method: `verif-hash` header compared directly to the secret hash
 *  - New method: `x-flutterwave-signature` header is HMAC-SHA256 of the body
 */
function verifySignature(
  rawBody: string,
  headers: Headers,
  secretHash: string,
): boolean {
  // Try HMAC-SHA256 first (newer Flutterwave format)
  const hmacSig = headers.get('x-flutterwave-signature');
  if (hmacSig) {
    const expected = crypto
      .createHmac('sha256', secretHash)
      .update(rawBody)
      .digest('hex');
    return hmacSig === expected;
  }

  // Fall back to verif-hash (older Flutterwave format)
  const verifHash = headers.get('verif-hash');
  if (verifHash) {
    return verifHash === secretHash;
  }

  return false;
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return textResponse('', 204);

  try {
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (!secretHash) return textResponse('Server misconfigured', 500);

    if (request.method !== 'POST') return textResponse('Method not allowed', 405);

    // Read raw body for HMAC verification AND JSON parsing
    const rawBody = await request.text();

    if (!verifySignature(rawBody, request.headers, secretHash)) {
      return textResponse('Unauthorized', 401);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return textResponse('Invalid JSON', 400);
    }

    const event = payload?.event;
    const data = payload?.data;
    if (!event || !data || typeof event !== 'string' || !event.startsWith('transfer.'))
      return textResponse('OK');

    const status = String(data.status || '').toUpperCase();
    const paymentStatus =
      status === 'SUCCESSFUL' || status === 'SUCCESS' || status === 'COMPLETED'
        ? 'paid'
        : status === 'FAILED' || status === 'REJECTED' || status === 'CANCELLED'
          ? 'failed'
          : status === 'REVERSED'
            ? 'reversed'
            : 'processing';

    const reference = data.reference || null;
    const transferId =
      String(data.id || data.transfer_id || data.transfer_code || '') || null;
    if (!reference && !transferId) return textResponse('OK');

    const db = getCrdbClient();
    await db.connect();
    try {
      await db.query('BEGIN');
      const payments = await db.query(
        `SELECT id, payroll_entry_id
           FROM public.payroll_payments
          WHERE provider_reference = $1 OR provider_transfer_code = $2
          LIMIT 10`,
        [reference, transferId],
      );

      for (const payment of payments.rows as Array<{
        id: string;
        payroll_entry_id: string;
      }>) {
        // Don't downgrade a status that is already confirmed as paid
        if (paymentStatus !== 'paid') {
          const current = await db.query(
            `SELECT status FROM public.payroll_payments WHERE id = $1::uuid`,
            [payment.id],
          );
          if (current.rows[0]?.status === 'paid') continue;
        }

        await db.query(
          `UPDATE public.payroll_payments
              SET status = $1,
                  provider_transfer_code = COALESCE($2, provider_transfer_code),
                  failure_reason = CASE WHEN $1 IN ('failed', 'reversed') THEN COALESCE($4, failure_reason) ELSE NULL END,
                  paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END
            WHERE id = $3::uuid`,
          [
            paymentStatus,
            transferId,
            payment.id,
            data.complete_message || data.failure_reason || null,
          ],
        );
        await db.query(
          `UPDATE public.payroll_entries
              SET status = $1,
                  updated_at = now()
            WHERE id = $2::uuid`,
          [paymentStatus, payment.payroll_entry_id],
        );
      }
      await db.query('COMMIT');
      return textResponse('OK');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await db.end();
    }
  } catch (error) {
    console.error('[flutterwave-webhook]', error);
    return textResponse('Internal error', 500);
  }
};
