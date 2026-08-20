import { getCrdbClient } from './_shared/crdb.js';
import { json, optionsResponse, r2Config, requireUser } from './_shared/r2.js';

function xmlTag(xml: string, tag: string): string | null {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? null;
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST' && request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const userId = await requireUser(request);
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    const sql = getCrdbClient();
    await sql.connect();
    try {
      const roles = await sql.query(
        `select role from public.user_roles where user_id = $1::uuid and role = 'admin' limit 1`,
        [userId],
      );
      if (!roles.rows[0]) return json({ error: 'Unauthorized: Admin role required' }, 403);
    } finally {
      await sql.end();
    }

    const cfg = r2Config();
    if (!cfg) {
      return json({
        error: 'R2 is not configured',
        provider: 'cloudflare_r2',
        measured: false,
      }, 503);
    }

    const breakdown: Record<string, { objects: number; size: number }> = {};
    let totalObjects = 0;
    let totalSize = 0;
    let continuationToken: string | null = null;
    let listingPages = 0;

    do {
      const url = new URL(cfg.endpoint);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('max-keys', '1000');
      if (continuationToken) url.searchParams.set('continuation-token', continuationToken);

      const listResponse = await cfg.client.fetch(url.toString(), { method: 'GET' });
      if (!listResponse.ok) return json({ error: 'Failed to list R2 objects', details: await listResponse.text() }, listResponse.status);

      const xml = await listResponse.text();
      listingPages += 1;
      for (const match of xml.matchAll(/<Contents>([\\s\\S]*?)<\\/Contents>/g)) {
        const key = xmlTag(match[1], 'Key');
        const size = Number(xmlTag(match[1], 'Size') || 0);
        if (!key) continue;
        const logicalBucket = key.split('/')[0] || 'other';
        breakdown[logicalBucket] ??= { objects: 0, size: 0 };
        breakdown[logicalBucket].objects += 1;
        breakdown[logicalBucket].size += Number.isFinite(size) && size >= 0 ? size : 0;
        totalObjects += 1;
        totalSize += Number.isFinite(size) && size >= 0 ? size : 0;
      }

      const truncated = xmlTag(xml, 'IsTruncated') === 'true';
      continuationToken = truncated ? xmlTag(xml, 'NextContinuationToken') : null;
      if (truncated && !continuationToken) {
        return json({ error: 'R2 returned an incomplete listing without a continuation token' }, 502);
      }
    } while (continuationToken);

    return json({
      bucket: cfg.bucket,
      total_objects: totalObjects,
      total_size_bytes: totalSize,
      breakdown,
      listing_pages: listingPages,
      measured: true,
      quota_bytes: null,
      requested_by: userId,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};

export const config = { path: '/.netlify/functions/r2-usage' };
