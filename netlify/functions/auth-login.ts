import { Handler } from '@netlify/functions';
import { getCrdbClient } from './_shared/crdb.js';
import { createSessionToken } from './_shared/session.js';
import { verifyPassword } from './_shared/password.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const { email, password } = JSON.parse(event.body || '{}');
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const client = getCrdbClient();

  try {
    console.log('Connecting to CockroachDB...');
    await client.connect();
    console.log('Connected. Querying user...');
    const res = await client.query(
      `SELECT u.id, u.email, u.password_hash,
              (SELECT ur.role::text FROM public.user_roles ur
               WHERE ur.user_id = u.id ORDER BY ur.role::text LIMIT 1) AS role,
              s.status::text AS staff_status
       FROM public.auth_users u
       LEFT JOIN public.staff s ON s.auth_user_id = u.id
       WHERE lower(u.email) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    const user = res.rows[0];
    const passwordMatches = user ? await verifyPassword(password, user.password_hash) : false;
    if (user && passwordMatches && user.staff_status !== 'deleted') {
      await client.end();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          data: { 
            user: { id: user.id, email: user.email, role: user.role },
            session: { access_token: createSessionToken(String(user.id)), expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60 }
          }, 
          error: null 
        })
      };
    }

    await client.end();
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: 'Invalid email or password' })
    };
  } catch (err: any) {
    console.error('Login error:', err);
    try { await client.end(); } catch {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: 'Authentication service unavailable' })
    };
  }
};
