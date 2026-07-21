
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PS_BASE = "https://api.paystack.co";

class PaystackBusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystackBusinessError";
  }
}

async function psRequest(path: string, method = "GET", body?: unknown) {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not configured");

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${PS_BASE}${path}`, opts);
  const data = await res.json();

  if (data?.status === false) {
    const msg = typeof data?.message === "string" ? data.message : "Paystack error";
    throw new PaystackBusinessError(msg);
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
        const data = await psRequest("/balance");
        // Paystack returns balance in kobo, convert to Naira
        const ngnBalance = data.data?.find((b: { currency: string }) => b.currency === "NGN");
        const availableKobo = ngnBalance?.balance ?? 0;
        return new Response(
          JSON.stringify({ balance: { available_balance: availableKobo / 100 } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "list_banks": {
        const data = await psRequest("/bank?country=nigeria&perPage=100");
        return new Response(JSON.stringify({ banks: data.data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "resolve_account": {
        const { account_number, account_bank } = params;
        const data = await psRequest(
          `/bank/resolve?account_number=${account_number}&bank_code=${account_bank}`
        );
        return new Response(JSON.stringify({ account: data.data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "initiate_transfer": {
        const { amount, account_bank, account_number, beneficiary_name, narration, reference } = params;

        // Step 1: Create transfer recipient
        const recipientRes = await psRequest("/transferrecipient", "POST", {
          type: "nuban",
          name: beneficiary_name || "Staff",
          account_number,
          bank_code: account_bank,
          currency: "NGN",
        });
        const recipientCode = recipientRes.data?.recipient_code;

        // Step 2: Initiate transfer (amount in kobo)
        const transferRes = await psRequest("/transfer", "POST", {
          source: "balance",
          amount: Math.round(amount * 100), // Naira to kobo
          recipient: recipientCode,
          reason: narration || "Salary payment",
          reference,
        });

        return new Response(
          JSON.stringify({
            transfer: {
              id: transferRes.data?.id,
              transfer_code: transferRes.data?.transfer_code,
              recipient_code: recipientCode,
              reference: transferRes.data?.reference,
              status: transferRes.data?.status,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "verify_transfer": {
        const { transfer_id } = params;
        const data = await psRequest(`/transfer/${transfer_id}`);
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
    if (error instanceof PaystackBusinessError) {
      return new Response(
        JSON.stringify({ error: error.message, type: "paystack_business_error" }),
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
