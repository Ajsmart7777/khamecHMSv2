import { AwsClient } from 'aws4fetch';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { verifySessionToken } from './session.js';

const LOGICAL_BUCKETS = new Set(['visit-cards', 'emr-attachments', 'patient-photos']);

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.FRONTEND_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function r2Environment() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY,
    bucket: process.env.R2_BUCKET || process.env.R2_BUCKET_NAME,
  };
}

export function r2MissingConfig() {
  const env = r2Environment();
  return Object.entries(env)
    .filter(([, value]) => !value)
    .map(([key]) => ({
      accountId: 'R2_ACCOUNT_ID',
      accessKeyId: 'R2_ACCESS_KEY_ID',
      secretAccessKey: 'R2_SECRET_ACCESS_KEY',
      bucket: 'R2_BUCKET',
    } as Record<string, string>)[key]);
}

export function r2Config() {
  const { accountId, accessKeyId, secretAccessKey, bucket } = r2Environment();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    bucket,
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
  };
}

export function objectKey(logicalBucket: string, path: string) {
  return `${logicalBucket}/${path}`;
}

export function validate(logicalBucket: unknown, path: unknown): string | null {
  if (typeof logicalBucket !== 'string' || !LOGICAL_BUCKETS.has(logicalBucket)) return 'invalid bucket';
  if (typeof path !== 'string' || !path.length || path.length > 512) return 'invalid path';
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return 'invalid path';
  return null;
}

export async function requireUser(req: Request): Promise<string | null> {
  const authorization = req.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  // CockroachDB clone sessions are signed locally because there is no Neon
  // Auth issuer in this deployment. Prefer this path when the token uses the
  // hms scheme, then retain Neon JWT verification for environments that use it.
  if (token.startsWith('hms.')) {
    return verifySessionToken(token);
  }

  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) return null;

  try {
    jwks ??= createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.NEON_AUTH_ISSUER || undefined,
      audience: process.env.NEON_AUTH_AUDIENCE || undefined,
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
