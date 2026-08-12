import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const BUCKETS = ['visit-cards', 'emr-attachments', 'patient-photos'];

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function r2Config() {
  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
  };
}

/** Object key inside the single R2 bucket: `<logical-bucket>/<path>`. */
export function objectKey(logicalBucket: string, path: string) {
  return `${logicalBucket}/${path}`;
}

export function validate(logicalBucket: unknown, path: unknown): string | null {
  if (typeof logicalBucket !== 'string' || !BUCKETS.includes(logicalBucket)) return 'invalid bucket';
  if (typeof path !== 'string' || !path.length || path.length > 512) return 'invalid path';
  if (path.includes('..') || path.startsWith('/')) return 'invalid path';
  return null;
}

/** Returns the authenticated user id, or null. */
export async function requireUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}
