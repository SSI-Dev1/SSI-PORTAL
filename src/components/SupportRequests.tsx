// Support Required (0056): an employee raises a request from the Daily Work Report; it is shown to their
// reporting manager and, when still open after the Admin-configured number of hours, escalated to
// that manager once (Super Admins when there is no manager). Managers resolve with a note.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, LifeBuoy, Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Textarea } from './ui';
import { useToast } from './feedback';
import { useStore } from '../store/store';
import { supabase } from '../auth/auth';
import { fmtWhen } from '../lib/agencies';
import { leadRpc } from '../lib/leads';

export interface SupportRequest {
  id: string; employee_id: string; manager_id: string | null; title: string; details: string | null; status: 'open' | 'resolved' | 'cancelled';
  created_at: string; escalated_at: string | null; escalated_to: string[] | null; resolved_at: string | null; resolved_by: string | null; resolution: string | null;
}

/** Changes counter for the pending-work queue (lead follow-ups, agency tasks, support requests). */
export function useQueueRev(enabled: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled || !supabase) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(t); t = setTimeout(() => setN((x) => x + 1), 400); };
    const ch = sb.channel(`queue-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of ['lead_tasks', 'support_requests', 'agency_tasks']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, bump);
    ch.subscribe();
    return () => { clearTimeout(t); void sb.removeChannel(ch); };
  }, [enabled]);
  return n;
}

export function RaiseSupport({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const save = async () => {
    if (title.trim().length < 3) return setErr('Describe what you need help with.');
    setBusy(true); setErr('');
    const r = await leadRpc('raise_support_request', { p_title: title, p_details: details || null, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success('Support request sent', 'Your reporting manager can see it.');
    onDone?.(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Support required" dirty={!!title || !!details}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} loading={busy} onClick={() => void save()}>Send request</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="space-y-4">
        <Field label="What do you need?" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Access to the UCAS portal" /></Field>
        <Field label="Details"><Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={4000} /></Field>
        <p className="text-xs text-ink-mute">It goes to your reporting manager and stays open until it is resolved. If it stays open longer than the company rule, it is escalated automatically.</p>
      </div>
    </Modal>
  );
}

function useTeamSupportRequests() {
  const { session } = useStore();
  const [rows, setRows] = useState<SupportRequest[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!supabase) return setRows([]);
    const { data, error: e } = await supabase.from('support_requests').select('*').neq('employee_id', session?.userId ?? '').order('created_at', { ascending: false }).limit(200);
    if (e) { setError(/support_requests|schema cache/.test(e.message) ? 'Run migration 0056 to enable support requests.' : 'Support requests could not be loaded.'); return; }
    setError(''); setRows((data ?? []) as SupportRequest[]);
  }, [session?.userId]);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const sb = supabase;
    const ch = sb.channel(`support-team-${Math.random().toString(36).slice(2, 6)}`).on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, () => void load()).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load]);
  return { rows, error };
}

/** Manager / Super Admin queue: open requests of the team, escalated first. */
export function TeamSupportQueue() {
  const { db, session } = useStore();
  const { rows, error } = useTeamSupportRequests();
  const [resolving, setResolving] = useState<SupportRequest | null>(null);
  const name = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? 'Employee' : '—');
  const open = (rows ?? []).filter((r) => r.status === 'open').sort((a, b) => Number(!!b.escalated_at) - Number(!!a.escalated_at) || a.created_at.localeCompare(b.created_at));
  const closed = (rows ?? []).filter((r) => r.status !== 'open').slice(0, 5);
  return (
    <Card className="mb-5">
      <CardHeader title="Support requests" subtitle="Raised by your team from their Daily Work Report. Escalated requests come first." />
      <div className="px-5 pb-5">
        {error && <Alert tone="warning">{error}</Alert>}
        {session?.userRole === 'super_admin' && <EscalationRule />}
        {!rows ? <p className="text-sm text-ink-soft" role="status">Loading…</p> : open.length === 0 ? (
          <EmptyState icon={LifeBuoy} title="No open support requests" />
        ) : (
          <ul className="space-y-2">
            {open.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-heading">{r.title}
                    {r.escalated_at && <Badge tone="red" dot>Escalated {fmtWhen(r.escalated_at)}</Badge>}</div>
                  {r.details && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">{r.details}</p>}
                  <div className="mt-1 text-xs text-ink-mute">{name(r.employee_id)} · raised {fmtWhen(r.created_at)}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setResolving(r)}>Resolve</Button>
              </li>
            ))}
          </ul>
        )}
        {closed.length > 0 && <p className="mt-3 text-xs text-ink-mute">Recently closed: {closed.map((r) => `${r.title} (${r.status})`).join(' · ')}</p>}
      </div>
      {resolving && <ResolveSupport r={resolving} onClose={() => setResolving(null)} />}
    </Card>
  );
}

function ResolveSupport({ r, onClose }: { r: SupportRequest; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!note.trim()) return setErr('Write how it was resolved.');
    setBusy(true);
    const res = await leadRpc('resolve_support_request', { p_id: r.id, p_status: 'resolved', p_note: note });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    toast.success('Support request resolved', 'The employee is notified.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Resolve support request" subtitle={r.title} dirty={!!note}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} loading={busy} onClick={() => void save()}>Mark resolved</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <Field label="Resolution" required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus /></Field>
    </Modal>
  );
}

function EscalationRule() {
  const toast = useToast();
  const [hours, setHours] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    void supabase.from('support_escalation_policy').select('hours').maybeSingle().then(({ data }) => setHours(data?.hours ? String(data.hours) : ''));
  }, []);
  if (hours === null) return null;
  const save = async (v: string) => {
    setBusy(true);
    const r = await leadRpc('set_support_escalation_hours', { p_hours: v ? Number(v) : null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    setHours(v); toast.success(v ? `Open requests escalate after ${v} hours` : 'Automatic escalation is off');
  };
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-canvas p-3">
      <Field label="Escalate to the team manager after"><Select value={hours} disabled={busy} onChange={(e) => void save(e.target.value)}>
        <option value="">Off (no automatic escalation)</option>
        {[2, 4, 8, 24, 48, 72].map((h) => <option key={h} value={String(h)}>{h} hours</option>)}
      </Select></Field>
      <p className="flex max-w-md items-start gap-1.5 text-xs text-ink-mute"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Super Admin setting. Checked every 15 minutes; each request is escalated once.</p>
    </div>
  );
}

/** The employee's own open requests (Daily Work Report). */
export function SupportCard({ items, editable, onRaised }: { items: { title: string; when: string; escalated: boolean }[]; editable: boolean; onRaised: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader title="Support required" subtitle="Open requests to your reporting manager" action={editable ? <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpen(true)}>Request support</Button> : undefined} />
      <div className="px-5 pb-5">
        {items.length === 0 ? <p className="text-sm text-ink-soft">No open support requests.</p> : (
          <ul className="space-y-2 text-sm">{items.map((r, i) => (
            <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span className="min-w-0 break-words text-heading">{r.title}</span>
              <span className="shrink-0 text-xs text-ink-mute">{r.escalated ? <Badge tone="red">Escalated</Badge> : `Raised ${r.when}`}</span>
            </li>
          ))}</ul>
        )}
      </div>
      {open && <RaiseSupport onClose={() => setOpen(false)} onDone={onRaised} />}
    </Card>
  );
}
