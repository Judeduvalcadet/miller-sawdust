import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Ban,
  Mail,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  X,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { V2_READ_ONLY } from "./guard";
import { messaging, checkSendResult, filePayload, unread } from "./inbox/api";
import MessageBubble from "./inbox/MessageBubble";
import NewConversation from "./inbox/NewConversation";

const PAGE = 50;
const stamp = (value) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export default function V2Inbox() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get("conversation");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [archived, setArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["inbox"] });
  const config = useQuery({
    queryKey: ["inbox", "config"],
    queryFn: () => messaging("status"),
    retry: false,
    staleTime: 30000,
  });
  const writable = !V2_READ_ONLY && config.data?.writable;
  const threads = useInfiniteQuery({
    queryKey: ["inbox", "threads", search, filter, archived],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from("messaging_conversations")
        .select("*")
        .eq("archived", archived)
        .order("last_message_at", { ascending: false })
        .order("id")
        .range(pageParam, pageParam + PAGE - 1);
      if (["sms", "email"].includes(filter))
        query = query.eq("channel", filter);
      // The unread tab is filtered from all loaded conversations; pagination
      // stays available even if the current page has no unread entries.
      const q = search.replace(/[%_(),]/g, "").trim();
      if (q)
        query = query.or(
          `display_name.ilike.%${q}%,address.ilike.%${q}%,last_preview.ilike.%${q}%`,
        );
      const { data, error: err } = await query;
      if (err) throw err;
      return data;
    },
    getNextPageParam: (last, pages) =>
      last.length === PAGE ? pages.length * PAGE : undefined,
    retry: false,
  });
  const active = useQuery({
    queryKey: ["inbox", "thread", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("messaging_conversations")
        .select("*")
        .eq("id", selected)
        .single();
      if (err) throw err;
      return data;
    },
  });
  useEffect(() => {
    const channel = supabase
      .channel("miller-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messaging_messages" },
        () => qc.invalidateQueries({ queryKey: ["inbox"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messaging_conversations" },
        () => qc.invalidateQueries({ queryKey: ["inbox"] }),
      )
      .subscribe();
    // Polling recovers missed events after sleeping, reconnecting or publication lag.
    const timer = setInterval(
      () => qc.invalidateQueries({ queryKey: ["inbox"] }),
      30000,
    );
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [qc]);
  const rows = (threads.data?.pages.flat() || []).filter(
    (c) => filter !== "unread" || unread(c),
  );
  async function update(patch) {
    setError("");
    try {
      await messaging("update", { conversation_id: selected, ...patch });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white w-full max-w-[1120px] self-start">
      <div
        className={`px-4 py-2 text-xs border-b ${config.isError || threads.isError ? "bg-amber-50 text-amber-900" : "bg-gray-50 text-gray-600"}`}
      >
        {config.isError || threads.isError
          ? "Inbox setup is pending. Install the messaging migration and functions to connect conversations."
          : V2_READ_ONLY
            ? "Live data is read-only. Use the sandbox to compose and test messages."
            : config.data?.test_email_to
              ? `Test recipients only: ${config.data.test_email_to}${config.data.test_sms_to ? ` and ${config.data.test_sms_to}` : '. SMS disabled'}.`
            : config.data?.dry_run
              ? "Sandbox simulation: no texts or emails leave this app."
              : !config.data?.external_sending_enabled
                ? "Provider setup is pending. Outgoing delivery is disabled."
                : "Delivery receipts update automatically. Delivered does not mean read."}
        <button className="ml-3 underline" onClick={refresh}>
          Refresh
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside
          className={`${selected ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 shrink-0 border-r border-gray-200`}
        >
          <div className="p-4 border-b space-y-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold">
                {archived ? "Archive" : "Inbox"}
              </h1>
              <div className="flex gap-1">
                <button
                  title={archived ? "Show inbox" : "Show archived"}
                  aria-label={archived ? "Show inbox" : "Show archived"}
                  onClick={() => setArchived(!archived)}
                  className={`p-2 rounded-lg ${archived ? "bg-gray-200" : "hover:bg-gray-100"}`}
                >
                  <Archive size={17} />
                </button>
                <button
                  title="New conversation"
                  aria-label="New conversation"
                  disabled={!writable}
                  onClick={() => setNewOpen(true)}
                  className="p-2 rounded-lg bg-gray-950 text-white disabled:opacity-40"
                >
                  <Plus size={17} />
                </button>
              </div>
            </div>
            <div className="relative">
              <Search
                size={15}
                className="absolute top-2.5 left-3 text-gray-400"
              />
              <input
                aria-label="Search conversations"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-1">
              {[
                ["all", "All"],
                ["unread", "Unread"],
                ["sms", "Texts"],
                ["email", "Email"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`flex-1 text-xs py-1.5 rounded-md ${filter === value ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.isLoading && (
              <p className="p-6 text-sm text-gray-500">
                Loading conversations…
              </p>
            )}
            {threads.isError && (
              <p role="alert" className="p-5 text-sm text-gray-500">
                Conversations are unavailable until inbox setup is complete.
              </p>
            )}
            {!threads.isLoading && !threads.isError && !rows.length && (
              <div className="p-8 text-center text-gray-400">
                <MessageSquare className="mx-auto mb-3" />
                <p className="text-sm">
                  No {filter === "unread" ? "unread " : ""}conversations here.
                </p>
              </div>
            )}
            {rows.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setParams({ conversation: c.id });
                  setError("");
                }}
                className={`w-full text-left p-4 border-b border-gray-100 flex gap-3 ${selected === c.id ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <span
                  className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center ${c.channel === "email" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}
                >
                  {c.channel === "email" ? (
                    <Mail size={17} />
                  ) : (
                    <MessageSquare size={17} />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex justify-between gap-2">
                    <span
                      className={`truncate text-sm ${unread(c) ? "font-bold" : "font-medium"}`}
                    >
                      {c.display_name || c.address}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {stamp(c.last_message_at)}
                    </span>
                  </span>
                  <span className="block text-xs text-gray-400 truncate mt-0.5">
                    {c.address}
                  </span>
                  <span className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500 truncate">
                      {c.last_preview || "No messages yet"}
                    </span>
                    {unread(c) && (
                      <span
                        aria-label="Unread"
                        className="w-2 h-2 rounded-full bg-blue-600 ml-auto shrink-0"
                      />
                    )}
                    {c.blocked && <Ban size={12} />}
                  </span>
                </span>
              </button>
            ))}
            {threads.hasNextPage && (
              <button
                onClick={() => threads.fetchNextPage()}
                disabled={threads.isFetchingNextPage}
                className="p-3 w-full text-sm text-blue-700"
              >
                Load more conversations
              </button>
            )}
          </div>
        </aside>
        <section
          className={`${selected ? "flex" : "hidden md:flex"} flex-1 max-w-[800px] min-w-0 min-h-0 flex-col bg-gray-50`}
        >
          {!selected ? (
            <div className="m-auto text-center text-gray-400 px-8">
              <MessageSquare size={36} className="mx-auto mb-4" />
              <h2 className="text-lg text-gray-700 font-medium">
                Customer conversations
              </h2>
              <p className="text-sm mt-2 max-w-sm">
                Texts, attachments and invoice delivery history, together in one
                place.
              </p>
            </div>
          ) : active.isError ? (
            <p role="alert" className="p-6 text-red-700">
              Could not load this conversation.
            </p>
          ) : active.data ? (
            <>
              <header className="bg-white border-b px-4 py-3 flex items-center gap-3">
                <button
                  aria-label="Back to conversations"
                  className="md:hidden"
                  onClick={() => setParams({})}
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-sm truncate">
                    {active.data.display_name || active.data.address}
                  </h2>
                  <p className="text-xs text-gray-500 truncate">
                    {active.data.address} ·{" "}
                    {active.data.channel === "email" ? "Email" : "Text / MMS"}
                  </p>
                </div>
                <button
                  disabled={!writable}
                  title={
                    active.data.archived
                      ? "Restore conversation"
                      : "Archive conversation"
                  }
                  aria-label={
                    active.data.archived
                      ? "Restore conversation"
                      : "Archive conversation"
                  }
                  onClick={() => update({ archived: !active.data.archived })}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40"
                >
                  <Archive size={17} />
                </button>
                <button
                  disabled={!writable}
                  title={
                    active.data.blocked ? "Unblock sending" : "Block sending"
                  }
                  aria-label={
                    active.data.blocked ? "Unblock sending" : "Block sending"
                  }
                  onClick={() => update({ blocked: !active.data.blocked })}
                  className={`p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 ${active.data.blocked ? "text-red-700" : ""}`}
                >
                  <Ban size={17} />
                </button>
              </header>
              {error && (
                <p role="alert" className="p-3 text-sm text-red-700 bg-red-50">
                  {error}
                </p>
              )}
              <Thread
                key={selected}
                thread={active.data}
                writable={writable}
                config={config.data}
              />
            </>
          ) : (
            <Loader2 className="m-auto animate-spin" />
          )}
        </section>
      </div>
      {newOpen && (
        <NewConversation
          onClose={() => setNewOpen(false)}
          onCreated={(c) => {
            setNewOpen(false);
            setArchived(false);
            setFilter("all");
            setSearch("");
            setParams({ conversation: c.id });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Thread({ thread, writable, config }) {
  const qc = useQueryClient(),
    bottom = useRef(null),
    fileInput = useRef(null),
    intent = useRef(null);
  const [text, setText] = useState(""),
    [subject, setSubject] = useState(""),
    [files, setFiles] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const messages = useInfiniteQuery({
    queryKey: ["inbox", "messages", thread.id],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error: err } = await supabase
        .from("messaging_messages")
        .select("*")
        .eq("conversation_id", thread.id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(pageParam, pageParam + PAGE - 1);
      if (err) throw err;
      return data;
    },
    getNextPageParam: (last, pages) =>
      last.length === PAGE ? pages.length * PAGE : undefined,
  });
  const rows =
    messages.data?.pages
      .flat()
      .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
      .reverse() || [];
  const newest = rows.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [newest]);
  const lastSeenInbound = rows
    .filter((m) => m.direction === "inbound")
    .at(-1)?.created_at;
  useEffect(() => {
    if (!writable || !lastSeenInbound || !unread(thread)) return;
    messaging("update", {
      conversation_id: thread.id,
      read_at: lastSeenInbound,
    })
      .then(() => qc.invalidateQueries({ queryKey: ["inbox"] }))
      .catch((e) => setError(e.message));
  }, [
    thread.id,
    thread.read_at,
    thread.last_inbound_at,
    lastSeenInbound,
    writable,
    qc,
  ]);
  const ready =
    writable &&
    !thread.blocked &&
    !thread.opted_out &&
    (thread.channel === "email" ? config?.email_ready : config?.sms_ready);
  async function submit(e) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      // Retain one request ID and payload across network retries. Edits reset it.
      if (!intent.current)
        intent.current = {
          request_id: crypto.randomUUID(),
          conversation_id: thread.id,
          channel: thread.channel,
          to: thread.address,
          customer_id: thread.customer_id,
          body: text,
          subject,
          attachments: await Promise.all(files.map(filePayload)),
        };
      const result = await messaging("send", intent.current);
      await qc.invalidateQueries({ queryKey: ["inbox"] });
      checkSendResult(result);
      setText("");
      setSubject("");
      setFiles([]);
      intent.current = null;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function addFiles(event) {
    const next = [...files, ...Array.from(event.target.files || [])];
    event.target.value = "";
    if (
      next.length > 5 ||
      next.reduce((n, f) => n + f.size, 0) > 4 * 1024 * 1024
    ) {
      setError("Attach up to five files, totaling 4 MB or less.");
      return;
    }
    setFiles(next);
    intent.current = null;
  }
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.hasNextPage && (
          <button
            onClick={() => messages.fetchNextPage()}
            disabled={messages.isFetchingNextPage}
            className="block mx-auto text-xs text-blue-700"
          >
            Load earlier messages
          </button>
        )}
        {messages.isLoading && (
          <p className="text-sm text-gray-500">Loading messages…</p>
        )}
        {messages.isError && (
          <p role="alert" className="text-sm text-red-700">
            Messages could not be loaded.{" "}
            <button className="underline" onClick={() => messages.refetch()}>
              Retry
            </button>
          </p>
        )}
        {!messages.isLoading && !messages.isError && !rows.length && (
          <p className="text-sm text-gray-400 text-center pt-10">
            Start the conversation below.
          </p>
        )}
        {rows.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="bg-white border-t p-4 space-y-2">
        {(thread.blocked || thread.opted_out) && (
          <p className="text-xs text-red-700">
            {thread.opted_out
              ? "This recipient opted out. Sending stays disabled until they opt back in."
              : "Sending is blocked for this conversation."}
          </p>
        )}
        {thread.channel === "email" && (
          <>
            <p className="text-xs text-gray-500">
              Email delivery history appears here. Replies go to the sending
              mailbox; incoming email sync is not enabled.
            </p>
            <input
              aria-label="Email subject"
              required
              disabled={!ready || busy}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                intent.current = null;
              }}
              placeholder="Subject"
              maxLength={200}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-2 border rounded-lg px-2 py-1 text-xs"
              >
                {f.name}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${f.name}`}
                  onClick={() => {
                    setFiles(files.filter((_, j) => i !== j));
                    intent.current = null;
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          aria-label="Message"
          disabled={!ready || busy}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            intent.current = null;
          }}
          maxLength={10000}
          rows={3}
          placeholder={
            ready
              ? "Write a message…"
              : "Sending is unavailable until setup is complete."
          }
          className="w-full resize-none border rounded-xl p-3 text-sm disabled:bg-gray-50"
        />
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,video/mp4"
            className="hidden"
            onChange={addFiles}
          />
          <button
            type="button"
            disabled={!ready || busy}
            title="Attach files"
            aria-label="Attach files"
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={18} />
          </button>
          <span className="text-[10px] text-gray-400">Up to 4 MB total</span>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ["inbox"] })}
            aria-label="Refresh messages"
            className="p-2 text-gray-400"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="submit"
            disabled={!ready || busy || (!text.trim() && !files.length)}
            className="ml-auto flex gap-2 items-center bg-gray-950 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}{" "}
            {config?.dry_run ? "Simulate send" : "Send"}
          </button>
        </div>
      </form>
    </>
  );
}
