
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) {
      console.error("[paystack-webhook] PAYSTACK_SECRET_KEY not configured");
      return new Response("Server misconfigured", { status: 500 });
    }

    const signature = req.headers.get("x-paystack-signature");
    if (!signature) {
      console.warn("[paystack-webhook] Missing signature");
      return new Response("Unauthorized", { status: 401 });
    }

    const rawBody = await req.text();
    const valid = await verifySignature(rawBody, signature, secret);
    if (!valid) {
      console.warn("[paystack-webhook] Invalid signature");
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    console.log("[paystack-webhook] Received event:", payload.event);

    const event = payload?.event;
    const data = payload?.data;

    if (!event || !data) {
      return new Response("OK", { status: 200 });
    }

    // Only handle transfer events
    const transferEvents = ["transfer.success", "transfer.failed", "transfer.reversed"];
    if (!transferEvents.includes(event)) {
      console.log("[paystack-webhook] Ignoring event:", event);
      return new Response("OK", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const reference = data.reference;
    const transferCode = data.transfer_code;

    if (!reference && !transferCode) {
      console.warn("[paystack-webhook] No reference or transfer_code in payload");
      return new Response("OK", { status: 200 });
    }

    let paymentStatus: string;
    switch (event) {
      case "transfer.success":
        paymentStatus = "paid";
        break;
      case "transfer.failed":
        paymentStatus = "failed";
        break;
      case "transfer.reversed":
        paymentStatus = "reversed";
        break;
      default:
        paymentStatus = "pending";
    }

    console.log(`[paystack-webhook] Updating reference=${reference} to status=${paymentStatus}`);

    // Find matching payments
    let query = supabase.from("payroll_payments").select("id, payroll_entry_id");
    if (reference && transferCode) {
      query = query.or(`provider_reference.eq.${reference},provider_transfer_code.eq.${transferCode}`);
    } else if (reference) {
      query = query.eq("provider_reference", reference);
    } else {
      query = query.eq("provider_transfer_code", transferCode);
    }

    const { data: payments, error: fetchErr } = await query.limit(10);

    if (fetchErr) {
      console.error("[paystack-webhook] Error fetching payments:", fetchErr);
      return new Response("OK", { status: 200 });
    }

    if (!payments || payments.length === 0) {
      console.warn("[paystack-webhook] No matching payments for reference:", reference);
      return new Response("OK", { status: 200 });
    }

    for (const payment of payments) {
      const updateData: Record<string, unknown> = {
        status: paymentStatus,
      };
      if (transferCode) {
        updateData.provider_transfer_code = transferCode;
      }
      if (paymentStatus === "paid") {
        updateData.paid_at = new Date().toISOString();
      }

      const { error: updateErr } = await supabase
        .from("payroll_payments")
        .update(updateData)
        .eq("id", payment.id);

      if (updateErr) {
        console.error("[paystack-webhook] Error updating payment:", updateErr);
        continue;
      }

      const { error: entryErr } = await supabase
        .from("payroll_entries")
        .update({ status: paymentStatus })
        .eq("id", payment.payroll_entry_id);

      if (entryErr) {
        console.error("[paystack-webhook] Error updating entry:", entryErr);
      }
    }

    console.log(`[paystack-webhook] Updated ${payments.length} payment(s)`);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[paystack-webhook] Unexpected error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
