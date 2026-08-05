import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config, objectKey } from '../_shared/r2.ts';

/** Temporary diagnostic: verifies R2 credentials, PUT, public GET and DELETE. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const steps: Record<string, unknown> = {};
  try {
    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured (missing secrets)' }, 500);
    steps.bucket = cfg.bucket;

    const key = objectKey('visit-cards', `_selftest/${crypto.randomUUID()}.txt`);
    const put = await cfg.client.fetch(`${cfg.endpoint}/${key}`, {
      method: 'PUT',
      body: new TextEncoder().encode('ok'),
      headers: { 'Content-Type': 'text/plain' },
    });
    steps.put = put.status;
    if (!put.ok) steps.putBody = (await put.text()).slice(0, 400);

    const publicUrl = Deno.env.get('R2_PUBLIC_URL')?.replace(/\/+$/, '');
    if (publicUrl) {
      const get = await fetch(`${publicUrl}/${key}`);
      steps.publicGet = get.status;
      steps.publicBody = (await get.text()).slice(0, 120);
    } else {
      steps.publicGet = 'R2_PUBLIC_URL not set';
    }

    const del = await cfg.client.fetch(`${cfg.endpoint}/${key}`, { method: 'DELETE' });
    steps.delete = del.status;

    return json({ ok: true, steps });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e), steps }, 500);
  }
});
