import { database, json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

const FLW_BASE = 'https://api.flutterwave.com';
const ALLOWED_ROLES = ['billing', 'accountant', 'admin'];

class FlutterwaveBusinessError extends Error {}

async function flwRequest(path: string, method = 'GET', body?: unknown) {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) throw new Error('FLUTTERWAVE_SECRET_KEY not configured');
  const response = await fetch(`${FLW_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status !== 'success') {
    const message = typeof data?.message === 'string' ? data.message : typeof data?.error?.message === 'string' ? data.error.message : 'Flutterwave rejected the request';
    throw new FlutterwaveBusinessError(message);
  }
  return data;
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const caller = await verifyUser(request);
    if (!caller) return json({ error: 'Unauthorized' }, 401);
    const sql = database();
    const roles = await sql`select role from public.user_roles where user_id = ${caller.id}::uuid` as Array<{ role: string }>;
    if (!roles.some(({ role }) => ALLOWED_ROLES.includes(role))) return json({ error: 'Forbidden: billing, accountant, or admin role required' }, 403);

    const body = await readJson<Record<string, unknown>>(request);
    switch (body.action) {
      case 'get_balance':
        return json({ balance: (await flwRequest('/v3/balances/NGN')).data });
      case 'list_banks':
        return json({ banks: (await flwRequest('/v3/banks/NG')).data });
      case 'resolve_account':
        return json({ account: (await flwRequest('/v3/accounts/resolve', 'POST', { account_number: body.account_number, account_bank: body.account_bank })).data });
      case 'initiate_transfer': {
        const data = await flwRequest('/v3/transfers', 'POST', {
          account_bank: String(body.account_bank ?? ''),
          account_number: String(body.account_number ?? ''),
          amount: Number(body.amount ?? 0),
          narration: typeof body.narration === 'string' && body.narration ? body.narration : 'Salary payment',
          currency: 'NGN',
          reference: typeof body.reference === 'string' ? body.reference : undefined,
          beneficiary_name: typeof body.beneficiary_name === 'string' ? body.beneficiary_name : undefined,
        });
        const transfer = data?.data;
        const rejected = new Set(['FAILED', 'REJECTED', 'CANCELLED', 'REVERSED']);
        if (!transfer?.id || rejected.has(String(transfer.status || '').toUpperCase())) {
          throw new FlutterwaveBusinessError(transfer?.complete_message || transfer?.failure_reason || 'Flutterwave did not accept this transfer for processing');
        }
        return json({ transfer });
      }
      case 'bulk_transfer':
        return json({ result: (await flwRequest('/v3/bulk-transfers', 'POST', {
          title: 'Payroll Bulk Transfer',
          bulk_data: (Array.isArray(body.transfers) ? body.transfers : []).map((transfer: unknown) => {
            const item = transfer as Record<string, unknown>;
            return ({
              bank_code: String(item.account_bank ?? ''),
              account_number: String(item.account_number ?? ''),
              amount: Number(item.amount ?? 0),
              narration: typeof item.narration === 'string' && item.narration ? item.narration : 'Salary payment',
              currency: 'NGN',
              reference: typeof item.reference === 'string' ? item.reference : undefined,
              beneficiary_name: typeof item.beneficiary_name === 'string' ? item.beneficiary_name : undefined,
            });
          }),
        })).data });
      case 'verify_transfer':
        return json({ transfer: (await flwRequest(`/v3/transfers/${body.transfer_id}`)).data });
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (error) {
    if (error instanceof FlutterwaveBusinessError) return json({ error: error.message, type: 'flutterwave_business_error' }, 200);
    return json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
};
