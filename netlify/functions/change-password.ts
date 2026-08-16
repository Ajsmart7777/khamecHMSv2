import { authClientForRequest, database, json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

type Payload = { currentPassword?: string; newPassword?: string };

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const caller = await verifyUser(request);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  try {
    const { currentPassword, newPassword } = await readJson<Payload>(request);
    if (!currentPassword || !newPassword || newPassword.length < 8) return json({ error: 'Invalid payload' }, 400);

    const sql = database();
    const userRows = await sql`select email from neon_auth."user" where id = ${caller.id}::uuid limit 1` as Array<{ email: string }>;
    const email = userRows[0]?.email;
    if (!email) return json({ error: 'Unauthorized' }, 401);

    const auth = authClientForRequest(request) as unknown as {
      changePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<{ error?: { message?: string } | null }>;
    };
    const result = await auth.changePassword({ currentPassword, newPassword });
    if (result.error) {
      await sql`insert into public.audit_logs (user_id, action, resource_type, resource_id, status, error_message)
        values (${caller.id}::uuid, 'password_changed', 'auth', ${caller.id}::uuid, 'failure', ${String(result.error.message || 'Password update failed')})`;
      return json({ error: String(result.error.message || 'Password update failed') }, 400);
    }

    await sql`insert into public.audit_logs (user_id, action, resource_type, resource_id, status, details)
      values (${caller.id}::uuid, 'password_changed', 'auth', ${caller.id}::uuid, 'success', ${JSON.stringify({ email })}::jsonb)`;
    return json({ success: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Server error' }, 500);
  }
};
