import { json, objectKey, optionsResponse, r2Config, r2MissingConfig, requireUser, validate } from './_shared/r2.js';

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const uid = await requireUser(request);
    if (!uid) return json({ error: 'Unauthorized' }, 401);

    const isMultipart = (request.headers.get('content-type') || '').includes('multipart/form-data');
    let bucket: unknown;
    let path: unknown;
    let contentType: unknown;
    let file: FormDataEntryValue | null = null;

    if (isMultipart) {
      const form = await request.formData();
      bucket = form.get('bucket');
      path = form.get('path');
      contentType = form.get('contentType');
      file = form.get('file');
    } else {
      ({ bucket, path, contentType } = await request.json() as {
        bucket?: unknown;
        path?: unknown;
        contentType?: unknown;
      });
    }

    const invalid = validate(bucket, path);
    if (invalid) return json({ error: invalid }, 400);

    const cfg = r2Config();
    if (!cfg) {
      return json({
        error: 'R2 is not configured',
        missing: r2MissingConfig(),
      }, 500);
    }
    const type = typeof contentType === 'string' && contentType ? contentType : 'application/octet-stream';
    const url = `${cfg.endpoint}/${objectKey(bucket as string, path as string)}`;

    if (isMultipart) {
      if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
        return json({ error: 'file is required' }, 400);
      }
      const blob = file as Blob;
      if (blob.size > 12 * 1024 * 1024) {
        return json({ error: 'file is too large; maximum is 12582912 bytes' }, 413);
      }
      const response = await cfg.client.fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': type },
        body: await blob.arrayBuffer(),
      });
      if (!response.ok) {
        return json({ error: 'Upload failed', status: response.status, details: (await response.text()).slice(0, 500) }, response.status);
      }
      return json({ ok: true, path, size: blob.size });
    }

    const signed = await cfg.client.sign(
      new Request(`${url}?X-Amz-Expires=600`, {
        method: 'PUT',
        headers: { 'Content-Type': type },
      }),
      { aws: { signQuery: true, allHeaders: true } },
    );

    return json({ url: signed.url, expires_in: 600 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
};
