import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config, objectKey, validate, requireUser } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const uid = await requireUser(req);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const { bucket, path, contentType } = await req.json();
    const invalid = validate(bucket, path);
    if (invalid) return json({ error: invalid }, 400);

    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);

    const url = `${cfg.endpoint}/${objectKey(bucket, path)}`;
    // Sign the query only, with no signed headers beyond host: the browser is
    // then free to send its own Content-Type without breaking the signature.
    const signed = await cfg.client.sign(
      new Request(`${url}?X-Amz-Expires=600`, { method: 'PUT' }),
      { aws: { signQuery: true } },
    );


    return json({ url: signed.url, expires_in: 600 });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
