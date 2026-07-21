import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ErrorLogPayload {
  errorType: string;
  errorMessage: string;
  errorStack?: string;
  context?: Record<string, unknown>;
  url?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create admin client for inserting logs
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user info from authorization header if present
    let userId: string | null = null;
    const authHeader = req.headers.get('authorization');
    
    if (authHeader) {
      const supabaseAnon = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY')!
      );
      
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabaseAnon.auth.getUser(token);
      userId = user?.id ?? null;
    }

    const payload: ErrorLogPayload = await req.json();
    
    // Validate required fields
    if (!payload.errorType || !payload.errorMessage) {
      console.error('[log-error] Missing required fields:', { 
        hasErrorType: !!payload.errorType, 
        hasErrorMessage: !!payload.errorMessage 
      });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: errorType and errorMessage' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Scrub sensitive keys from arbitrary context objects before persisting
    const SENSITIVE_KEY_PATTERN = /(password|passwd|token|secret|api[_-]?key|authorization|auth|bearer|cookie|session|jwt|private[_-]?key)/i;
    const scrubSensitive = (value: unknown, depth = 0): unknown => {
      if (depth > 5 || value === null || value === undefined) return value;
      if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubSensitive(v, depth + 1));
      if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : scrubSensitive(v, depth + 1);
        }
        return out;
      }
      if (typeof value === 'string') return value.slice(0, 500);
      return value;
    };

    // Cap the serialized context to 2000 chars to prevent unbounded JSONB growth
    let safeContext: unknown = null;
    if (payload.context) {
      try {
        const scrubbed = scrubSensitive(payload.context);
        const serialized = JSON.stringify(scrubbed);
        safeContext = serialized.length > 2000 ? JSON.parse(serialized.slice(0, 2000) + (serialized.endsWith('"') ? '' : '"') + '}') ?? { truncated: true } : scrubbed;
      } catch {
        safeContext = { error: 'context_unserializable' };
      }
      if (safeContext === null) safeContext = { truncated: true };
    }

    // Sanitize and limit field lengths (reduced stack size to avoid leaking internal paths)
    const sanitizedData = {
      user_id: userId,
      error_type: String(payload.errorType).slice(0, 100),
      error_message: String(payload.errorMessage).slice(0, 500),
      error_stack: payload.errorStack ? String(payload.errorStack).slice(0, 500) : null,
      context: safeContext,
      url: payload.url ? String(payload.url).slice(0, 500) : null,
      user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    };

    console.log('[log-error] Logging error:', {
      errorType: sanitizedData.error_type,
      userId: sanitizedData.user_id,
      url: sanitizedData.url,
    });

    // Insert error log using service role (bypasses RLS)
    const { error: insertError } = await supabaseAdmin
      .from('error_logs')
      .insert(sanitizedData);

    if (insertError) {
      console.error('[log-error] Failed to insert error log:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to log error' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('[log-error] Error logged successfully');
    
    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('[log-error] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});