import { supabase } from "@/api/supabaseClient";
import { assertV2Writable } from "../guard";

export async function messaging(action, body = {}) {
  if (!["status", "attachment", "email_config", "email_template"].includes(action)) assertV2Writable();
  const { data, error } = await supabase.functions.invoke("messaging", {
    body: { ...body, action },
  });
  if (error) {
    let detail;
    try {
      detail = (await error.context.json()).error;
    } catch {
      /* gateway/network error */
    }
    throw new Error(
      detail ||
        "Inbox is not connected yet. Its database migration and functions need to be installed.",
    );
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export function checkSendResult(data) {
  if (data?.error) throw new Error(data.error);
  if (!data?.message)
    throw new Error(
      "No delivery record was returned. Check the inbox before resending.",
    );
  if (
    ["failed", "unknown", "undelivered", "bounced"].includes(
      data.message.status,
    )
  ) {
    throw new Error(
      data.message.error ||
        `Message ${data.message.status}. Check the inbox before resending.`,
    );
  }
  return data;
}
export const STATUS_LABELS = {
  preparing: "Preparing",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  undelivered: "Undelivered",
  bounced: "Bounced",
  complained: "Spam complaint",
  unknown: "Check delivery",
  simulated: "Simulated · not sent",
  received: "Received",
};
export const unread = (thread) =>
  Boolean(
    thread.last_inbound_at &&
    (!thread.read_at || thread.last_inbound_at > thread.read_at),
  );
export async function filePayload(file) {
  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read attachment."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, content };
}
