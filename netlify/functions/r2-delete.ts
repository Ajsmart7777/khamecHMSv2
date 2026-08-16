import { json, objectKey, optionsResponse, r2Config, requireUser, validate } from './_shared/r2.js';

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const uid = await requireUser(request);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const { bucket, path } = await request.json() as { bucket?: unknown; path?: unknown };
    const invalid = validate(bucket, path);
    if (invalid) return json({ error: invalid }, 400);

    const cfg = r2Config();
    if (!cfg) return json({ error: 'R2 is not configured' }, 500);
    const response = await cfg.client.fetch(`${cfg.endpoint}/${objectKey(bucket as string, path as string)}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 404) {
      const details = await response.text();
      return json({ error: 'Delete failed', status: response.status, details }, response.status);
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
