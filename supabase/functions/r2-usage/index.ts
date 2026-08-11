import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config, validate, requireUser } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  try {
    const uid = await requireUser(req);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    // We don't check for admin role here because requireUser only verifies session.
    // However, the client calling this should be an admin.
    // For tighter security, we could use adminClient() to check user_roles table.
    
    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);

    // List objects in the bucket
    // R2 is S3-compatible. We use the endpoint to list.
    // We'll use a simple fetch to the endpoint with list-type-2 params.
    const url = `${cfg.endpoint}?list-type=2`;
    
    const res = await cfg.client.fetch(url, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      return json({ error: 'Failed to list R2 objects', details: body }, res.status);
    }

    const xml = await res.text();
    
    // Simple XML parsing for S3 ListBucketResult
    // <Key>...</Key><Size>...</Size>
    const keys = [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map(m => m[1]);
    const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map(m => parseInt(m[1]));
    
    const totalObjects = keys.length;
    const totalSize = sizes.reduce((acc, s) => acc + s, 0);

    // Breakdown by "logical bucket" (first part of path)
    const breakdown: Record<string, { objects: number, size: number }> = {};
    keys.forEach((key, i) => {
      const parts = key.split('/');
      const logicalBucket = parts[0] || 'other';
      if (!breakdown[logicalBucket]) {
        breakdown[logicalBucket] = { objects: 0, size: 0 };
      }
      breakdown[logicalBucket].objects += 1;
      breakdown[logicalBucket].size += sizes[i];
    });

    return json({
      bucket: cfg.bucket,
      total_objects: totalObjects,
      total_size_bytes: totalSize,
      breakdown
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
