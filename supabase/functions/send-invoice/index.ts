import { DEFAULT_EMAIL_TEMPLATE, renderEmailTemplate, companyEmailValues } from "../_shared/email-template.ts";
// Invoice delivery shares the inbox outbox, receipts, privacy and send gates.
import { service, json, handleOptions } from "../_shared/mod.ts";
import {
  checked,
  MessagingError,
  office,
  readBody,
  send,
  writable,
} from "../_shared/messaging.ts";
Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json(405, { error: "POST required." });
  try {
    const claims = await office(req);
    writable();
    const body = await readBody(req);
    if (!["email", "sms"].includes(body.mode))
      throw new MessagingError("Invalid delivery channel.");
    const invoice = checked(
      await service
        .from("invoices")
        .select("id,doc_number,customer_id,txn_date,due_date,total,balance,status")
        .eq("id", body.invoice_id)
        .single(),
    );
    const rows = checked(
      await service.from("settings").select("company_profile,email_template").limit(1),
    );
    const company = rows?.[0]?.company_profile || {},
      name = company.company_name || "Miller Sawdust";
    const label = `${name}: Invoice #${invoice.doc_number || ""}`.trim();
    let email = { subject: label, body: label };
    if (body.mode === "email") {
      const customer = invoice.customer_id ? checked(await service.from("customers").select("company_name,name").eq("id", invoice.customer_id).maybeSingle()) : null;
      const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
      const date = (value: string) => value ? new Date(value + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "";
      email = renderEmailTemplate(rows?.[0]?.email_template || DEFAULT_EMAIL_TEMPLATE, {
        ...companyEmailValues(company),
        customer_name: customer?.company_name || customer?.name || "Customer",
        invoice_number: invoice.doc_number || "", invoice_date: date(invoice.txn_date), due_date: date(invoice.due_date),
        invoice_total: money(invoice.total), invoice_balance: money(invoice.status === "paid" ? 0 : (invoice.balance ?? invoice.total)),
      });
    }
    return json(
      200,
      await send(
        {
          request_id: body.request_id,
          channel: body.mode,
          to: body.to,
          customer_id: invoice.customer_id,
          invoice_id: invoice.id,
          subject: email.subject,
          body: body.mode === "sms" ? label : email.body,
          reply_to: company.email,
          attachments: [
            {
              name: `Invoice ${invoice.doc_number || invoice.id}.pdf`,
              type: "application/pdf",
              content: body.pdf_base64,
            },
          ],
        },
        claims,
      ),
    );
  } catch (e) {
    return json(e instanceof MessagingError ? e.status : 400, {
      error: (e as Error).message,
    });
  }
});
