// Partner Success (0047): the onboarded client directory (read-only), My Clients (Sub Officer = me,
// decided by the server from the session) and relationship activities on own clients.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../auth/auth';
import type { Session } from '../data/types';
import { rpc } from './agencies';

export interface DirectoryClient {
  key: string; partner_id: string | null; agency_id: string | null; name: string; country: string | null; city: string | null; agency_type: string | null;
  business_status: 'verified' | 'historical'; onboarded_on: string | null; main_officer_id: string | null; main_officer: string | null;
  sub_officer_id: string | null; sub_officer: string | null; mine: boolean; contact_name: string | null; phone: string | null; email: string | null;
}
export interface MyClient {
  key: string; partner_id: string | null; agency_id: string | null; name: string; country: string | null; city: string | null; agency_type: string | null;
  business_status: 'verified' | 'historical'; onboarded_on: string | null; main_officer: string | null; contact_name: string | null; phone: string | null; email: string | null;
  applications: number; pending: number; submitted: number; offers: number; visa_granted: number; last_activity: string | null; next_follow_up: string | null;
}
export interface ClientActivity {
  id: number; client_key: string; partner_id: string | null; agency_id: string | null; employee_id: string; kind: ClientActivityKind;
  outcome: 'completed' | 'pending' | 'no_response' | 'escalated' | null; note: string | null; next_follow_up: string | null; at: string;
}
export type ClientActivityKind = 'query' | 'training' | 'course_options' | 'admission_guidance' | 'follow_up' | 'meeting' | 'note';
export const CLIENT_ACTIVITY: Record<ClientActivityKind, { label: string; report?: string }> = {
  query: { label: 'Partner query handled', report: 'Partner queries' }, training: { label: 'Training conducted', report: 'Training sessions' },
  course_options: { label: 'Course options suggested', report: 'Options suggested' }, admission_guidance: { label: 'Admission guidance given', report: 'Admission guidance' },
  follow_up: { label: 'Relationship follow-up' }, meeting: { label: 'Meeting / visit' }, note: { label: 'Note' },
};
export const OUTCOME = { completed: 'Completed', pending: 'Pending', no_response: 'No response', escalated: 'Escalated' } as const;

/** Partner Success workspace: My Clients work, no partnership development. */
export function partnerSuccessFocused(s: Session | null) {
  return !!s && s.role !== 'client' && s.userRole !== 'super_admin' && s.permissions.includes('partner_success') && !s.permissions.includes('agency_outreach');
}

/** Harness only: sample data. */
export const ClientsDemo = createContext<{ directory: DirectoryClient[]; mine: MyClient[]; activities: ClientActivity[]; portfolio: Portfolio } | null>(null);
export interface Portfolio { mine: Record<string, number>; team: Record<string, number> & { by_sub?: { name: string; agencies: number; applications: number; offers: number }[] }; today: { applications: number; offers: number; agencies: number } }

function useLive<T>(load: () => Promise<T>, tables: string[], initial: T | null) {
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    try { setData(await load()); setError(null); } catch (e) { setError((e as Error).message); }
  }, [load]);
  useEffect(() => {
    void run();
    if (!supabase || initial) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void run(), 300); };
    const ch = sb.channel(`clients-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    ch.subscribe();
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  return { data, error, reload: run };
}
const call = async <T,>(fn: string, args: Record<string, unknown> = {}) => {
  const r = await rpc<T>(fn, args);
  if (!r.ok) throw new Error(/schema cache|does not exist/i.test(r.error) ? 'Run migration 0047 to enable My Clients.' : r.error);
  return r.data;
};
// Realtime: these tables only deliver rows the user may read (RLS), so nothing leaks to other officers.
const LIVE = ['partners', 'application_attribution', 'client_activities', 'applications'];

export function useClientDirectory() {
  const demo = useContext(ClientsDemo);
  const load = useCallback(async () => (demo ? demo.directory : call<DirectoryClient[]>('onboarded_client_directory')), [demo]);
  return useLive(load, LIVE, demo?.directory ?? null);
}
export function useMyClients() {
  const demo = useContext(ClientsDemo);
  const load = useCallback(async () => (demo ? demo.mine : call<MyClient[]>('my_clients')), [demo]);
  return useLive(load, LIVE, demo?.mine ?? null);
}
export function usePortfolio() {
  const demo = useContext(ClientsDemo);
  const load = useCallback(async () => {
    if (demo) return demo.portfolio;
    const [p, d] = await Promise.all([call<{ mine: Record<string, number>; team: Portfolio['team'] }>('portfolio_performance', {}), call<Portfolio['today']>('portfolio_day', {})]);
    return { mine: p?.mine ?? {}, team: p?.team ?? {}, today: d } as Portfolio;
  }, [demo]);
  return useLive(load, LIVE, demo?.portfolio ?? null);
}
export function useClientActivities(key?: string) {
  const demo = useContext(ClientsDemo);
  const load = useCallback(async () => {
    if (demo) return demo.activities.filter((a) => !key || a.client_key === key);
    if (!supabase) return [];
    let q = supabase.from('client_activities').select('*').order('at', { ascending: false }).limit(500);
    if (key) q = q.eq('client_key', key);
    const { data, error } = await q;
    if (error) throw new Error(/client_activities/.test(error.message) ? 'Run migration 0047 to enable client activities.' : 'Activities could not be loaded.');
    return (data ?? []) as ClientActivity[];
  }, [demo, key]);
  return useLive(load, ['client_activities'], demo ? demo.activities.filter((a) => !key || a.client_key === key) : null);
}
