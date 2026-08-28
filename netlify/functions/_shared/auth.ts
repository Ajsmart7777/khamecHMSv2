import { neon } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js';
import { createAuthClient } from '@neondatabase/neon-js/auth';
import { verifySessionToken } from './session.js';
import { getCrdbPool } from './crdb.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return neon(url);
}

export function bearerToken(request: Request) {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export async function verifyUser(request: Request): Promise<{ id: string; token: string; role: string } | null> {
  const token = bearerToken(request);
  if (!token) return null;

  // The CockroachDB clone uses its own signed session token because the
  // browser login endpoint is local to this deployment. Prefer the token
  // format when present, then fall back to Neon JWT verification for any
  // environment that still provides Neon Auth configuration.
  const localUserId = verifySessionToken(token);
  if (localUserId) {
    const client = await getCrdbPool().connect();
    try {
      const result = await client.query(
        `SELECT u.id,
                (SELECT ur.role::text FROM public.user_roles ur
                 WHERE ur.user_id = u.id ORDER BY ur.role::text LIMIT 1) AS role,
                s.status::text AS staff_status
         FROM public.auth_users u
         LEFT JOIN public.staff s ON s.auth_user_id = u.id
         WHERE u.id = $1::uuid
         LIMIT 1`,
        [localUserId],
      );
      const user = result.rows[0];
      if (!user || user.staff_status === 'deleted') return null;
      return { id: localUserId, token, role: user.role || 'anon' };
    } finally {
      client.release();
    }
  }

  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) return null;
  try {
    jwks ??= createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.NEON_AUTH_ISSUER || undefined,
      audience: process.env.NEON_AUTH_AUDIENCE || undefined,
    });
    if (typeof payload.sub !== 'string') return null;
    const client = await getCrdbPool().connect();
    try {
      const result = await client.query(
        `SELECT (SELECT ur.role::text FROM public.user_roles ur
                 WHERE ur.user_id = u.id ORDER BY ur.role::text LIMIT 1) AS role
         FROM public.auth_users u WHERE u.id = $1::uuid LIMIT 1`,
        [payload.sub],
      );
      const user = result.rows[0];
      return user ? { id: payload.sub, token, role: user.role || 'anon' } : null;
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

export function authClientForRequest(request: Request) {
  const authUrl = process.env.NEON_AUTH_URL;
  if (!authUrl) throw new Error('NEON_AUTH_URL is not configured');
  const token = bearerToken(request);
  const builder = BetterAuthVanillaAdapter();
  return createAuthClient(authUrl, {
    adapter: (url, fetchOptions) => builder(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions?.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }),
  });
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': process.env.FRONTEND_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': process.env.FRONTEND_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  return await request.json() as T;
}
