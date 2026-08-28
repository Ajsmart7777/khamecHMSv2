import pg from 'pg';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const { Client } = pg;
const derive = promisify(scrypt);
const connectionString = process.env.CRDB_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) throw new Error('CRDB_CONNECTION_STRING or DATABASE_URL is required');
if (process.argv[2] !== '--apply') {
  throw new Error('Refusing to mutate auth data. Re-run with --apply after reviewing the migration.');
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
const hash = async (password) => {
  const salt = randomBytes(16);
  const key = await derive(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return ['scrypt', 'v1', 16_384, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$');
};

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS password_hash STRING');
  const users = await client.query('SELECT id, password, password_hash FROM public.auth_users FOR UPDATE');
  let migrated = 0;
  for (const user of users.rows) {
    if (typeof user.password_hash === 'string' && user.password_hash.startsWith('scrypt$v1$')) continue;
    if (typeof user.password !== 'string' || user.password.length === 0) {
      throw new Error(`User ${user.id} has no plaintext password available for migration`);
    }
    const passwordHash = await hash(user.password);
    await client.query('UPDATE public.auth_users SET password_hash = $1, updated_at = clock_timestamp() WHERE id = $2::uuid', [passwordHash, user.id]);
    migrated += 1;
  }
  const incomplete = await client.query("SELECT count(*)::int AS count FROM public.auth_users WHERE password_hash IS NULL OR password_hash NOT LIKE 'scrypt$v1$%'");
  if (Number(incomplete.rows[0]?.count ?? 0) !== 0) throw new Error('Migration verification failed: incomplete password hashes remain');
  await client.query('ALTER TABLE public.auth_users DROP COLUMN IF EXISTS password');
  await client.query('COMMIT');
  console.log(JSON.stringify({ migrated, plaintext_column_removed: true }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
