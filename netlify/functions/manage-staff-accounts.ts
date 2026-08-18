import { getCrdbClient } from './_shared/crdb.js';
import { json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

const VALID_ROLES = ['admin', 'doctor1', 'doctor2', 'nurse', 'receptionist', 'pharmacist', 'store', 'lab_tech', 'billing', 'cashier', 'accountant', 'claims_manager'];

type RequestBody = {
  action?: 'create' | 'reset_password' | 'delete' | 'list' | 'change_role';
  email?: string;
  password?: string;
  role?: string;
  userId?: string;
};

function bad(message: string, status = 400) {
  return json({ error: message }, status);
}

function cleanEmail(email: string) {
  return email.trim().toLowerCase();
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const caller = await verifyUser(request);
  if (!caller) return json({ error: 'Invalid authentication' }, 401);

  const client = getCrdbClient();
  try {
    await client.connect();
    const roleResult = await client.query(
      'SELECT role::text AS role FROM public.user_roles WHERE user_id = $1::uuid ORDER BY role::text LIMIT 1',
      [caller.id],
    );
    if (roleResult.rows[0]?.role !== 'admin') return json({ error: 'Admin access required' }, 403);

    const body = await readJson<RequestBody>(request);

    switch (body.action) {
      case 'create': {
        if (!body.email || !body.password || !body.role) return bad('Email, password, and role are required');
        const email = cleanEmail(body.email);
        if (!/^\S+@\S+\.\S+$/.test(email)) return bad('A valid email is required');
        if (!VALID_ROLES.includes(body.role)) return bad(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
        if (body.password.length < 6) return bad('Password must be at least 6 characters');

        const idResult = await client.query(
          'INSERT INTO public.auth_users (id, email, password) VALUES (gen_random_uuid(), $1, $2) RETURNING id',
          [email, body.password],
        );
        const userId = String(idResult.rows[0].id);
        try {
          await client.query('INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, $2)', [userId, body.role]);
        } catch (error) {
          await client.query('DELETE FROM public.auth_users WHERE id = $1::uuid', [userId]);
          throw error;
        }

        return json({ success: true, message: `User ${email} created with role ${body.role}`, userId });
      }

      case 'reset_password': {
        if (!body.userId || !body.password) return bad('userId and password are required');
        if (body.password.length < 6) return bad('Password must be at least 6 characters');
        const result = await client.query(
          'UPDATE public.auth_users SET password = $1, updated_at = clock_timestamp() WHERE id = $2::uuid RETURNING id',
          [body.password, body.userId],
        );
        if (!result.rowCount) return bad('User not found', 404);
        return json({ success: true, message: 'Password reset successfully' });
      }

      case 'delete': {
        if (!body.userId) return bad('userId is required');
        if (body.userId === caller.id) return bad('Cannot delete your own account');
        await client.query('DELETE FROM public.user_roles WHERE user_id = $1::uuid', [body.userId]);
        const result = await client.query('DELETE FROM public.auth_users WHERE id = $1::uuid RETURNING id', [body.userId]);
        if (!result.rowCount) return bad('User not found', 404);
        return json({ success: true, message: 'User deleted successfully' });
      }

      case 'change_role': {
        if (!body.userId || !body.role) return bad('userId and role are required');
        if (!VALID_ROLES.includes(body.role)) return bad(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
        const userResult = await client.query('SELECT id FROM public.auth_users WHERE id = $1::uuid LIMIT 1', [body.userId]);
        if (!userResult.rowCount) return bad('User not found', 404);
        await client.query('DELETE FROM public.user_roles WHERE user_id = $1::uuid', [body.userId]);
        await client.query('INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, $2)', [body.userId, body.role]);
        return json({ success: true, message: `Role updated to ${body.role}` });
      }

      case 'list': {
        const result = await client.query(`
          SELECT u.id, u.email, u.created_at, u.updated_at,
                 (SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = u.id ORDER BY ur.role::text LIMIT 1) AS role
          FROM public.auth_users u
          ORDER BY u.created_at DESC
          LIMIT 1000
        `);
        return json({
          success: true,
          users: result.rows.map((user) => ({
            id: String(user.id),
            email: user.email,
            role: user.role || null,
            created_at: user.created_at || null,
            last_sign_in_at: null,
          })),
        });
      }

      default:
        return bad('Invalid action');
    }
  } catch (error: any) {
    const message = error?.code === '23505' || error?.code === 'unique_violation'
      ? 'A user with this email already exists'
      : error?.message || String(error);
    return json({ error: message }, 500);
  } finally {
    await client.end().catch(() => {});
  }
};
