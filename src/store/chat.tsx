// Application chat: which conversations this user may open, their unread counts, and the one
// chat window (rendered here, so every entry point opens the same conversation in place without
// changing page, portal or any form state). The server decides access: an application missing
// from my_application_chats() has no chat for this user. Realtime events only mean "something
// changed"; the data is always re-read through RLS.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../auth/auth';
import { useStore } from './store';
import ChatWindow from '../components/ApplicationChat';

export interface ChatSummary {
  unread: number;
  total: number;
  lastMessageAt: string | null;
}
export interface ChatMessage {
  id: number;
  applicationId: string;
  senderId: string | null;
  senderName: string;
  senderRole: string;
  senderOrg: string;
  body: string;
  clientId: string;
  createdAt: string;
}
export interface ChatContextInfo {
  id: string;
  ref: string;
  status: string;
  intake: string;
  student: string;
  university: string | null;
  course: string | null;
  partner: string | null;
  myLastReadId: number;
  reads: { userId: string; name: string; lastReadId: number }[];
}

/** Everything the chat needs from the backend (a development harness can supply its own). */
export interface ChatApi {
  summaries(): Promise<Record<string, ChatSummary>>;
  context(applicationId: string): Promise<ChatContextInfo>;
  messages(applicationId: string, opts: { before?: number; limit: number }): Promise<ChatMessage[]>;
  send(applicationId: string, body: string, clientId: string): Promise<ChatMessage>;
  markRead(applicationId: string, upto: number): Promise<void>;
  /** Calls back on any visible change or reconnection; returns an unsubscribe function. */
  subscribe(applicationId: string | null, onChange: () => void): () => void;
}

const toMessage = (r: Record<string, unknown>): ChatMessage => ({
  id: Number(r.id), applicationId: r.application_id as string, senderId: (r.sender_id as string) ?? null, senderName: r.sender_name as string,
  senderRole: r.sender_role as string, senderOrg: r.sender_org as string, body: r.body as string, clientId: r.client_id as string, createdAt: r.created_at as string,
});

const supabaseApi: ChatApi = {
  async summaries() {
    const { data, error } = await supabase!.rpc('my_application_chats');
    if (error) throw error;
    const out: Record<string, ChatSummary> = {};
    for (const r of (data ?? []) as { application_id: string; unread: number; total: number; last_message_at: string | null }[])
      out[r.application_id] = { unread: Number(r.unread), total: Number(r.total), lastMessageAt: r.last_message_at };
    return out;
  },
  async context(applicationId) {
    const { data, error } = await supabase!.rpc('application_chat_context', { p_application: applicationId });
    if (error) throw error;
    return data as ChatContextInfo;
  },
  async messages(applicationId, { before, limit }) {
    let q = supabase!.from('application_messages').select('id, application_id, sender_id, sender_name, sender_role, sender_org, body, client_id, created_at').eq('application_id', applicationId);
    if (before) q = q.lt('id', before);
    const { data, error } = await q.order('id', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map(toMessage);
  },
  async send(applicationId, body, clientId) {
    const { data, error } = await supabase!.rpc('send_application_message', { p_application: applicationId, p_body: body, p_client_id: clientId });
    if (error) throw error;
    return toMessage(data as Record<string, unknown>);
  },
  async markRead(applicationId, upto) {
    const { error } = await supabase!.rpc('mark_application_chat_read', { p_application: applicationId, p_upto: upto });
    if (error) throw error;
  },
  subscribe(applicationId, onChange) {
    if (!supabase) return () => undefined;
    const sb = supabase;
    const tag = `${applicationId ?? 'all'}-${Math.random().toString(36).slice(2, 8)}`;
    const filter = applicationId ? { filter: `application_id=eq.${applicationId}` } : {};
    const channels = ['application_messages', 'application_chat_reads'].map((table) => {
      let seen = false;
      return sb
        .channel(`chat-${table}-${tag}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, ...filter }, () => onChange())
        .subscribe((s) => {
          // Coming back after a dropped connection: re-read whatever was missed.
          if (s === 'SUBSCRIBED') {
            if (seen) onChange();
            seen = true;
          }
        });
    });
    return () => channels.forEach((c) => void sb.removeChannel(c));
  },
};

interface ChatValue {
  api: ChatApi;
  chats: Record<string, ChatSummary>;
  totalUnread: number;
  openId: string | null;
  openChat: (applicationId: string) => void;
  closeChat: () => void;
  refresh: () => void;
  /** Unsent text per application, kept while the window is closed. */
  drafts: React.MutableRefObject<Record<string, string>>;
}

const noop = () => undefined;
const ChatCtx = createContext<ChatValue>({
  api: supabaseApi, chats: {}, totalUnread: 0, openId: null, openChat: noop, closeChat: noop, refresh: noop, drafts: { current: {} },
});
export const useChat = () => useContext(ChatCtx);

export function ChatProvider({ children, api = supabaseApi }: { children: ReactNode; api?: ChatApi }) {
  const { session, db } = useStore();
  const userId = session?.userId;
  const [chats, setChats] = useState<Record<string, ChatSummary>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const drafts = useRef<Record<string, string>>({});

  const timer = useRef(0);
  const load = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.summaries().then(setChats).catch(() => undefined); // keeps the last known counts when offline
    }, 200);
  }, [api]);

  useEffect(() => {
    drafts.current = {};
    setOpenId(null);
    setChats({});
    if (!userId) return;
    load();
    const unsubscribe = api.subscribe(null, load);
    // Safety net: events are not the only source of truth.
    const reconcile = () => document.visibilityState === 'visible' && load();
    const poll = window.setInterval(reconcile, 60_000);
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('online', reconcile);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('online', reconcile);
    };
  }, [userId, api, load]);

  // A new application or (re)assignment changes which conversations are available.
  const appKey = db.applications.map((a) => `${a.id}:${a.assignedTo ?? ''}`).join('|');
  useEffect(() => {
    if (userId) load();
  }, [appKey, userId, load]);

  const value = useMemo<ChatValue>(
    () => ({
      api, chats, drafts, openId, refresh: load,
      totalUnread: Object.values(chats).reduce((s, c) => s + c.unread, 0),
      openChat: setOpenId,
      closeChat: () => setOpenId(null),
    }),
    [api, chats, openId, load],
  );
  return (
    <ChatCtx.Provider value={value}>
      {children}
      {openId && <ChatWindow key={openId} applicationId={openId} />}
    </ChatCtx.Provider>
  );
}
