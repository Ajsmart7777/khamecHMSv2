import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config, objectKey, requireUser, adminClient } from '../_shared/r2.ts';

const BUCKETS = ['visit-cards', 'emr-attachments', 'patient-photos'];

/**
 * One-time migration: copy every object from Supabase Storage into R2,
 * keeping identical paths so no database column has to change.
 *
 * Admin only. Call repeatedly with the returned cursor until done=true.
 * Body: { bucket?: string, prefix?: string, limit?: number, dryRun?: boolean }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const uid = await requireUser(req);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const admin = adminClient();
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: uid, _role: 'admin' });
    if (!isAdmin) return json({ error: 'Admin only' }, 403);

    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);

    const body = await req.json().catch(() => ({}));
    const buckets: string[] = body.bucket ? [body.bucket] : BUCKETS;
    const limit = Math.min(Number(body.limit ?? 100), 300);
    const dryRun = !!body.dryRun;

    const report: Record<string, unknown> = {};
    let copied = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (const bucket of buckets) {
      const files = await listAll(admin, bucket);
      const slice = files.slice(0, limit);
      for (const path of slice) {
        const key = objectKey(bucket, path);
        // Skip if already present in R2
        const head = await cfg.client.fetch(`${cfg.endpoint}/${key}`, { method: 'HEAD' });
        if (head.ok) { skipped++; continue; }
        if (dryRun) { copied++; continue; }

        const { data: blob, error } = await admin.storage.from(bucket).download(path);
        if (error || !blob) { failed++; errors.push(`${key}: download ${error?.message}`); continue; }
        const put = await cfg.client.fetch(`${cfg.endpoint}/${key}`, {
          method: 'PUT',
          body: new Uint8Array(await blob.arrayBuffer()),
          headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        });
        if (!put.ok) { failed++; errors.push(`${key}: put ${put.status} ${await put.text()}`); continue; }
        copied++;
      }
      report[bucket] = { total: files.length, processed: slice.length };
    }

    return json({ ok: true, dryRun, copied, skipped, failed, errors: errors.slice(0, 20), report });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

/** Recursively list every object path in a Supabase bucket. */
async function listAll(admin: any, bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error || !data?.length) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null && !entry.metadata) out.push(...(await listAll(admin, bucket, full)));
      else out.push(full);
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return out;
}
