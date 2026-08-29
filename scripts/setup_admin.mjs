import pg from 'pg';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const connectionString = process.env.CRDB_CONNECTION_STRING;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!connectionString) throw new Error('CRDB_CONNECTION_STRING is required');
if (!adminPassword || adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');

const derive = promisify(scrypt);
async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await derive(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
    return ['scrypt', 'v1', 16_384, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$');
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
    try {
        await client.connect();
        await client.query('ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS password_hash STRING');

        const adminId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
        const email = 'admin@gmail.com';
        const passwordHash = await hashPassword(adminPassword);

        await client.query('DELETE FROM public.auth_users WHERE email = $1', [email]);
        await client.query(
            'INSERT INTO public.auth_users (id, email, password_hash) VALUES ($1, $2, $3)',
            [adminId, email, passwordHash],
        );
        await client.query('DELETE FROM public.user_roles WHERE user_id = $1', [adminId]);
        await client.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')", [adminId]);
        console.log('Admin user configured successfully');
    } catch (err) {
        console.error('Error configuring admin:', err instanceof Error ? err.message : 'unknown error');
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

run();
