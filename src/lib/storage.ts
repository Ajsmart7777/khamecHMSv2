import { supabase } from '@/integrations/supabase/client';

/**
 * Single storage adapter for the whole app.
 *
 * Provider is chosen at build time:
 *  - VITE_R2_PUBLIC_URL set  -> Cloudflare R2 (uploads via presigned PUT, reads
 *    straight from the public R2 domain, deletes via edge function)
 *  - not set                 -> Supabase Storage (signed URLs)
 *
 * Object paths are identical in both providers (`<bucket>/<path>`), so the
 * database columns (`snap_orders.photo_path`, `visit_attachments.storage_path`,
 * `emr_attachments.file_path`, `patients.photo_path`) never change.
 */

export type StorageBucket = 'visit-cards' | 'emr-attachments' | 'patient-photos';

const R2_PUBLIC_URL = (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined)?.replace(/\/+$/, '');

export const usingR2 = !!R2_PUBLIC_URL;

/** Upload a file/blob. Returns the storage path on success, throws on failure. */
export async function uploadFile(
  bucket: StorageBucket,
  path: string,
  body: File | Blob,
  contentType?: string,
): Promise<string> {
  const type = contentType || (body as File).type || 'application/octet-stream';

  if (R2_PUBLIC_URL) {
    let data: unknown, error: unknown;
    try {
      ({ data, error } = await supabase.functions.invoke('r2-sign-upload', {
        body: { bucket, path, contentType: type },
      }));
    } catch (e) {
      throw new Error(
        'Step 1/2 (sign upload) failed to reach the server. Check that the edge function ' +
          '"r2-sign-upload" is deployed and that you are logged in. ' +
          `Details: ${(e as Error).message}`,
      );
    }
    if (error) throw new Error(`Step 1/2 (sign upload): ${await readFnError(error)}`);
    const url = (data as any)?.url;
    if (!url) throw new Error('Step 1/2 (sign upload): server did not return an upload URL');

    let put: Response;
    try {
      put = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': type } });
    } catch (e) {
      throw new Error(
        'Step 2/2 (upload to R2) was blocked by the browser — this is almost always the R2 ' +
          'bucket CORS policy. Add your site URL to the bucket CORS rules (PUT + GET allowed). ' +
          `Details: ${(e as Error).message}`,
      );
    }
    if (!put.ok) throw new Error(`Step 2/2 (upload to R2) failed (${put.status})`);
    return path;
  }


  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}

/** Readable URL for a stored object. */
export async function getFileUrl(
  bucket: StorageBucket,
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!path) return null;
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}/${bucket}/${encodePath(path)}`;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

/** Best-effort delete. Never throws. */
export async function deleteFile(bucket: StorageBucket, path: string): Promise<boolean> {
  if (!path) return false;
  try {
    if (R2_PUBLIC_URL) {
      const { error } = await supabase.functions.invoke('r2-delete', { body: { bucket, path } });
      return !error;
    }
    const { error } = await supabase.storage.from(bucket).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function readFnError(error: unknown): Promise<string> {
  const anyErr = error as any;
  try {
    if (anyErr?.context?.text) return await anyErr.context.text();
  } catch {
    /* ignore */
  }
  return anyErr?.message ?? 'Upload authorisation failed';
}
