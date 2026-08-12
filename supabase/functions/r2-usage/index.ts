import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { json, r2Config, validate, requireUser } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  try {
    const uid = await requireUser(req);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const admin = adminClient();
    const { data: roleData, error: roleError } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', uid)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !roleData) {
      console.error(`Access denied for user ${uid}: ${roleError?.message || 'No admin role'}`);
      return json({ error: 'Unauthorized: Admin role required' }, 403);
    }

    
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
    // <Contents><Key>...</Key><Size>...</Size></Contents>
    const contentMatches = [...xml.matchAll(/<Contents>(.*?)<\/Contents>/gs)];
    const keys: string[] = [];
    const sizes: number[] = [];

    contentMatches.forEach(match => {
      const content = match[1];
      const keyMatch = content.match(/<Key>(.*?)<\/Key>/);
      const sizeMatch = content.match(/<Size>(\d+)<\/Size>/);
      if (keyMatch && sizeMatch) {
        keys.push(keyMatch[1]);
        sizes.push(parseInt(sizeMatch[1]));
      }
    });
    
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
