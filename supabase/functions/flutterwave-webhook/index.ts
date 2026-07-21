
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, verif-hash",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook signature
    const secretHash = Deno.env.get("FLUTTERWAVE_WEBHOOK_HASH");
    if (!secretHash) {
      console.error("[flutterwave-webhook] FLUTTERWAVE_WEBHOOK_HASH not configured");
      return new Response("Server misconfigured", { status: 500 });
    }

    const signature = req.headers.get("verif-hash");
    if (signature !== secretHash) {
      console.warn("[flutterwave-webhook] Invalid signature");
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = await req.json();
    console.log("[flutterwave-webhook] Received event:", JSON.stringify(payload));

    const event = payload?.event;
    const data = payload?.data;

    if (!event || !data) {
      return new Response("OK", { status: 200 });
    }

    // Only handle transfer events
    if (event !== "transfer.completed") {
      console.log("[flutterwave-webhook] Ignoring event:", event);
      return new Response("OK", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const transferStatus = data.status; // "SUCCESSFUL", "FAILED", "REVERSED"
    const reference = data.reference;
    const transferId = String(data.id);

    if (!reference) {
      console.warn("[flutterwave-webhook] No reference in payload");
      return new Response("OK", { status: 200 });
    }

    // Map Flutterwave status to our status
    let paymentStatus: string;
    switch (transferStatus) {
      case "SUCCESSFUL":
        paymentStatus = "paid";
        break;
      case "FAILED":
        paymentStatus = "failed";
        break;
      case "REVERSED":
        paymentStatus = "reversed";
        break;
      default:
        paymentStatus = "pending";
    }

    console.log(`[flutterwave-webhook] Updating reference=${reference} to status=${paymentStatus}`);

    // Update payroll_payments by provider_reference or provider_transfer_code
    const { data: payments, error: fetchErr } = await supabase
      .from("payroll_payments")
      .select("id, payroll_entry_id")
      .or(`provider_reference.eq.${reference},provider_transfer_code.eq.${reference}`)
      .limit(10);

    if (fetchErr) {
      console.error("[flutterwave-webhook] Error fetching payments:", fetchErr);
      return new Response("OK", { status: 200 });
    }

    if (!payments || payments.length === 0) {
      console.warn("[flutterwave-webhook] No matching payments for reference:", reference);
      return new Response("OK", { status: 200 });
    }

    for (const payment of payments) {
      // Update payment status
      const updateData: Record<string, unknown> = {
        status: paymentStatus,
        provider_transfer_code: transferId,
      };
      if (paymentStatus === "paid") {
        updateData.paid_at = new Date().toISOString();
      }

      const { error: updateErr } = await supabase
        .from("payroll_payments")
        .update(updateData)
        .eq("id", payment.id);

      if (updateErr) {
        console.error("[flutterwave-webhook] Error updating payment:", updateErr);
        continue;
      }

      // Update corresponding payroll_entry status
      const { error: entryErr } = await supabase
        .from("payroll_entries")
        .update({ status: paymentStatus })
        .eq("id", payment.payroll_entry_id);

      if (entryErr) {
        console.error("[flutterwave-webhook] Error updating entry:", entryErr);
      }
    }

    console.log(`[flutterwave-webhook] Updated ${payments.length} payment(s)`);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[flutterwave-webhook] Unexpected error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
