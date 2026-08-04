import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config, objectKey, validate, requireUser } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const uid = await requireUser(req);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const { bucket, path } = await req.json();
    const invalid = validate(bucket, path);
    if (invalid) return json({ error: invalid }, 400);

    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);

    const res = await cfg.client.fetch(`${cfg.endpoint}/${objectKey(bucket, path)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      console.error(`R2 delete failed [${res.status}]: ${body}`);
      return json({ error: 'Delete failed', status: res.status, details: body }, res.status);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
