import { json, objectKey, optionsResponse, r2Config, r2MissingConfig, requireUser, validate } from './_shared/r2.js';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const uid = await requireUser(request);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const form = await request.formData();
    const bucket = form.get('bucket');
    const path = form.get('path');
    const requestedType = form.get('contentType');
    const file = form.get('file');

    const invalid = validate(bucket, path);
    if (invalid) return json({ error: invalid }, 400);
    if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
      return json({ error: 'file is required' }, 400);
    }

    const cfg = r2Config();
    if (!cfg) {
      return json({ error: 'R2 is not configured', missing: r2MissingConfig() }, 500);
    }

    const blob = file as Blob;
    if (blob.size > MAX_UPLOAD_BYTES) {
      return json({ error: `file is too large; maximum is ${MAX_UPLOAD_BYTES} bytes` }, 413);
    }

    const contentType = typeof requestedType === 'string' && requestedType
      ? requestedType
      : (blob.type || 'application/octet-stream');
    const url = `${cfg.endpoint}/${objectKey(bucket as string, path as string)}`;
    const response = await cfg.client.fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: await blob.arrayBuffer(),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      return json({ error: 'Upload failed', status: response.status, details }, response.status);
    }

    return json({ ok: true, path, size: blob.size });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};

export const config = { path: '/.netlify/functions/r2-upload' };

