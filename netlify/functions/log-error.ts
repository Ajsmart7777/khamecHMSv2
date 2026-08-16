import { database, json, optionsResponse, readJson, verifyUser } from './_shared/auth.js';

type ErrorLogPayload = {
  errorType?: string;
  errorMessage?: string;
  errorStack?: string;
  context?: Record<string, unknown>;
  url?: string;
};

const SENSITIVE_KEY_PATTERN = /(password|passwd|token|secret|api[_-]?key|authorization|auth|bearer|cookie|session|jwt|private[_-]?key)/i;

function scrubSensitive(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubSensitive(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : scrubSensitive(item, depth + 1);
    }
    return output;
  }
  return typeof value === 'string' ? value.slice(0, 500) : value;
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const payload = await readJson<ErrorLogPayload>(request);
    if (!payload.errorType || !payload.errorMessage) return json({ error: 'Missing required fields: errorType and errorMessage' }, 400);

    const caller = await verifyUser(request);
    const safeContext = payload.context ? scrubSensitive(payload.context) : null;
    const sql = database();
    await sql`insert into public.error_logs (user_id, error_type, error_message, error_stack, context, url, user_agent)
      values (
        ${caller?.id ?? null}::uuid,
        ${String(payload.errorType).slice(0, 100)},
        ${String(payload.errorMessage).slice(0, 500)},
        ${payload.errorStack ? String(payload.errorStack).slice(0, 500) : null},
        ${safeContext ? JSON.stringify(safeContext) : null}::jsonb,
        ${payload.url ? String(payload.url).slice(0, 500) : null},
        ${request.headers.get('user-agent')?.slice(0, 500) ?? null}
      )`;
    return json({ success: true });
  } catch (error) {
    console.error('[log-error]', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
