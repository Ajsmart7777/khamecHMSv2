import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_SECONDS = 24 * 60 * 60;

function sessionSecret() {
  return process.env.CRDB_SESSION_SECRET || process.env.NEON_AUTH_SECRET || process.env.DATABASE_URL || 'khamec-crdb-session-secret';
}

function encode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(payload: string) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createSessionToken(userId: string) {
  const payload = encode(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
  return `hms.${payload}.${signature(payload)}`;
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'hms') return null;
  const [scheme, payload, received] = parts;
  void scheme;
  const expected = signature(payload);
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  if (expectedBytes.length !== receivedBytes.length || !timingSafeEqual(expectedBytes, receivedBytes)) return null;

  try {
    const parsed = JSON.parse(decode(payload)) as { sub?: unknown; exp?: unknown };
    if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed.sub;
  } catch {
    return null;
  }
}
