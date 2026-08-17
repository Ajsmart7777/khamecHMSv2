import { Handler } from '@netlify/functions';
import { getCrdbClient } from './_shared/crdb.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const { email, password } = JSON.parse(event.body || '{}');
  console.log('Login attempt for:', email);
  const client = getCrdbClient();

  try {
    console.log('Connecting to CockroachDB...');
    await client.connect();
    console.log('Connected. Querying user...');
    const res = await client.query(
      `SELECT u.id, u.email, u.password,
              (SELECT ur.role::text FROM public.user_roles ur
               WHERE ur.user_id = u.id ORDER BY ur.role::text LIMIT 1) AS role
       FROM public.auth_users u
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    );
    console.log('Query result rows:', res.rows.length);

    const user = res.rows[0];
    if (user && user.password === password) {
      // In a real app, we would generate a JWT here
      await client.end();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          data: { 
            user: { id: user.id, email: user.email, role: user.role },
            session: { access_token: 'mock-token-' + user.id } 
          }, 
          error: null 
        })
      };
    }

    await client.end();
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: 'Invalid credentials' })
    };
  } catch (err: any) {
    console.error('Login error:', err);
    try { await client.end(); } catch {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: err.message })
    };
  }
};
