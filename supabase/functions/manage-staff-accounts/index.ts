import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CreateUserRequest {
  action: 'create' | 'reset_password' | 'delete' | 'list' | 'change_role';
  email?: string;
  password?: string;
  role?: string;
  userId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Verify the calling user is an admin
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error('Auth validation failed:', claimsError?.message);
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Check admin role
    const { data: roleData } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (roleData?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body: CreateUserRequest = await req.json();

    switch (body.action) {
      case 'create': {
        if (!body.email || !body.password || !body.role) {
          return new Response(JSON.stringify({ error: 'Email, password, and role are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Validate role
        const validRoles = ['admin', 'doctor', 'doctor1', 'doctor2', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'billing', 'store', 'accountant'];
        if (!validRoles.includes(body.role)) {
          return new Response(JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Validate password length
        if (body.password.length < 6) {
          return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: body.email,
          password: body.password,
          email_confirm: true,
        });

        if (createError) {
          return new Response(JSON.stringify({ error: createError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (newUser?.user) {
          const { error: roleError } = await supabaseAdmin.from('user_roles').insert({
            user_id: newUser.user.id,
            role: body.role,
          });

          if (roleError) {
            // Cleanup: delete the user if role assignment fails
            await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
            return new Response(JSON.stringify({ error: 'Failed to assign role: ' + roleError.message }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        return new Response(JSON.stringify({
          success: true,
          message: `User ${body.email} created with role ${body.role}`,
          userId: newUser?.user?.id,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'reset_password': {
        if (!body.userId || !body.password) {
          return new Response(JSON.stringify({ error: 'userId and password are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (body.password.length < 6) {
          return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          body.userId,
          { password: body.password }
        );

        if (updateError) {
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'Password reset successfully',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete': {
        if (!body.userId) {
          return new Response(JSON.stringify({ error: 'userId is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Prevent self-deletion
        if (body.userId === userId) {
          return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(body.userId);
        if (deleteError) {
          return new Response(JSON.stringify({ error: deleteError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'User deleted successfully',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'change_role': {
        if (!body.userId || !body.role) {
          return new Response(JSON.stringify({ error: 'userId and role are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const validRolesForChange = ['admin', 'doctor', 'doctor1', 'doctor2', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'billing', 'store', 'accountant'];
        if (!validRolesForChange.includes(body.role)) {
          return new Response(JSON.stringify({ error: `Invalid role. Must be one of: ${validRolesForChange.join(', ')}` }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Delete existing role then insert new one
        await supabaseAdmin.from('user_roles').delete().eq('user_id', body.userId);
        const { error: insertError } = await supabaseAdmin.from('user_roles').insert({
          user_id: body.userId,
          role: body.role,
        });

        if (insertError) {
          return new Response(JSON.stringify({ error: 'Failed to update role: ' + insertError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: `Role updated to ${body.role}`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'list': {
        const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        if (listError) {
          return new Response(JSON.stringify({ error: listError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get all roles
        const { data: allRoles } = await supabaseAdmin.from('user_roles').select('user_id, role');

        const users = (listData?.users || []).map(u => {
          const userRole = allRoles?.find(r => r.user_id === u.id);
          return {
            id: u.id,
            email: u.email,
            role: userRole?.role || null,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
          };
        });

        return new Response(JSON.stringify({ success: true, users }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
