import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle, Send, X, Loader2, History, SquarePen, ChevronLeft } from 'lucide-react';
import { base44 } from '@/api/entities';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const SUGGESTIONS = [
  "Check a driver's route for today",
  'What jobs are on the board tomorrow?',
  'Look up a customer',
];

// A line of "A → B → C" renders as a route strip: each stop in a chip with a
// subtle background, arrows between (same look as the route study report).
function MessageContent({ content, dark }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const stops = line.split('→').map(s => s.trim().replace(/^[-•\d.)\s]+/, '')).filter(Boolean);
        if (stops.length >= 2 && line.includes('→')) {
          return (
            <div key={i} className="flex flex-wrap items-center gap-1 py-0.5">
              {stops.map((stop, j) => (
                <span key={j} className="flex items-center gap-1">
                  <span className={cn(
                    'px-2 py-0.5 rounded text-[12.5px] whitespace-nowrap',
                    dark ? 'bg-white/15' : 'bg-gray-100 border border-gray-200'
                  )}>
                    {stop}
                  </span>
                  {j < stops.length - 1 && <span className={dark ? 'text-white/50' : 'text-gray-400'}>→</span>}
                </span>
              ))}
            </div>
          );
        }
        return line.trim() ? <p key={i}>{line}</p> : null;
      })}
    </div>
  );
}

// Floating dispatch-assistant chat. Rendered only for admin/dispatcher (the
// edge function enforces the role server-side too). The assistant is
// read-only by construction: its server tools can look things up and run
// route checks, nothing else. Conversations are stored server-side.
export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('chat'); // 'chat' | 'history'
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const role = typeof window !== 'undefined' ? window.localStorage.getItem('miller_driver_role') : '';
  const allowed = ['admin', 'dispatcher'].includes(role);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading, open, view]);

  useEffect(() => {
    if (open && view === 'chat') inputRef.current?.focus();
  }, [open, view]);

  if (!allowed) return null;

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setMessages(prev => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);
    try {
      const { data } = await base44.functions.invoke('assistant', {
        message: content,
        conversation_id: conversationId || undefined,
      });
      if (data?.conversation_id) setConversationId(data.conversation_id);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.reply || 'Something went wrong on my end — try again.',
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I couldn't reach the assistant just now. Give it a moment and try again.",
      }]);
    }
    setIsLoading(false);
  };

  const openHistory = async () => {
    setView('history');
    setHistoryLoading(true);
    try {
      const { data } = await base44.functions.invoke('assistant', { action: 'list' });
      setConversations(data?.conversations || []);
    } catch {
      setConversations([]);
    }
    setHistoryLoading(false);
  };

  const openConversation = async (id) => {
    setHistoryLoading(true);
    try {
      const { data } = await base44.functions.invoke('assistant', { action: 'get', conversation_id: id });
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setConversationId(id);
      setView('chat');
    } catch { /* stay on the list */ }
    setHistoryLoading(false);
  };

  const newChat = () => {
    setMessages([]);
    setConversationId(null);
    setView('chat');
    inputRef.current?.focus();
  };

  return (
    <>
      {/* Floating toggle */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-gray-950 hover:bg-gray-800 text-white shadow-lg flex items-center justify-center transition-colors"
          aria-label="Open dispatch assistant"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] sm:w-[400px] h-[min(560px,calc(100vh-6rem))] bg-white rounded-2xl shadow-2xl border border-gray-800 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gray-950 text-white px-4 py-3 flex items-center gap-3 shrink-0">
            <img src="/logo.jpg" alt="Miller Sawdust" className="w-9 h-9 rounded-full object-cover bg-white" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Dispatch Assistant</p>
              <p className="text-[11px] text-gray-400">Ask anything</p>
            </div>
            <button onClick={newChat} className="p-1.5 rounded hover:bg-white/15" aria-label="New chat" title="New chat">
              <SquarePen className="w-[18px] h-[18px]" />
            </button>
            <button onClick={openHistory} className="p-1.5 rounded hover:bg-white/15" aria-label="Chat history" title="Chat history">
              <History className="w-[18px] h-[18px]" />
            </button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-white/15" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* History view */}
          {view === 'history' && (
            <div className="flex-1 overflow-y-auto bg-gray-50">
              <button
                onClick={() => setView('chat')}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 px-4 py-3"
              >
                <ChevronLeft className="w-4 h-4" /> Back to chat
              </button>
              {historyLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
              ) : conversations.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No conversations yet.</p>
              ) : (
                <div className="px-3 pb-3 space-y-1.5">
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openConversation(c.id)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 rounded-lg border bg-white hover:border-gray-400 transition-colors',
                        c.id === conversationId ? 'border-gray-900' : 'border-gray-200'
                      )}
                    >
                      <p className="text-sm text-gray-900 truncate">{c.title || 'Conversation'}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {c.updated_date ? format(new Date(c.updated_date), 'EEE, MMM d · h:mm a') : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat view */}
          {view === 'chat' && (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-gray-50">
                {messages.length === 0 && (
                  <div className="pt-4">
                    <p className="text-sm text-gray-600 text-center mb-3">
                      Ask about drivers, jobs, customers, or routes.
                    </p>
                    <div className="flex flex-col items-stretch gap-2 px-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className="text-sm text-left px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-100"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words',
                      m.role === 'user'
                        ? 'bg-gray-950 text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                    )}>
                      <MessageContent content={m.content} dark={m.role === 'user'} />
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 px-3 py-2 rounded-2xl rounded-bl-sm">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); send(); }}
                className="border-t border-gray-200 bg-white p-2 flex items-center gap-2 shrink-0"
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                  placeholder="Ask the assistant..."
                  maxLength={2000}
                  className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
                <Button type="submit" size="icon" disabled={!input.trim() || isLoading} className="bg-gray-950 hover:bg-gray-800 shrink-0">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
