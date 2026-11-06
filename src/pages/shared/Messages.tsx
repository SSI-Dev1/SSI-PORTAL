// Messages: every application conversation this user may open, in any portal. It is a list of
// the same per-application chats (store/chat.tsx); a row opens that conversation in place, in the
// centred chat window, without leaving this page. The list comes from the server
// (my_application_chat_inbox), so it holds only applications this user is allowed to see, and
// it refreshes whenever the unread counts change (realtime).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, MessagesSquare, RotateCw } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, SearchInput, Tabs } from '../../components/ui';
import { ChatButton } from '../../components/ApplicationChat';
import { useChat, type ChatInboxRow } from '../../store/chat';
import { useScoped } from '../../store/store';
import { appStatusTone, cn, timeAgo } from '../../lib/utils';
import type { AppStatus } from '../../data/types';

type View = 'active' | 'all';

export default function Messages() {
  const scoped = useScoped();
  const { api, chats, openChat, totalUnread } = useChat();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('active');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ChatInboxRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  // A link such as …/messages?chat=<application id> opens that conversation here.
  useEffect(() => {
    const c = params.get('chat');
    if (c) {
      openChat(c);
      params.delete('chat');
      setParams(params, { replace: true });
    }
  }, [params, setParams, openChat]);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  // Re-read when the counts change: a new message anywhere moves its conversation to the top.
  const countsKey = useMemo(
    () => Object.entries(chats).map(([id, c]) => `${id}:${c.total}:${c.unread}`).sort().join('|'),
    [chats],
  );
  const load = () => {
    const n = ++request.current;
    api
      .inbox({ search: query, all: view === 'all', limit: 200 })
      .then((r) => {
        if (n !== request.current) return; // an older request finished late
        setRows(r);
        setFailed(false);
      })
      .catch(() => n === request.current && setFailed(true));
  };
  useEffect(load, [api, query, view, countsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const showPartner = scoped.isAdmin; // internal portals see which partner it belongs to

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Messages"
        subtitle="One private conversation per application, shared by everyone working on it."
      />
      <Card>
        <div className="flex flex-col gap-3 px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <Tabs<View>
            className="border-b-0"
            value={view}
            onChange={setView}
            tabs={[
              { value: 'active', label: 'Conversations', count: totalUnread || undefined },
              { value: 'all', label: 'All applications' },
            ]}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Search student, reference, university…" className="w-full pb-3 sm:w-80" />
        </div>
        <div className="border-t border-line">
          {rows === null && !failed && (
            <div className="flex justify-center py-14" role="status" aria-label="Loading conversations"><Loader2 className="h-6 w-6 animate-spin text-rust" /></div>
          )}
          {failed && rows === null && (
            <EmptyState icon={MessagesSquare} title="Conversations could not be loaded" description="Check your connection." action={<Button variant="secondary" icon={RotateCw} onClick={load}>Try again</Button>} />
          )}
          {rows && rows.length === 0 && (
            <EmptyState
              icon={MessagesSquare}
              title={query ? 'No matches' : view === 'active' ? 'No conversations yet' : 'No applications to show'}
              description={view === 'active' && !query ? 'Open "All applications" to start a conversation about one of your applications.' : undefined}
            />
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const live = chats[r.applicationId];
                const unread = live?.unread ?? r.unread;
                return (
                  <li key={r.applicationId} className={cn('flex items-center gap-2 pr-4 transition hover:bg-canvas', unread > 0 && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                    <button type="button" onClick={() => openChat(r.applicationId)} className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5 text-left">
                      <Avatar name={r.student} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={cn('truncate text-sm text-heading', unread > 0 ? 'font-bold' : 'font-semibold')}>{r.student}</span>
                          <span className="shrink-0 text-xs text-ink-mute">{r.ref}</span>
                        </span>
                        <span className="block truncate text-xs text-ink-soft">
                          {[r.university, r.course, r.intake].filter(Boolean).join(' · ')}
                          {showPartner && r.partner ? ` · ${r.partner}` : ''}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-mute">
                          {r.lastMessageAt ? `${r.lastSender ?? 'Someone'} · ${timeAgo(r.lastMessageAt)}` : 'No messages yet'}
                        </span>
                      </span>
                      <span className="hidden sm:block"><Badge tone={appStatusTone[r.status as AppStatus]} dot>{r.status}</Badge></span>
                    </button>
                    <ChatButton applicationId={r.applicationId} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
