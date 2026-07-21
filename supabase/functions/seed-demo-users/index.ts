import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Gate: only allow when SEED_ALLOWED is explicitly 'true'
    if (Deno.env.get('SEED_ALLOWED') !== 'true') {
      return new Response(JSON.stringify({ error: 'Seeding is disabled in this environment' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Bootstrap: if no admin exists yet, allow unauthenticated seeding of the first admin.
    const { data: anyAdmin } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    const authHeader = req.headers.get('authorization');

    if (anyAdmin) {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const token = authHeader.replace('Bearer ', '');
      const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(token);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const callerId = claimsData.claims.sub;
      const { data: callerRole } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', callerId)
        .eq('role', 'admin')
        .single();

      if (!callerRole) {
        return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Read credentials from secrets - never hardcoded
    const adminEmail = Deno.env.get('SEED_ADMIN_EMAIL');
    const adminPassword = Deno.env.get('SEED_ADMIN_PASSWORD');

    if (!adminEmail || !adminPassword) {
      return new Response(JSON.stringify({ error: 'Admin credentials not configured in secrets' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (adminPassword.length < 8) {
      return new Response(JSON.stringify({ error: 'Admin password must be at least 8 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminRole = 'admin';

    // Check if admin user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAdmin = existingUsers?.users?.find(u =>
      u.email?.toLowerCase() === adminEmail.toLowerCase()
    );

    if (existingAdmin) {
      // Ensure role is assigned
      const { data: existingRole } = await supabaseAdmin
        .from('user_roles')
        .select('*')
        .eq('user_id', existingAdmin.id)
        .eq('role', adminRole)
        .single();

      if (!existingRole) {
        await supabaseAdmin.from('user_roles').insert({
          user_id: existingAdmin.id,
          role: adminRole,
        });
      }

      // Reset password
      await supabaseAdmin.auth.admin.updateUserById(existingAdmin.id, {
        password: adminPassword,
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Admin user already exists. Password has been reset.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create admin user
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (createError) {
      return new Response(JSON.stringify({ success: false, error: createError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (newUser?.user) {
      await supabaseAdmin.from('user_roles').insert({
        user_id: newUser.user.id,
        role: adminRole,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Admin user created successfully.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
