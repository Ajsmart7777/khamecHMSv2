import { getCrdbClient } from './_shared/crdb.js';

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, verif-hash',
      'Content-Type': 'text/plain',
    },
  });
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return textResponse('', 204);

  try {
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (!secretHash) return textResponse('Server misconfigured', 500);
    if (request.headers.get('verif-hash') !== secretHash) return textResponse('Unauthorized', 401);
    if (request.method !== 'POST') return textResponse('Method not allowed', 405);

    const payload = await request.json();
    const event = payload?.event;
    const data = payload?.data;
    if (!event || !data || typeof event !== 'string' || !event.startsWith('transfer.')) return textResponse('OK');

    const status = String(data.status || '').toUpperCase();
    const paymentStatus = status === 'SUCCESSFUL' || status === 'SUCCESS'
      ? 'paid'
      : status === 'FAILED' || status === 'REJECTED' || status === 'CANCELLED'
        ? 'failed'
        : status === 'REVERSED'
          ? 'reversed'
          : 'processing';
    const reference = data.reference || null;
    const transferId = String(data.id || data.transfer_id || data.transfer_code || '') || null;
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

      for (const payment of payments.rows as Array<{ id: string; payroll_entry_id: string }>) {
        await db.query(
          `UPDATE public.payroll_payments
              SET status = $1,
                  provider_transfer_code = COALESCE($2, provider_transfer_code),
                  paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE paid_at END
            WHERE id = $3::uuid`,
          [paymentStatus, transferId, payment.id],
        );
        await db.query(
          `UPDATE public.payroll_entries
              SET status = $1
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
