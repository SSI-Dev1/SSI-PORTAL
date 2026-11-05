// The private conversation of one application, in a centred modal. Messages are plain text,
// rendered as text nodes (never as HTML), so nothing a participant types can run as a script.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, CheckCheck, Loader2, Lock, MessagesSquare, RotateCw, Send, X } from 'lucide-react';
import { Alert, Avatar, Badge, Button, EmptyState, Modal, Tooltip } from './ui';
import { useChat, type ChatContextInfo, type ChatMessage } from '../store/chat';
import { useStore } from '../store/store';
import { ROLE_LABEL } from '../auth/roles';
import { appStatusTone, cn } from '../lib/utils';
import type { AppStatus, UserRole } from '../data/types';

const PAGE = 30;
const MAX_LENGTH = 4000;

interface Pending {
  clientId: string;
  body: string;
  state: 'sending' | 'failed';
  reason?: string;
}

const errorText = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? '';
  if (m.includes('CHAT_RATE_LIMIT')) return 'You are sending messages too quickly. Wait a moment, then retry.';
  if (m.includes('CHAT_DENIED')) return 'You no longer have access to this conversation.';
  if (m.includes('CHAT_TOO_LONG')) return `Messages can be up to ${MAX_LENGTH} characters.`;
  if (m.includes('CHAT_EMPTY')) return 'Write a message first.';
  return 'Not delivered. Check your connection and retry.';
};
const denied = (e: unknown) => (e as { message?: string })?.message?.includes('CHAT_DENIED');

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const roleLabel = (r: string) => ROLE_LABEL[r as UserRole] ?? r;

export default function ApplicationChat({ applicationId }: { applicationId: string }) {
  const { api, closeChat, refresh, drafts } = useChat();
  const { session } = useStore();
  const me = session?.userId;
  const [ctx, setCtx] = useState<ChatContextInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [text, setTextState] = useState(() => drafts.current[applicationId] ?? '');
  const [showJump, setShowJump] = useState(false);
  const [firstUnread, setFirstUnread] = useState<number | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<number | null>(null); // scroll height before older messages were added
  const initial = useRef(true);
  const stickNext = useRef(false);
  const lastMarked = useRef(0);

  const setText = (v: string) => {
    drafts.current[applicationId] = v;
    setTextState(v);
  };

  const merge = useCallback((rows: ChatMessage[]) => {
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      rows.forEach((m) => byId.set(m.id, m));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    // A saved message replaces its "sending" copy, so it can never show twice.
    const saved = new Set(rows.map((m) => m.clientId));
    setPending((p) => (p.some((x) => saved.has(x.clientId)) ? p.filter((x) => !saved.has(x.clientId)) : p));
  }, []);

  /** Re-reads the newest messages and the header from the server. */
  const sync = useCallback(async () => {
    try {
      const [info, rows] = await Promise.all([api.context(applicationId), api.messages(applicationId, { limit: PAGE })]);
      setCtx(info);
      merge(rows);
      setHasOlder((h) => (initial.current ? rows.length === PAGE : h));
      setStatus('ready');
      if (initial.current) {
        const unread = rows.filter((m) => m.id > info.myLastReadId && m.senderId !== me).map((m) => m.id);
        setFirstUnread(unread.length ? Math.min(...unread) : null);
      }
    } catch (e) {
      if (denied(e)) {
        // Access removed (suspended, unassigned, portal closed): nothing stays on screen.
        setMessages([]);
        setCtx(null);
        setStatus('denied');
      } else setStatus((s) => (s === 'loading' ? 'error' : s));
    }
  }, [api, applicationId, me, merge]);

  useEffect(() => {
    void sync();
    const unsubscribe = api.subscribe(applicationId, () => void sync());
    const reconcile = () => document.visibilityState === 'visible' && void sync();
    const poll = window.setInterval(reconcile, 20_000);
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('online', reconcile);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('online', reconcile);
    };
  }, [api, applicationId, sync]);

  // Everything on screen while the page is visible counts as read.
  const newest = messages[messages.length - 1]?.id ?? 0;
  useEffect(() => {
    if (!newest || newest <= lastMarked.current || document.visibilityState !== 'visible') return;
    lastMarked.current = newest;
    api.markRead(applicationId, newest).then(refresh).catch(() => { lastMarked.current = 0; });
  }, [newest, api, applicationId, refresh]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom.current) setShowJump(false);
  };
  const toBottom = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setShowJump(false);
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || status !== 'ready') return;
    if (anchor.current != null) {
      el.scrollTop += el.scrollHeight - anchor.current; // older messages added above: keep the view still
      anchor.current = null;
    } else if (initial.current) {
      initial.current = false;
      const divider = el.querySelector('[data-unread-divider]');
      if (divider) divider.scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
      onScroll();
    } else if (atBottom.current || stickNext.current) {
      toBottom();
    } else setShowJump(true);
    stickNext.current = false;
  }, [messages, pending.length, status]);

  useEffect(() => {
    if (status === 'ready') input.current?.focus();
  }, [status]);

  const loadOlder = async () => {
    const oldest = messages[0]?.id;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const rows = await api.messages(applicationId, { before: oldest, limit: PAGE });
      anchor.current = box.current?.scrollHeight ?? null;
      merge(rows);
      setHasOlder(rows.length === PAGE);
    } catch {
      /* the button stays, so the user can try again */
    } finally {
      setLoadingOlder(false);
    }
  };

  const deliver = async (p: Pending) => {
    try {
      const saved = await api.send(applicationId, p.body, p.clientId);
      stickNext.current = true;
      merge([saved]);
      refresh();
    } catch (e) {
      setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, state: 'failed', reason: errorText(e) } : x)));
      if (denied(e)) void sync();
    }
  };

  const submit = () => {
    const body = text.trim();
    if (!body || body.length > MAX_LENGTH) return;
    // The id is made once per message and reused on retry, so a retry cannot create a duplicate.
    const p: Pending = { clientId: crypto.randomUUID(), body, state: 'sending' };
    stickNext.current = true;
    setPending((list) => [...list, p]);
    setText('');
    input.current?.focus();
    void deliver(p);
  };
  const retry = (p: Pending) => {
    const again = { ...p, state: 'sending' as const, reason: undefined };
    setPending((list) => list.map((x) => (x.clientId === p.clientId ? again : x)));
    void deliver(again);
  };

  // Auto-growing composer, up to about six lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [text]);

  const lastSeenByOthers = useMemo(() => {
    const others = (ctx?.reads ?? []).filter((r) => r.userId !== me);
    return (id: number) => others.filter((r) => r.lastReadId >= id).map((r) => r.name);
  }, [ctx?.reads, me]);
  const lastMine = useMemo(() => [...messages].reverse().find((m) => m.senderId === me)?.id, [messages, me]);
  const tooLong = text.trim().length > MAX_LENGTH;

  return (
    <Modal open size="lg" onClose={closeChat} title={ctx ? ctx.student : 'Messages'} subtitle={ctx ? `Private conversation · ${ctx.ref}` : undefined}>
      <div className="-mx-6 -my-5 flex h-[calc(92vh-92px)] flex-col sm:h-[min(70vh,640px)]">
        {ctx && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-canvas/60 px-6 py-2.5 text-xs text-ink-soft">
            <span className="min-w-0"><b className="font-semibold text-heading">{ctx.university ?? '—'}</b></span>
            <span className="min-w-0">{ctx.course ?? '—'}</span>
            <span className="whitespace-nowrap">Intake: <b className="font-semibold text-heading">{ctx.intake}</b></span>
            <span className="ml-auto"><Badge tone={appStatusTone[ctx.status as AppStatus]} dot>{ctx.status}</Badge></span>
          </div>
        )}

        <div ref={box} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" role="log" aria-live="polite" aria-label="Conversation">
          {status === 'loading' && (
            <div className="flex h-full items-center justify-center" role="status" aria-label="Loading messages"><Loader2 className="h-6 w-6 animate-spin text-rust" /></div>
          )}
          {status === 'denied' && (
            <EmptyState icon={Lock} title="You don't have access to this conversation" description="Only the people working on this application can read it." />
          )}
          {status === 'error' && (
            <EmptyState icon={MessagesSquare} title="The conversation could not be loaded" description="Check your connection." action={<Button variant="secondary" icon={RotateCw} onClick={() => void sync()}>Try again</Button>} />
          )}
          {status === 'ready' && messages.length === 0 && pending.length === 0 && (
            <EmptyState icon={MessagesSquare} title="No messages yet" description="Ask about documents, the offer, CAS or visa progress. Everyone working on this application will see it." />
          )}
          {status === 'ready' && hasOlder && (
            <div className="mb-4 text-center">
              <Button size="sm" variant="secondary" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</Button>
            </div>
          )}
          {messages.map((m, i) => {
            const mine = m.senderId === me;
            const prev = messages[i - 1];
            const newDay = !prev || day(prev.createdAt) !== day(m.createdAt);
            const grouped = !!prev && !newDay && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300_000 && m.id !== firstUnread;
            const seen = mine ? lastSeenByOthers(m.id) : [];
            return (
              <div key={m.id}>
                {newDay && <div className="my-4 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{day(m.createdAt)}</div>}
                {m.id === firstUnread && (
                  <div data-unread-divider className="my-3 flex items-center gap-3 text-[11px] font-semibold text-rust">
                    <span className="h-px flex-1 bg-rust/30" />New messages<span className="h-px flex-1 bg-rust/30" />
                  </div>
                )}
                <div className={cn('flex gap-2.5', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-1' : 'mt-3')}>
                  {!mine && (grouped ? <span className="w-8 shrink-0" /> : <Avatar name={m.senderName} size={32} className="shrink-0" />)}
                  <div className={cn('flex min-w-0 max-w-[82%] flex-col sm:max-w-[72%]', mine ? 'items-end' : 'items-start')}>
                    {!grouped && (
                      <div className={cn('mb-1 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px]', mine && 'justify-end')}>
                        <span className="font-semibold text-heading">{mine ? 'You' : m.senderName}</span>
                        <span className="text-ink-mute">{roleLabel(m.senderRole)}{!mine && ` · ${m.senderOrg}`}</span>
                      </div>
                    )}
                    <div className={cn('whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]', mine ? 'rounded-tr-md bg-navy text-white dark:bg-navy-500' : 'rounded-tl-md bg-canvas text-heading ring-1 ring-line')}>{m.body}</div>
                    <div className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-mute">
                      <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>{time(m.createdAt)}</time>
                      {mine && (
                        <Tooltip content={seen.length ? `Seen by ${seen.join(', ')}` : 'Delivered'}>
                          <span className="inline-flex items-center gap-1" aria-label={seen.length ? `Seen by ${seen.join(', ')}` : 'Delivered'}>
                            {seen.length ? <CheckCheck className="h-3.5 w-3.5 text-brand-600 dark:text-brand" /> : <Check className="h-3.5 w-3.5" />}
                            {m.id === lastMine && seen.length > 0 && <span>Seen by {seen.length > 2 ? `${seen.length} people` : seen.join(', ')}</span>}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {pending.map((p) => (
            <div key={p.clientId} className="mt-3 flex justify-end">
              <div className="flex max-w-[82%] flex-col items-end sm:max-w-[72%]">
                <div className={cn('whitespace-pre-wrap break-words rounded-2xl rounded-tr-md px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]', p.state === 'failed' ? 'bg-red-50 text-red-900 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-100 dark:ring-red-500/30' : 'bg-navy/75 text-white dark:bg-navy-500/70')}>{p.body}</div>
                {p.state === 'sending' ? (
                  <div className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-mute" role="status"><Loader2 className="h-3 w-3 animate-spin" /> Sending…</div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center justify-end gap-x-2 text-[11px]" role="alert">
                    <span className="text-red-600 dark:text-red-400">{p.reason}</span>
                    <button type="button" onClick={() => retry(p)} className="inline-flex items-center gap-1 font-semibold text-rust hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"><RotateCw className="h-3 w-3" /> Retry</button>
                    <button type="button" onClick={() => setPending((l) => l.filter((x) => x.clientId !== p.clientId))} className="inline-flex items-center gap-1 font-semibold text-ink-soft hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"><X className="h-3 w-3" /> Remove</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {showJump && (
          <div className="pointer-events-none relative h-0 text-center">
            <button type="button" onClick={toBottom} className="pointer-events-auto absolute -top-12 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow-lift dark:bg-navy-500">
              <ArrowDown className="h-3.5 w-3.5" /> New messages
            </button>
          </div>
        )}

        {status !== 'denied' && (
          <div className="border-t border-line bg-surface px-4 py-3 sm:px-6">
            {tooLong && <Alert tone="warning" className="mb-2">Messages can be up to {MAX_LENGTH} characters ({text.trim().length} now).</Alert>}
            <div className="flex items-end gap-2">
              <textarea
                ref={input}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                disabled={status !== 'ready'}
                placeholder="Write a message…"
                aria-label="Message"
                className="min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm leading-snug text-heading placeholder:text-ink-mute focus:border-brand focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:opacity-60"
              />
              <Button icon={Send} onClick={submit} disabled={status !== 'ready' || !text.trim() || tooLong} aria-label="Send message" className="h-[42px]">
                <span className="hidden sm:inline">Send</span>
              </Button>
            </div>
            <p className="mt-1.5 hidden text-[11px] text-ink-mute sm:block">Enter to send · Shift + Enter for a new line</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Messages action for any application row, card or popup. Hidden when the server gives no access. */
export function ChatButton({ applicationId, label = false, className }: { applicationId: string; label?: boolean; className?: string }) {
  const { chats, openChat } = useChat();
  const c = chats[applicationId];
  if (!c) return null;
  const name = c.unread ? `Messages, ${c.unread} unread` : 'Messages';
  const open = (e: React.MouseEvent) => {
    // Inside clickable rows: only this conversation opens, the row action does not run.
    e.stopPropagation();
    e.preventDefault();
    openChat(applicationId);
  };
  if (label) {
    return (
      <Button variant="secondary" icon={MessagesSquare} onClick={open} className={className}>
        Messages
        {c.unread > 0 && <span className="ml-1 rounded-full bg-rust px-1.5 text-[10.5px] font-bold text-white">{c.unread > 99 ? '99+' : c.unread}</span>}
      </Button>
    );
  }
  return (
    <Tooltip content={c.unread ? `${c.unread} unread message${c.unread === 1 ? '' : 's'}` : c.total ? 'Messages' : 'Start a conversation'}>
      <button
        type="button"
        onClick={open}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={name}
        className={cn(
          'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
          c.unread ? 'border-brand-300 bg-brand-50 text-rust dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line bg-surface text-ink-soft hover:border-brand-300 hover:text-rust',
          className,
        )}
      >
        <MessagesSquare className="h-[17px] w-[17px]" />
        {c.unread > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-rust px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-surface">{c.unread > 99 ? '99+' : c.unread}</span>}
      </button>
    </Tooltip>
  );
}
