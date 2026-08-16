import { database } from './_shared/auth.js';

function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, verif-hash', 'Content-Type': 'text/plain' } });
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return textResponse('', 204);
  try {
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (!secretHash) return textResponse('Server misconfigured', 500);
    if (request.headers.get('verif-hash') !== secretHash) return textResponse('Unauthorized', 401);

    const payload = await request.json();
    const event = payload?.event;
    const data = payload?.data;
    if (!event || !data || typeof event !== 'string' || !event.startsWith('transfer.')) return textResponse('OK');

    const status = String(data.status || '').toUpperCase();
    const paymentStatus = status === 'SUCCESSFUL' || status === 'SUCCESS' ? 'paid' : status === 'FAILED' || status === 'REJECTED' || status === 'CANCELLED' ? 'failed' : status === 'REVERSED' ? 'reversed' : 'processing';
    const failureReason = paymentStatus === 'paid' || paymentStatus === 'processing' ? null : data.complete_message || data.failure_reason || `Flutterwave transfer ${status || 'failed'}`;
    const reference = data.reference || null;
    const transferId = String(data.id || data.transfer_id || data.transfer_code || '') || null;
    if (!reference && !transferId) return textResponse('OK');

    const sql = database();
    const payments = await sql`select id, payroll_entry_id from public.payroll_payments where (provider_reference = ${reference} or provider_transfer_code = ${transferId}) limit 10` as Array<{ id: string; payroll_entry_id: string }>;
    for (const payment of payments) {
      await sql`update public.payroll_payments set status = ${paymentStatus}, provider_transfer_code = coalesce(${transferId}, provider_transfer_code), failure_reason = ${failureReason}, paid_at = case when ${paymentStatus} = 'paid' then now() else paid_at end where id = ${payment.id}::uuid`;
      await sql`update public.payroll_entries set status = ${paymentStatus} where id = ${payment.payroll_entry_id}::uuid`;
    }
    return textResponse('OK');
  } catch (error) {
    console.error('[flutterwave-webhook]', error);
    return textResponse('Internal error', 500);
  }
};
