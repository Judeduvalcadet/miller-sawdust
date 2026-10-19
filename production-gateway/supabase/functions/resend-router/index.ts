import { createClient } from "npm:@supabase/supabase-js@2.49.0";
import { createResendRouter } from "../_shared/resend-router.ts";
import { createReceiptStore } from "../_shared/resend-store.ts";
const url = Deno.env.get("SUPABASE_URL") || "";
if (
  Deno.env.get("APP_ENV") !== "quickbooks_gateway_production" ||
  new URL(url).hostname !== "hvryrivqjqsxfcypvqie.supabase.co"
) throw Error("Wrong gateway environment.");
const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const store = createReceiptStore(db);
Deno.serve(
  createResendRouter({
    secret: Deno.env.get("RESEND_GATEWAY_WEBHOOK_SECRET") || "",
    retryKey: Deno.env.get("RESEND_GATEWAY_RETRY_KEY") || "",
    routes: JSON.parse(Deno.env.get("RESEND_GATEWAY_ROUTES") || "{}"),
    store,
  }),
);
