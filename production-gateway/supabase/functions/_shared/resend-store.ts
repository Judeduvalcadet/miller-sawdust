import type { Receipt, ReceiptStore } from "./resend-router.ts";
function checked(result: { data: any; error: any }) {
  if (result.error) throw Error("Receipt inbox unavailable.");
  return result.data;
}
export function createReceiptStore(db: any): ReceiptStore {
  return {
    async save(receipt) {
      checked(
        await db.from("email_gateway_receipts").upsert(receipt, {
          onConflict: "event_id",
          ignoreDuplicates: true,
        }),
      );
      const row = checked(
        await db.from("email_gateway_receipts").select("*").eq(
          "event_id",
          receipt.event_id,
        ).single(),
      );
      for (
        const field of [
          "sender_domain",
          "email_id",
          "event_type",
          "occurred_at",
        ] as const
      ) {
        const equal = field === "occurred_at"
          ? Date.parse(row[field]) === Date.parse(receipt[field])
          : row[field] === receipt[field];
        if (!equal) throw Error("Receipt identity changed.");
      }
      return row as Receipt;
    },
    async pending(domains, perDomain) {
      return (await Promise.all(
        domains.map(async (domain) =>
          checked(
            await db.from("email_gateway_receipts")
              .select("*").eq("sender_domain", domain).is("delivered_at", null)
              .order("received_at").limit(perDomain),
          )
        ),
      )).flat();
    },
    async delivered(id) {
      checked(
        await db.from("email_gateway_receipts").update({
          delivered_at: new Date().toISOString(),
        }).eq("event_id", id),
      );
    },
  };
}
