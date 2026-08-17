import { Handler } from '@netlify/functions';
import { getCrdbClient } from './_shared/crdb.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const { email, password } = JSON.parse(event.body || '{}');
  const client = getCrdbClient();

  try {
    await client.connect();
    const res = await client.query(
      'SELECT id, email, password FROM public.auth_users WHERE email = $1',
      [email]
    );

    const user = res.rows[0];
    if (user && user.password === password) {
      // In a real app, we would generate a JWT here
      await client.end();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          data: { 
            user: { id: user.id, email: user.email }, 
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
    try { await client.end(); } catch {}
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null, error: err.message })
    };
  }
};
