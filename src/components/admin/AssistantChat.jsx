import { splitAssistantRows } from '@/lib/assistantResults';
import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageCircle, Send, X, Loader2, History, SquarePen, ChevronLeft } from 'lucide-react';
import { assistantRequest, assistantDev } from '@/api/assistantClient';
import AssistantFeedback from './AssistantFeedback';
import AssistantReview from './AssistantReview';
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [progress, setProgress] = useState('Connecting');
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [resultSearch, setResultSearch] = useState('');
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

  // On phones, freeze the page behind the panel so scrolling inside the chat
  // never drags the dispatch board along with it.
  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 640px)').matches) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [open]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const resize = () => { field.style.height = 'auto'; const height = field.scrollHeight + 2; field.style.height = `${Math.min(height, 258)}px`; field.style.overflowY = height > 258 ? 'auto' : 'hidden'; };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [input, open, view]);
  useEffect(() => {
    if (!isLoading) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now()-startedRef.current)/1000)), 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  const resultRows = splitAssistantRows(results);
  const visibleRows = resultRows.rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(resultSearch.toLowerCase())));

  if (!allowed) return null;

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setMessages(prev => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);
    startedRef.current = Date.now(); setElapsed(0); setProgress('Connecting');
    try {
      const { data } = await assistantRequest( {
        message: content,
        conversation_id: conversationId || undefined,
      }, setProgress);
      if (data?.conversation_id) setConversationId(data.conversation_id);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data?.reply || 'Something went wrong on my end - try again.',
        results: data?.results,
        run_id: data?.run_id, checks: data?.checks, elapsed_ms: data?.elapsed_ms ?? Date.now()-startedRef.current,
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: error.message || "The request failed. Please try again.",
      }]);
    }
    setIsLoading(false);
  };

  const openHistory = async () => {
    setView('history');
    setHistoryLoading(true);
    try {
      const { data } = await assistantRequest( { action: 'list' });
      setConversations(data?.conversations || []);
    } catch {
      setConversations([]);
    }
    setHistoryLoading(false);
  };

  const openConversation = async (id) => {
    setHistoryLoading(true);
    try {
      const { data } = await assistantRequest( { action: 'get', conversation_id: id });
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
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent className="max-w-3xl max-h-[85dvh] flex flex-col"><DialogHeader><DialogTitle>Assistant review</DialogTitle><DialogDescription>Verify corrections before they become dev rules.</DialogDescription></DialogHeader>{reviewOpen && <AssistantReview/>}</DialogContent></Dialog>
      <Dialog open={!!results} onOpenChange={value => { if (!value) setResults(null); }}>
        <DialogContent className="sm:max-w-4xl w-[calc(100vw-2rem)] max-h-[85dvh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="flex flex-wrap items-start gap-3 px-6 pt-6 pb-4 pr-12">
            <DialogHeader className="flex-1 min-w-[160px] text-left">
              <DialogTitle>{results?.title || 'Results'}</DialogTitle>
              <DialogDescription>{resultRows.rows.length} rows</DialogDescription>
            </DialogHeader>
            <input aria-label="Search results" placeholder="Search results..." value={resultSearch} onChange={e => setResultSearch(e.target.value)} className="ml-auto w-44 max-w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-500" />
          </div>
          <div className="overflow-auto min-h-0 mx-6 mb-6 rounded-lg border border-gray-200">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="sticky top-0 bg-gray-100 text-gray-600 text-xs">
                <tr><th scope="col" className="w-10 px-4 py-3 border-b border-r border-gray-200 text-right">#</th>{results?.columns.map((column, i) => <th scope="col" key={i} className="px-4 py-3 border-b border-r last:border-r-0 border-gray-200 font-semibold whitespace-nowrap">{column}</th>)}</tr>
              </thead>
              <tbody>{visibleRows.map((row, index) => (
                <tr key={index} className="even:bg-gray-50/70 hover:bg-blue-50/60 transition-colors">
                  <td className="px-4 py-3 border-b border-r border-gray-100 text-gray-400 text-xs text-right tabular-nums">{index + 1}</td>
                  {row.map((cell, i) => <td key={i} className={cn('px-4 py-3 border-b border-r last:border-r-0 border-gray-100 text-gray-800 whitespace-pre-line break-words min-w-[100px] max-w-sm', /^-?[\d,.]+(?:\s*(?:loads?|yds|mi|min))?$/.test(String(cell)) && 'text-right tabular-nums font-medium')} >{cell}</td>)}
                </tr>
              ))}</tbody>
              {resultRows.totals.length > 0 && <tfoot className="sticky bottom-0 bg-slate-200 text-gray-950 font-bold border-t-2 border-slate-300">
                {resultRows.totals.map((row, index) => <tr key={index}>
                  <td className="px-4 py-3 border-r border-slate-300" />
                  {row.map((cell, i) => <td key={i} className={cn('px-4 py-3 border-r last:border-r-0 border-slate-300', i > 0 && 'text-right tabular-nums')}>{cell}</td>)}
                </tr>)}
              </tfoot>}
            </table>
            {results && visibleRows.length === 0 && <p className="p-8 text-center text-sm text-gray-500">No results</p>}
          </div>
        </DialogContent>
      </Dialog>
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
            {assistantDev && role === 'admin' && <button onClick={()=>setReviewOpen(true)} className="text-xs p-1 hover:bg-white/15 rounded">Review</button>}
            <button disabled={isLoading} onClick={newChat} className="p-1.5 rounded hover:bg-white/15" aria-label="New chat" title="New chat">
              <SquarePen className="w-[18px] h-[18px]" />
            </button>
            <button disabled={isLoading} onClick={openHistory} className="p-1.5 rounded hover:bg-white/15" aria-label="Chat history" title="Chat history">
              <History className="w-[18px] h-[18px]" />
            </button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-white/15" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* History view */}
          {view === 'history' && (
            <div className="flex-1 overflow-y-auto overscroll-contain bg-gray-50">
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
              <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2 bg-gray-50">
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
                      {m.role === 'assistant' && m.elapsed_ms != null && <p className="mt-1 text-[11px] text-gray-400">{Math.max(1,Math.round(m.elapsed_ms/1000))} seconds</p>}
                      {assistantDev && m.run_id && <AssistantFeedback message={m}/>}

                      {m.role === 'assistant' && m.results?.columns?.length > 0 && Array.isArray(m.results.rows) && (
                        <button type="button" className="mt-2 text-xs font-semibold underline underline-offset-4 text-gray-700 hover:text-black" onClick={() => { setResults(m.results); setResultSearch(''); }}>View results</button>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 px-3 py-2 rounded-2xl rounded-bl-sm">
                      <div className="text-xs text-gray-500"><span role="status">{progress}</span><span className="ml-2 tabular-nums">{elapsed}s</span></div>
                      <div aria-label="Assistant is working" className="flex gap-1 py-2">{[0,1,2].map(i=><span key={i} className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce motion-reduce:animate-none" style={{animationDelay:`${i*150}ms`}} />)}</div>
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); send(); }}
                className="border-t border-gray-200 bg-white p-2 flex items-center gap-2 shrink-0"
              >
                <textarea
                  rows={1}
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                  placeholder="Ask the assistant..."
                  maxLength={2000}
                  style={{lineHeight:"24px",maxHeight:258}}
                  className="flex-1 min-w-0 resize-none overflow-y-auto text-base sm:text-sm px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
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
