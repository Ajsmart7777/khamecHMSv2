import { authClientForRequest, database, json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

const VALID_ROLES = ['admin', 'doctor1', 'doctor2', 'nurse', 'anc', 'receptionist', 'pharmacist', 'store', 'lab_tech', 'billing', 'cashier', 'accountant', 'claims_manager'];

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

type AdminUser = { id: string; email?: string; createdAt?: string; created_at?: string; lastSignInAt?: string; last_sign_in_at?: string };
type AuthAdminClient = { admin: { createUser: (input: Record<string, unknown>) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>; removeUser: (input: { userId: string }) => Promise<{ error?: unknown }>; setUserPassword: (input: { userId: string; newPassword: string }) => Promise<{ error?: unknown }>; listUsers: (input: { query: { limit: number; offset: number } }) => Promise<{ data?: { users?: AdminUser[] }; error?: unknown }> } };

function authError(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const caller = await verifyUser(request);
    if (!caller) return json({ error: 'Invalid authentication' }, 401);

    const sql = database();
    const roleRows = await sql`select role from public.user_roles where user_id = ${caller.id} limit 1` as Array<{ role: string }>;
    if (roleRows[0]?.role !== 'admin') return json({ error: 'Admin access required' }, 403);

    const body = await readJson<RequestBody>(request);
    const auth = authClientForRequest(request) as unknown as AuthAdminClient;

    switch (body.action) {
      case 'create': {
        if (!body.email || !body.password || !body.role) return bad('Email, password, and role are required');
        if (!VALID_ROLES.includes(body.role)) return bad(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
        if (body.password.length < 6) return bad('Password must be at least 6 characters');

        const result = await auth.admin.createUser({
          email: body.email,
          password: body.password,
          name: body.email.split('@')[0],
          role: 'user',
        });
        if (result.error || !result.data?.user) return bad(authError(result.error || 'Failed to create user'));

        try {
          await sql`insert into public.user_roles (user_id, role) values (${result.data.user.id}::uuid, ${body.role})`;
        } catch (error) {
          await auth.admin.removeUser({ userId: result.data.user.id });
          return json({ error: `Failed to assign role: ${authError(error)}` }, 500);
        }

        return json({
          success: true,
          message: `User ${body.email} created with role ${body.role}`,
          userId: result.data.user.id,
        });
      }

      case 'reset_password': {
        if (!body.userId || !body.password) return bad('userId and password are required');
        if (body.password.length < 6) return bad('Password must be at least 6 characters');
        const result = await auth.admin.setUserPassword({ userId: body.userId, newPassword: body.password });
        if (result.error) return bad(authError(result.error));
        return json({ success: true, message: 'Password reset successfully' });
      }

      case 'delete': {
        if (!body.userId) return bad('userId is required');
        if (body.userId === caller.id) return bad('Cannot delete your own account');
        const result = await auth.admin.removeUser({ userId: body.userId });
        if (result.error) return bad(authError(result.error));
        await sql`delete from public.user_roles where user_id = ${body.userId}::uuid`;
        return json({ success: true, message: 'User deleted successfully' });
      }

      case 'change_role': {
        if (!body.userId || !body.role) return bad('userId and role are required');
        if (!VALID_ROLES.includes(body.role)) return bad(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
        await sql`delete from public.user_roles where user_id = ${body.userId}::uuid`;
        await sql`insert into public.user_roles (user_id, role) values (${body.userId}::uuid, ${body.role})`;
        return json({ success: true, message: `Role updated to ${body.role}` });
      }

      case 'list': {
        const result = await auth.admin.listUsers({ query: { limit: 1000, offset: 0 } });
        if (result.error) return json({ error: authError(result.error) }, 500);
        const roles = await sql`select user_id, role from public.user_roles` as Array<{ user_id: string; role: string }>;
        const users = (result.data?.users ?? []).map((user) => ({
          id: user.id,
          email: user.email,
          role: roles.find((role) => role.user_id === user.id)?.role || null,
          created_at: user.createdAt ?? user.created_at ?? null,
          last_sign_in_at: user.lastSignInAt ?? user.last_sign_in_at ?? null,
        }));
        return json({ success: true, users });
      }

      default:
        return bad('Invalid action');
    }
  } catch (error) {
    return json({ error: authError(error) }, 500);
  }
};
