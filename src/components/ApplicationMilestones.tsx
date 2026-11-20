// Tuition deposit and CAS milestones of an application (0056). Each state is counted once per
// application in the Daily Work Report of whoever recorded it; every change is kept in the history.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Field, Select } from './ui';
import { useToast } from './feedback';
import { useStore } from '../store/store';
import { supabase } from '../auth/auth';
import { fmtWhen } from '../lib/agencies';
import { leadRpc } from '../lib/leads';

export const DEPOSIT: Record<string, string> = { not_started: 'Not started', requested: 'Deposit requested', partly_paid: 'Partly paid', paid: 'Paid (completed)' };
export const CAS: Record<string, string> = { not_started: 'Not started', requested: 'CAS requested', in_progress: 'CAS in progress', issued: 'CAS received' };
interface Event { id: number; milestone: 'deposit' | 'cas'; from_value: string | null; to_value: string; note: string | null; actor: string | null; at: string }

export function ApplicationMilestones({ applicationId, deposit, cas }: { applicationId: string; deposit?: string; cas?: string }) {
  const { db, session } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [events, setEvents] = useState<Event[] | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return setEvents([]);
    const { data, error } = await supabase.from('application_milestones').select('*').eq('application_id', applicationId).order('at', { ascending: false }).limit(50);
    if (error) { setMissing(true); return; }
    setEvents((data ?? []) as Event[]);
  }, [applicationId]);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const sb = supabase;
    const ch = sb.channel(`app-ms-${applicationId}-${Math.random().toString(36).slice(2, 6)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'application_milestones', filter: `application_id=eq.${applicationId}` }, () => void load()).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load, applicationId]);
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee') : '—');
  const set = async (milestone: 'deposit' | 'cas', value: string) => {
    setBusy(milestone);
    const r = await leadRpc<{ unchanged?: boolean }>('set_application_milestone', { p_app: applicationId, p_milestone: milestone, p_value: value, p_note: null });
    setBusy('');
    if (!r.ok) return toast.error('Not saved', r.error);
    if (!r.data?.unchanged) toast.success(milestone === 'deposit' ? `Tuition deposit: ${DEPOSIT[value]}` : `CAS: ${CAS[value]}`);
    void load();
  };
  if (missing) return <Alert tone="warning">Run migration 0056 to track deposit and CAS milestones.</Alert>;
  return (
    <section className="rounded-2xl border border-line p-5">
      <h4 className="mb-4 font-display text-sm font-semibold text-heading">Deposit &amp; CAS</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tuition deposit"><Select value={deposit ?? 'not_started'} disabled={busy === 'deposit'} onChange={(e) => void set('deposit', e.target.value)}>
          {Object.entries(DEPOSIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="CAS"><Select value={cas ?? 'not_started'} disabled={busy === 'cas'} onChange={(e) => void set('cas', e.target.value)}>
          {Object.entries(CAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      {events && events.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-soft">
          {events.slice(0, 6).map((e) => (
            <li key={e.id}>{e.milestone === 'deposit' ? 'Deposit' : 'CAS'}: {(e.milestone === 'deposit' ? DEPOSIT : CAS)[e.to_value] ?? e.to_value} · {staffName(e.actor)} · {fmtWhen(e.at)}</li>
          ))}
        </ul>
      )}
      {events && events.length === 0 && <p className="mt-2 text-xs text-ink-mute">Each milestone is counted once in the Daily Work Report of whoever records it.</p>}
    </section>
  );
}
