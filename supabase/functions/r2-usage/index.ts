import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, r2Config, requireUser } from '../_shared/r2.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized', debug: 'No Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const client = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from the token passed in Authorization header
    const { data: { user }, error: userError } = await client.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) {
      return json({ error: 'Unauthorized', debug: 'Invalid token', details: userError }, 401);
    }
    
    const { data: roleData, error: roleError } = await client
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !roleData) {
      return json({ 
        error: 'Unauthorized: Admin role required', 
        debug: { uid: user.id, roleError, hasRole: !!roleData } 
      }, 403);
    }

    const cfg = r2Config();
    if (!cfg) {
      return json({ 
        error: 'R2 is not configured',
        debug: {
          accountId: !!Deno.env.get('R2_ACCOUNT_ID'),
          accessKeyId: !!Deno.env.get('R2_ACCESS_KEY_ID'),
          secretAccessKey: !!Deno.env.get('R2_SECRET_ACCESS_KEY'),
          bucket: !!Deno.env.get('R2_BUCKET')
        }
      }, 500);
    }

    // LIST objects to get usage
    const listUrl = `${cfg.endpoint}?list-type=2`;
    const res = await cfg.client.fetch(listUrl, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      return json({ error: 'Failed to list R2 objects', details: body }, res.status);
    }

    const xml = await res.text();
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