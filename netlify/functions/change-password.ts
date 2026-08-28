import { getCrdbClient } from './_shared/crdb.js';
import { hashPassword, verifyPassword } from './_shared/password.js';
import { json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

type Payload = { currentPassword?: string; newPassword?: string };

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const caller = await verifyUser(request);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  const client = getCrdbClient();
  try {
    const { currentPassword, newPassword } = await readJson<Payload>(request);
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return json({ error: 'New password must be at least 8 characters' }, 400);
    }

    await client.connect();
    const userResult = await client.query(
      'SELECT email, password_hash FROM public.auth_users WHERE id = $1::uuid LIMIT 1',
      [caller.id],
    );
    const user = userResult.rows[0];
    const currentPasswordMatches = user ? await verifyPassword(currentPassword, user.password_hash) : false;
    if (!user || !currentPasswordMatches) {
      await client.query(
        `INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, status, error_message)
         VALUES ($1::uuid, 'password_changed', 'auth', $1::uuid, 'failure', $2)`,
        [caller.id, 'Current password is incorrect'],
      );
      return json({ error: 'Current password is incorrect' }, 400);
    }

    const passwordHash = await hashPassword(newPassword);
    await client.query(
      `UPDATE public.auth_users
       SET password_hash = $1, updated_at = clock_timestamp()
       WHERE id = $2::uuid`,
      [passwordHash, caller.id],
    );
    await client.query(
      `INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, status, details)
       VALUES ($1::uuid, 'password_changed', 'auth', $1::uuid, 'success', $2::jsonb)`,
      [caller.id, JSON.stringify({ email: user.email })],
    );
    return json({ success: true });
  } catch (error) {
    return json({ error: error instanceof Error ? 'Password update failed' : 'Server error' }, 500);
  } finally {
    await client.end().catch(() => undefined);
  }
};
