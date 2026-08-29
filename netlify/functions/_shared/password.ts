import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
function deriveKey(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}
const ALGORITHM = 'scrypt';
const VERSION = 'v1';
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 32 * 1024 * 1024;

function asBuffer(value: string | Buffer) {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY,
  }) as Buffer;

  return [
    ALGORITHM,
    VERSION,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string | null | undefined): Promise<boolean> {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;

  const parts = encodedHash.split('$');
  if (parts.length !== 7 || parts[0] !== ALGORITHM || parts[1] !== VERSION) return false;

  const cost = Number(parts[2]);
  const blockSize = Number(parts[3]);
  const parallelization = Number(parts[4]);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) return false;
  if (cost < 16_384 || blockSize < 1 || parallelization < 1) return false;

  try {
    const salt = Buffer.from(parts[5], 'base64url');
    const expected = Buffer.from(parts[6], 'base64url');
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false;

    const actual = await deriveKey(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: Math.max(MAX_MEMORY, 128 * cost * blockSize + 1024),
    }) as Buffer;

    return actual.length === expected.length && timingSafeEqual(asBuffer(actual), asBuffer(expected));
  } catch {
    return false;
  }
}
