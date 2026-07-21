// Auto-runs on the 1st of each month (via pg_cron) to generate consolidated
// corporate & retainer statements for the previous month.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(url, key);

    let year: number;
    let month: number;
    try {
      const body = await req.json();
      if (body?.year && body?.month) {
        year = Number(body.year);
        month = Number(body.month);
      } else { throw new Error('use previous month'); }
    } catch {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      year = prev.getFullYear();
      month = prev.getMonth() + 1;
    }

    const { data, error } = await supabase.rpc('generate_all_sponsor_statements', {
      _year: year, _month: month,
    });

    if (error) {
      console.error('generate_all_sponsor_statements failed', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, year, month, generated: data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
