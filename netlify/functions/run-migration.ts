import type { Handler } from '@netlify/functions';
import { getCrdbPool } from './_shared/crdb.js';
import { verifyUser } from './_shared/auth.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const authHeaders = new Headers();
    const authorization = event.headers?.authorization || event.headers?.Authorization;
    if (authorization) authHeaders.set('Authorization', authorization);
    const verifiedUser = await verifyUser(new Request('https://internal.invalid/.netlify/functions/run-migration', {
      method: 'POST',
      headers: authHeaders,
    }));
    if (!verifiedUser || verifiedUser.role !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const migrationName = body.migration;

    if (!migrationName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Migration name required' }) };
    }

    const client = await getCrdbPool().connect();
    try {
      const migrations: Record<string, string> = {
        'corporate_manual_patient_records': `
          CREATE TABLE IF NOT EXISTS public.corporate_manual_patient_records (
            id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
            sponsor_id UUID NOT NULL,
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            patient_name TEXT NOT NULL,
            card_number TEXT,
            visits INTEGER NOT NULL DEFAULT 0,
            medication NUMERIC NOT NULL DEFAULT 0,
            lab_test NUMERIC NOT NULL DEFAULT 0,
            delivery NUMERIC NOT NULL DEFAULT 0,
            bed NUMERIC NOT NULL DEFAULT 0,
            others NUMERIC NOT NULL DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS idx_manual_patient_records_sponsor_period
            ON public.corporate_manual_patient_records (sponsor_id, period_year, period_month);
          ALTER TABLE public.corporate_manual_patient_records ENABLE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS "Authenticated staff can read manual patient records" ON public.corporate_manual_patient_records;
          CREATE POLICY "Authenticated staff can read manual patient records"
            ON public.corporate_manual_patient_records FOR SELECT TO authenticated USING (true);
          DROP POLICY IF EXISTS "Authenticated staff can insert manual patient records" ON public.corporate_manual_patient_records;
          CREATE POLICY "Authenticated staff can insert manual patient records"
            ON public.corporate_manual_patient_records FOR INSERT TO authenticated WITH CHECK (true);
          DROP POLICY IF EXISTS "Authenticated staff can update manual patient records" ON public.corporate_manual_patient_records;
          CREATE POLICY "Authenticated staff can update manual patient records"
            ON public.corporate_manual_patient_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
          DROP POLICY IF EXISTS "Authenticated staff can delete manual patient records" ON public.corporate_manual_patient_records;
          CREATE POLICY "Authenticated staff can delete manual patient records"
            ON public.corporate_manual_patient_records FOR DELETE TO authenticated USING (true);
        `,
      };

      const sql = migrations[migrationName];
      if (!sql) {
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown migration: ${migrationName}` }) };
      }

      // Execute each statement separately
      const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of statements) {
        await client.query(stmt);
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, migration: migrationName }),
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Migration failed' }),
    };
  }
};

export default handler;
