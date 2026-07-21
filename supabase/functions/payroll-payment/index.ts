
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FLW_BASE = "https://api.flutterwave.com";

class FlutterwaveBusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlutterwaveBusinessError";
  }
}

async function flwRequest(path: string, method = "GET", body?: unknown) {
  const key = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!key) throw new Error("FLUTTERWAVE_SECRET_KEY not configured");

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${FLW_BASE}${path}`, opts);
  const data = await res.json();

  if (data?.status === "error") {
    const providerMessage = typeof data?.message === "string" ? data.message : "Flutterwave error";
    throw new FlutterwaveBusinessError(providerMessage);
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!roles.includes("billing") && !roles.includes("admin")) {
      return new Response(JSON.stringify({ error: "Forbidden: billing or admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case "get_balance": {
        const data = await flwRequest("/v3/balances/NGN");
        return new Response(JSON.stringify({ balance: data.data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "list_banks": {
        const data = await flwRequest("/v3/banks/NG");
        return new Response(JSON.stringify({ banks: data.data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "resolve_account": {
        const { account_number, account_bank } = params;
        const data = await flwRequest("/v3/accounts/resolve", "POST", {
          account_number,
          account_bank,
        });
        return new Response(JSON.stringify({ account: data.data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "initiate_transfer": {
        const { amount, account_bank, account_number, beneficiary_name, narration, reference } = params;
        const data = await flwRequest("/v3/transfers", "POST", {
          account_bank,
          account_number,
          amount, // Flutterwave uses Naira directly, not kobo
          narration: narration || "Salary payment",
          currency: "NGN",
          reference,
          beneficiary_name,
        });
        return new Response(
          JSON.stringify({ transfer: data.data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "bulk_transfer": {
        const { transfers } = params;
        const data = await flwRequest("/v3/bulk-transfers", "POST", {
          title: "Payroll Bulk Transfer",
          bulk_data: transfers.map((t: { amount: number; account_bank: string; account_number: string; beneficiary_name?: string; narration?: string; reference?: string }) => ({
            bank_code: t.account_bank,
            account_number: t.account_number,
            amount: t.amount,
            narration: t.narration || "Salary payment",
            currency: "NGN",
            reference: t.reference,
            beneficiary_name: t.beneficiary_name,
          })),
        });
        return new Response(
          JSON.stringify({ result: data.data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "verify_transfer": {
        const { transfer_id } = params;
        const data = await flwRequest(`/v3/transfers/${transfer_id}`);
        return new Response(
          JSON.stringify({ transfer: data.data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    if (error instanceof FlutterwaveBusinessError) {
      return new Response(
        JSON.stringify({ error: error.message, type: "flutterwave_business_error" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
