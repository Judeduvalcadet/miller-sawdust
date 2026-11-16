// Pure validation shared by provider handlers and executable regression tests.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "video/mp4",
];
export function normalizeAddress(channel: string, value: string): string {
  const raw = String(value ?? "").trim();
  if (channel === "email") {
    const [local, domain, extra] = raw.split('@');
    if (!local || !domain || extra !== undefined || raw.length > 254 || local.length > 64 ||
      !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !domain.includes('.') || domain.split('.').some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)) ||
      domain.split('.').at(-1)!.length < 2)
      throw new Error("Enter a valid email address.");
    return raw.toLowerCase();
  }
  if (channel !== "sms") throw new Error("Unsupported channel.");
  if (!/^\+?[\d\s().-]+$/.test(raw))
    throw new Error("Enter a valid phone number.");
  const digits = raw.replace(/\D/g, "");
  const result = raw.startsWith("+")
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith("1")
        ? `+${digits}`
        : "";
  if (!/^\+[1-9]\d{7,14}$/.test(result) || (result.startsWith("+1") && digits.length !== 11 && raw.startsWith("+")))
    throw new Error(
      "Use a 10-digit US number or an international number starting with +.",
    );
  return result;
}
export function emailSenderAddress(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Enter a valid sender address.');
  const match = String(value || '').trim().match(/^(?:[^<>]*<([^<>]+)>|([^<>]+))$/);
  return normalizeAddress('email', match?.[1] || match?.[2] || '');
}
export function mediaFilename(name: string, index = 0): string {
  const basename = String(name || "").split(/[\\/]/).pop() || "";
  const safe = basename.normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "");
  if (!safe) return `attachment-${index + 1}.bin`;
  const dot = safe.lastIndexOf(".");
  if (dot > 0) return safe.slice(0, dot).slice(0, 140) + safe.slice(dot, dot + 12);
  return safe.slice(0, 152);

}
export function decodeAttachment(file: {
  name: string;
  type: string;
  content: string;
}) {
  if (!MEDIA_TYPES.includes(file.type))
    throw new Error("Supported attachments: PDF, images, MP3, OGG, MP4.");
  if (
    !file.content ||
    file.content.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
  )
    throw new Error("Attachments must total 4 MB or less.");
  let bin: string;
  try {
    bin = atob(file.content);
  } catch {
    throw new Error("Invalid attachment encoding.");
  }
  if (bin.length > MAX_ATTACHMENT_BYTES)
    throw new Error("Attachments must total 4 MB or less.");
  if (file.type === "application/pdf" && !bin.startsWith("%PDF-"))
    throw new Error("The PDF attachment is invalid.");
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function receiptStatus(provider: string, event: string): string | null {
  if (provider === "twilio")
    return [
      "queued",
      "sending",
      "sent",
      "delivered",
      "undelivered",
      "failed",
    ].includes(event)
      ? event
      : null;
  return (
    (
      {
        "email.sent": "sent",
        "email.delivered": "delivered",
        "email.bounced": "bounced",
        "email.complained": "complained",
        "email.failed": "failed",
      } as Record<string, string>
    )[event] || null
  );
}
export function optOutChange(body: string, providerType = ""): boolean | null {
  const word = (providerType || body).trim().toUpperCase();
  if (
    [
      "STOP",
      "STOPALL",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
      "REVOKE",
      "OPTOUT",
    ].includes(word)
  )
    return true;
  if (["START", "UNSTOP"].includes(word)) return false;
  return null;
}
