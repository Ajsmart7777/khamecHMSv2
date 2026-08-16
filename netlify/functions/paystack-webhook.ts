import { database } from './_shared/auth.js';

function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-paystack-signature', 'Content-Type': 'text/plain' } });
}

async function verifySignature(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const actual = new Uint8Array(signature.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return textResponse('', 204);
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = request.headers.get('x-paystack-signature');
    if (!secret) return textResponse('Server misconfigured', 500);
    if (!signature) return textResponse('Unauthorized', 401);
    const rawBody = await request.text();
    if (!(await verifySignature(rawBody, signature, secret))) return textResponse('Unauthorized', 401);

    const payload = JSON.parse(rawBody);
    const event = payload?.event;
    const data = payload?.data;
    if (!event || !data || !['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(event)) return textResponse('OK');

    const paymentStatus = event === 'transfer.success' ? 'paid' : event === 'transfer.failed' ? 'failed' : 'reversed';
    const reference = data.reference || null;
    const transferCode = data.transfer_code || null;
    if (!reference && !transferCode) return textResponse('OK');

    const sql = database();
    const payments = await sql`select id, payroll_entry_id from public.payroll_payments where (provider_reference = ${reference} or provider_transfer_code = ${transferCode}) limit 10` as Array<{ id: string; payroll_entry_id: string }>;
    for (const payment of payments) {
      await sql`update public.payroll_payments set status = ${paymentStatus}, provider_transfer_code = coalesce(${transferCode}, provider_transfer_code), paid_at = case when ${paymentStatus} = 'paid' then now() else paid_at end where id = ${payment.id}::uuid`;
      await sql`update public.payroll_entries set status = ${paymentStatus} where id = ${payment.payroll_entry_id}::uuid`;
    }
    return textResponse('OK');
  } catch (error) {
    console.error('[paystack-webhook]', error);
    return textResponse('Internal error', 500);
  }
};
