/**
 * Netlify Function: payroll-payment
 *
 * This is the **frontend API actions** endpoint. The React payroll UI calls
 * this function for Flutterwave interactions: balance check, bank listing,
 * account resolution, transfer initiation, bulk transfers, and transfer
 * verification.
 *
 * Flutterwave **webhook callbacks** (async transfer status updates) are
 * handled separately by `flutterwave-webhook.ts`.
 *
 * Required environment variables:
 *   FLUTTERWAVE_SECRET_KEY – Flutterwave v3 secret key
 */

import type { Handler } from '@netlify/functions';

const FLW_SECRET = process.env.FLUTTERWAVE_SECRET_KEY || '';
const FLW_BASE = 'https://api.flutterwave.com/v3';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function json(statusCode: number, data: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(data),
  };
}

/** Call a Flutterwave v3 endpoint. Throws on non-success status. */
async function flwFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${FLW_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${FLW_SECRET}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = (await res.json()) as any;
  if (body.status !== 'success') {
    throw new Error(body.message || `Flutterwave ${path} returned ${body.status}`);
  }
  return body.data;
}

/* ── Action handlers ────────────────────────────────────────────────────── */

async function actGetBalance(): Promise<ReturnType<typeof json>> {
  const balance = await flwFetch('/balances?currency=NGN');
  return json(200, { balance });
}

async function actListBanks(): Promise<ReturnType<typeof json>> {
  const banks = await flwFetch('/banks/NG');
  return json(200, { banks });
}

async function actResolveBank(bankName: string): Promise<ReturnType<typeof json>> {
  const banks: any[] = await flwFetch('/banks/NG');
  const needle = bankName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = banks.find((b: any) => {
    const name = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return name === needle || name.includes(needle) || needle.includes(name);
  });
  if (!match) {
    throw new Error(`${bankName} is not available in Flutterwave's current bank list`);
  }
  return json(200, { bank: { code: match.code, name: match.name } });
}

async function actResolveAccount(
  accountNumber: string,
  bankCode: string,
): Promise<ReturnType<typeof json>> {
  const account = await flwFetch('/accounts/resolve', {
    method: 'POST',
    body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
  });
  return json(200, { account });
}

async function actInitiateTransfer(
  params: Record<string, unknown>,
): Promise<ReturnType<typeof json>> {
  const transfer = await flwFetch('/transfers', {
    method: 'POST',
    body: JSON.stringify({ ...params, currency: 'NGN' }),
  });
  return json(200, { transfer });
}

async function actBulkTransfer(transfers: any[]): Promise<ReturnType<typeof json>> {
  const data = await flwFetch('/transfers/bulk', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Payroll Bulk Transfer',
      transfers: transfers.map((t) => ({ ...t, currency: 'NGN' })),
    }),
  });
  return json(200, { transfers: data });
}

async function actVerifyTransfer(transferId: string): Promise<ReturnType<typeof json>> {
  const transfer = await flwFetch(`/transfers/${transferId}`);
  return json(200, { transfer });
}

/* ── Main handler ──────────────────────────────────────────────────────── */

export const handler: Handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  if (!FLW_SECRET) {
    return json(500, {
      error: 'Flutterwave API key is not configured on the server',
    });
  }

  const { action, ...params } = body;

  try {
    switch (action) {
      case 'get_balance':
        return await actGetBalance();
      case 'list_banks':
        return await actListBanks();
      case 'resolve_bank':
        return await actResolveBank(params.bank_name);
      case 'resolve_account':
        return await actResolveAccount(params.account_number, params.account_bank);
      case 'initiate_transfer':
        return await actInitiateTransfer(params);
      case 'bulk_transfer':
        return await actBulkTransfer(params.transfers);
      case 'verify_transfer':
        return await actVerifyTransfer(params.transfer_id);
      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    console.error(`payroll-payment action "${action}" failed:`, err.message);
    return json(500, { error: err.message || 'Internal error' });
  }
};
