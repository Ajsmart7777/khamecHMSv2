import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config } from '../_shared/r2.ts';

/** Temporary admin utility: applies the browser CORS policy to the R2 bucket. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);

    const body = await req.json().catch(() => ({}));
    const origins: string[] = body.origins ?? [
      'http://localhost:8080',
      'http://localhost:5173',
      'https://*.lovable.app',
      'https://*.lovableproject.com',
      'https://*.netlify.app',
    ];

    const xml =
      '<CORSConfiguration>' +
      '<CORSRule>' +
      origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join('') +
      '<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>' +
      '<AllowedHeader>*</AllowedHeader>' +
      '<ExposeHeader>ETag</ExposeHeader>' +
      '<MaxAgeSeconds>3600</MaxAgeSeconds>' +
      '</CORSRule></CORSConfiguration>';

    const put = await cfg.client.fetch(`${cfg.endpoint}?cors`, {
      method: 'PUT',
      body: xml,
      headers: { 'Content-Type': 'application/xml' },
    });
    const text = await put.text();

    const check = await cfg.client.fetch(`${cfg.endpoint}?cors`, { method: 'GET' });
    const current = await check.text();

    return json({ ok: put.ok, status: put.status, response: text.slice(0, 400), current: current.slice(0, 800) });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
