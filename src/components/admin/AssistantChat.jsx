import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle, Send, X, Bot, ShieldCheck, Loader2 } from 'lucide-react';
import { base44 } from '@/api/entities';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  "Check Vadym's route for today",
  'What jobs are on the board tomorrow?',
  'Find customer Valex',
];

// Floating dispatch-assistant chat. Rendered only for admin/dispatcher (the
// edge function enforces the role server-side too). The assistant is
// read-only by construction: its server tools can look things up and run
// route checks, nothing else.
export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const role = typeof window !== 'undefined' ? window.localStorage.getItem('miller_driver_role') : '';
  const allowed = ['admin', 'dispatcher'].includes(role);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!allowed) return null;

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setIsLoading(true);
    try {
      const { data } = await base44.functions.invoke('assistant', {
        messages: next.slice(-16),
      });
      setMessages([...next, {
        role: 'assistant',
        content: data?.reply || "Something went wrong on my end — try again.",
      }]);
    } catch {
      setMessages([...next, {
        role: 'assistant',
        content: "I couldn't reach the assistant just now. Give it a moment and try again.",
      }]);
    }
    setIsLoading(false);
  };

  return (
    <>
      {/* Floating toggle */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-amber-600 hover:bg-amber-700 text-white shadow-lg flex items-center justify-center transition-colors"
          aria-label="Open dispatch assistant"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] sm:w-[400px] h-[min(560px,calc(100vh-6rem))] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-amber-600 text-white px-4 py-3 flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Dispatch Assistant</p>
              <p className="text-[11px] text-amber-100 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Read-only — it can't change anything
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/20" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
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
                      className="text-sm text-left px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
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
                    ? 'bg-amber-600 text-white rounded-br-sm'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                )}>
                  {m.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 px-3 py-2 rounded-2xl rounded-bl-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="border-t border-gray-200 bg-white p-2 flex items-center gap-2 shrink-0"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the assistant..."
              maxLength={2000}
              className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || isLoading} className="bg-amber-600 hover:bg-amber-700 shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
