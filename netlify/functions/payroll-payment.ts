import { json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';
import { getCrdbClient } from './_shared/crdb.js';

const FLW_BASE = 'https://api.flutterwave.com';
const ALLOWED_ROLES = ['billing', 'accountant', 'admin'];

class FlutterwaveBusinessError extends Error {}

function normalizeBankName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NIGERIAN_BANK_FALLBACKS = [
  // Flutterwave/NGN transfer code for TAJ Bank Limited. Keep this only as a
  // defensive fallback; the live provider list remains the source of truth.
  { code: '302', name: 'Taj Bank Limited' },
];

function normalizeNigerianBanks(raw: unknown) {
  const source = Array.isArray(raw) ? raw : [];
  const banks = source
    .map((bank) => {
      const item = bank as Record<string, unknown>;
      return {
        code: String(item.code ?? item.bank_code ?? item.id ?? '').trim(),
        name: String(item.name ?? item.bank_name ?? '').trim(),
      };
    })
    .filter((bank) => bank.code && bank.name);
  const byCode = new Map<string, { code: string; name: string }>();
  for (const bank of [...banks, ...NIGERIAN_BANK_FALLBACKS]) {
    if (!byCode.has(bank.code)) byCode.set(bank.code, bank);
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function getNigerianBanks() {
  const response = await flwRequest('/v3/banks/NG');
  return normalizeNigerianBanks(response.data);
}

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
    const db = getCrdbClient();
    await db.connect();
    let roles: Array<{ role: string }>;
    try {
      const result = await db.query(
        'SELECT role FROM public.user_roles WHERE user_id = $1::uuid LIMIT 20',
        [caller.id],
      );
      roles = result.rows as Array<{ role: string }>;
    } finally {
      await db.end();
    }
    if (!roles.some(({ role }) => ALLOWED_ROLES.includes(role))) return json({ error: 'Forbidden: billing, accountant, or admin role required' }, 403);

    const body = await readJson<Record<string, unknown>>(request);
    switch (body.action) {
      case 'get_balance':
        return json({ balance: (await flwRequest('/v3/balances/NGN')).data });
      case 'list_banks':
        return json({ banks: await getNigerianBanks() });
      case 'resolve_bank': {
        const requestedName = String(body.bank_name ?? '').trim();
        if (!requestedName) throw new FlutterwaveBusinessError('Bank name is required');
        const banks = await getNigerianBanks();
        const normalizedRequested = normalizeBankName(requestedName);
        const bank = (Array.isArray(banks) ? banks : []).find((candidate: Record<string, unknown>) => {
          const candidateName = String(candidate.name ?? '').trim();
          const normalizedCandidate = normalizeBankName(candidateName);
          return normalizedCandidate === normalizedRequested
            || normalizedCandidate.includes(normalizedRequested)
            || normalizedRequested.includes(normalizedCandidate);
        });
        if (!bank) throw new FlutterwaveBusinessError(`${requestedName} is not available in Flutterwave's current Nigerian bank list`);
        return json({ bank: { code: String(bank.code ?? bank.id ?? ''), name: String(bank.name ?? requestedName) } });
      }
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
