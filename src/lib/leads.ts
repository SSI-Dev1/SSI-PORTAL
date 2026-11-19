// Lead Management (0056): prospective students from first inquiry to the Student List. Every change
// goes through a server function (permission, validation, history and report credit happen there);
// the browser only reads what row-level security allows and listens for realtime changes.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../auth/auth';
import { serverMessage } from '../data/hr';
import type { Tone } from './utils';
import type { ContactStatus } from './agencies';

export type LeadStage = 'cold' | 'warm' | 'converted' | 'closed';
export type LeadQueue = 'pending' | 'no_response' | 'in_progress' | 'converted' | 'closed';
export type LeadSource = 'direct' | 'partner' | 'website' | 'walk_in' | 'social' | 'referral' | 'event' | 'other';

export interface Lead {
  id: string; reference: string; name: string; phone: string | null; email: string | null; qualification: string | null; application_details: string | null;
  partner_id: string | null; source: LeadSource; contact_status: ContactStatus; contact_changed_by: string | null; contact_changed_at: string | null;
  stage: LeadStage; stage_changed_by: string | null; stage_changed_at: string | null; no_response: boolean; no_response_at: string | null;
  assigned_to: string | null; created_by: string | null; created_at: string; updated_at: string; student_id: string | null; converted_by: string | null; converted_at: string | null;
  /** Kept by triggers (0056): latest contact event and earliest open follow-up. */
  last_contact_at?: string | null; next_follow_up?: string | null;
}
export interface LeadActivity { id: number; lead_id: string; kind: string; outcome: string | null; note: string | null; detail: Record<string, unknown>; actor: string | null; at: string }
export interface LeadTask {
  id: string; lead_id: string; due_date: string; due_time: string | null; note: string | null; status: 'open' | 'done' | 'cancelled';
  assigned_to: string | null; created_by: string | null; created_at: string; completed_at: string | null; carry_count: number;
}

export const LEAD_STAGE: Record<LeadStage, { label: string; tone: Tone; hint: string }> = {
  cold: { label: 'Cold', tone: 'blue', hint: 'Early stage: limited engagement or interest so far.' },
  warm: { label: 'Warm', tone: 'amber', hint: 'Progressing towards counselling or conversion.' },
  converted: { label: 'Converted', tone: 'green', hint: 'Moved to the Student List.' },
  closed: { label: 'Closed', tone: 'slate', hint: 'Explicitly closed. The record and history are kept and it can be reopened.' },
};
export const LEAD_QUEUE: Record<LeadQueue, { label: string; tone: Tone; hint: string }> = {
  pending: { label: 'Pending', tone: 'amber', hint: 'Not connected yet' },
  no_response: { label: 'No response', tone: 'red', hint: 'Recorded as not responding' },
  in_progress: { label: 'In progress', tone: 'blue', hint: 'Connected, still being counselled' },
  converted: { label: 'Converted', tone: 'green', hint: 'In the Student List' },
  closed: { label: 'Closed', tone: 'slate', hint: 'Closed leads' },
};
export const LEAD_SOURCE: Record<LeadSource, string> = {
  direct: 'Direct', partner: 'Partner agency', website: 'Website', walk_in: 'Walk-in', social: 'Social media', referral: 'Referral', event: 'Event / fair', other: 'Other',
};
export const ATTEMPT_OUTCOME = { no_answer: 'No answer', busy: 'Busy', switched_off: 'Switched off / unreachable', wrong_number: 'Wrong number', message_sent: 'Message sent', callback_requested: 'Asked to call back', other: 'Other' } as const;
export const CALL_OUTCOME = { interested: 'Interested', needs_time: 'Needs time to decide', not_interested: 'Not interested', information_shared: 'Information shared', other: 'Other' } as const;
export const LEAD_ACTIVITY: Record<string, string> = {
  created: 'Lead added', edited: 'Details edited', contact_status: 'Contact status', contact_correction: 'Contact status corrected', contact_attempt: 'Contact attempt',
  call_done: 'Call done', follow_up_done: 'Follow-up done', follow_up_added: 'Follow-up added', note: 'Note', no_response: 'No response', stage: 'Stage changed',
  converted: 'Moved to Student List', application: 'Application created',
};

/** The one current queue of a lead (same rule as the server's lead_queue()). */
export function leadQueue(l: Pick<Lead, 'stage' | 'contact_status' | 'no_response'>): LeadQueue {
  if (l.stage === 'converted') return 'converted';
  if (l.stage === 'closed') return 'closed';
  if (l.no_response) return 'no_response';
  return l.contact_status !== 'connected' ? 'pending' : 'in_progress';
}
export const agentName = (partnerId: string | null, name: (id: string) => string | undefined) => (partnerId && partnerId !== 'direct' ? name(partnerId) ?? 'Partner' : 'Direct');

export async function leadRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string; missing?: boolean; duplicate?: boolean }> {
  if (!supabase) return { ok: false, error: 'Not configured' };
  const { data, error } = await supabase.rpc(fn, args);
  if (!error) return { ok: true, data: data as T };
  if (/schema cache|does not exist/i.test(error.message)) return { ok: false, error: 'Lead Management is not set up on the server yet (run migration 0056).' };
  const msg = serverMessage(error);
  return { ok: false, error: msg.replace(/^(MISSING|DUPLICATE):\s*/, ''), missing: /^MISSING:/.test(msg), duplicate: /^DUPLICATE:/.test(msg) };
}

/** Harness only: sample data. */
export const LeadsDemo = createContext<{ leads: Lead[]; activities: LeadActivity[]; tasks: LeadTask[] } | null>(null);

function useLive<T>(load: () => Promise<T>, tables: string[], demo: T | null) {
  const [data, setData] = useState<T | null>(demo);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    try { setData(await load()); setError(null); } catch (e) { setError((e as Error).message); }
  }, [load]);
  useEffect(() => {
    void run();
    if (!supabase || demo) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void run(), 300); };
    const ch = sb.channel(`leads-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    ch.subscribe();
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  return { data, error, reload: run };
}

const fail = (m: string) => new Error(/leads|lead_|schema cache/i.test(m) ? 'Run migration 0056 to enable Lead Management.' : 'Leads could not be loaded.');

export function useLeads() {
  const demo = useContext(LeadsDemo);
  const load = useCallback(async () => {
    if (demo) return demo.leads;
    if (!supabase) return [];
    const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(2000);
    if (error) throw fail(error.message);
    return (data ?? []) as Lead[];
  }, [demo]);
  return useLive(load, ['leads'], demo?.leads ?? null);
}

/** Activity history and follow-ups of one lead (live). */
export function useLeadDetail(id: string) {
  const demo = useContext(LeadsDemo);
  const load = useCallback(async () => {
    if (demo) return { activities: demo.activities.filter((a) => a.lead_id === id), tasks: demo.tasks.filter((t) => t.lead_id === id) };
    if (!supabase) return { activities: [], tasks: [] };
    const [a, t] = await Promise.all([
      supabase.from('lead_activities').select('*').eq('lead_id', id).order('at', { ascending: false }).limit(300),
      supabase.from('lead_tasks').select('*').eq('lead_id', id).order('due_date', { ascending: true }).limit(200),
    ]);
    if (a.error || t.error) throw fail((a.error ?? t.error)!.message);
    return { activities: (a.data ?? []) as LeadActivity[], tasks: (t.data ?? []) as LeadTask[] };
  }, [demo, id]);
  return useLive(load, ['lead_activities', 'lead_tasks'], demo ? { activities: demo.activities.filter((a) => a.lead_id === id), tasks: demo.tasks.filter((t) => t.lead_id === id) } : null);
}
