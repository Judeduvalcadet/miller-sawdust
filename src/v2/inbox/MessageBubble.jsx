import { useState } from "react";
import {
  Check,
  CheckCheck,
  AlertCircle,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
} from "lucide-react";
import { messaging, STATUS_LABELS } from "./api";

export default function MessageBubble({ message }) {
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(null);
  const outbound = message.direction === "outbound";
  const failed = [
    "failed",
    "undelivered",
    "bounced",
    "complained",
    "unknown",
  ].includes(message.status);
  const time = new Date(message.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  async function open(file, index) {
    setLoading(index);
    setError("");
    try {
      const { url } = await messaging("attachment", {
        message_id: message.id,
        index,
      });
      setPreview({ url, file });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] md:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${outbound ? "bg-gray-100 border border-gray-200 text-gray-900 rounded-br-sm" : "bg-white border border-gray-200 text-gray-900 rounded-bl-sm"}`}
      >
        <div
          className={`flex items-center gap-1.5 text-[10px] mb-1.5 ${outbound ? "text-gray-500" : "text-gray-500"}`}
        >
          {message.channel === "email" ? (
            <Mail size={12} />
          ) : (
            <MessageSquare size={12} />
          )}
          {outbound ? message.sent_by_name || "Office" : "Customer"}
          {message.invoice_id && (
            <span className="ml-2 border border-current/20 rounded px-1.5">
              Invoice
            </span>
          )}
        </div>
        {message.channel === "email" && message.subject && (
          <p className="font-semibold text-sm mb-1">{message.subject}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.body}
        </p>
        {!!message.attachments?.length && (
          <div className="mt-2 space-y-1.5">
            {message.attachments.map((file, i) => (
              <div key={i}>
                <button
                  disabled={!file.path || loading === i}
                  onClick={() => open(file, i)}
                  className="flex items-center gap-2 rounded-lg border border-current/20 px-3 py-2 text-xs hover:bg-gray-500/15 disabled:opacity-60"
                >
                  {loading === i ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <FileText size={15} />
                  )}
                  {file.name}
                  {file.size ? (
                    <span className="opacity-60">
                      {Math.ceil(file.size / 1024)} KB
                    </span>
                  ) : null}
                </button>
                {file.error && <p className="text-xs mt-1">{file.error}</p>}
              </div>
            ))}
          </div>
        )}
        {preview && (
          <div className="mt-2">
            {preview.file.type.startsWith("image/") && (
              <img
                className="rounded-lg max-h-64"
                src={preview.url}
                alt={preview.file.name}
              />
            )}
            {preview.file.type.startsWith("audio/") && (
              <audio controls src={preview.url} className="max-w-full" />
            )}
            {preview.file.type.startsWith("video/") && (
              <video
                controls
                src={preview.url}
                className="max-h-64 max-w-full"
              />
            )}
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline"
            >
              Open {preview.file.name}
            </a>
          </div>
        )}
        {(message.error || error) && (
          <p
            role="alert"
            className={`text-xs mt-2 ${outbound ? "text-red-700" : "text-red-700"}`}
          >
            {error || message.error}
          </p>
        )}
        <div
          className={`flex flex-wrap justify-end items-center gap-1.5 text-[10px] mt-2 ${failed ? "text-red-700" : outbound ? "text-gray-500" : "text-gray-500"}`}
          title={
            message.provider_id
              ? `Provider ID: ${message.provider_id}`
              : undefined
          }
        >
          <time dateTime={message.created_at}>{time}</time>
          {outbound && (
            <>
              {failed ? (
                <AlertCircle size={12} />
              ) : message.status === "delivered" ? (
                <CheckCheck size={13} />
              ) : ["preparing", "sending", "queued"].includes(
                  message.status,
                ) ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              {STATUS_LABELS[message.status] || message.status}
            </>
          )}
        </div>
      </article>
    </div>
  );
}
