import { database } from './_shared/auth.js';
import { json, optionsResponse, r2Config, requireUser } from './_shared/r2.js';

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST' && request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const userId = await requireUser(request);
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    const sql = database();
    const roles = await sql`select role from public.user_roles where user_id = ${userId}::uuid and role = 'admin' limit 1` as Array<{ role: string }>;
    if (!roles[0]) return json({ error: 'Unauthorized: Admin role required' }, 403);

    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);

    const listResponse = await cfg.client.fetch(`${cfg.endpoint}?list-type=2`, { method: 'GET' });
    if (!listResponse.ok) return json({ error: 'Failed to list R2 objects', details: await listResponse.text() }, listResponse.status);

    const xml = await listResponse.text();
    const breakdown: Record<string, { objects: number; size: number }> = {};
    let totalObjects = 0;
    let totalSize = 0;
    for (const match of xml.matchAll(/<Contents>(.*?)<\/Contents>/gs)) {
      const key = match[1].match(/<Key>(.*?)<\/Key>/)?.[1];
      const size = Number(match[1].match(/<Size>(\d+)<\/Size>/)?.[1] || 0);
      if (!key) continue;
      const logicalBucket = key.split('/')[0] || 'other';
      breakdown[logicalBucket] ??= { objects: 0, size: 0 };
      breakdown[logicalBucket].objects += 1;
      breakdown[logicalBucket].size += size;
      totalObjects += 1;
      totalSize += size;
    }

    return json({ bucket: cfg.bucket, total_objects: totalObjects, total_size_bytes: totalSize, breakdown, requested_by: userId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
