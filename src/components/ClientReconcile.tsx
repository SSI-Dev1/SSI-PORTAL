// Reconcile onboarded agencies to Clients & Branches (0060) and the onboarding progress of one agency.
// Reconciliation is an administrator action: preview first (nothing changes), then confirm with a
// reason. It links the existing client record or creates a historical one (no login, no email), and
// is safe to run again — already-linked agencies are reported as "no change needed".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, CircleDot, MinusCircle, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Modal, Select, Table, Textarea } from './ui';
import { useToast } from './feedback';
import { supabase } from '../auth/auth';
import { rpc } from '../lib/agencies';
import { cn } from '../lib/utils';

interface Plan { action: 'none' | 'link' | 'create' | 'conflict'; reason: string; partner_id?: string; partner_name?: string; candidates?: { id: string; name: string }[] }
interface Row { id: string; reference: string; name: string | null; contact: string | null; country: string | null; agency_type: string | null; historical_status: string | null;
  source_status: string | null; registration_status: string | null; plan: Plan }
const ACTION: Record<Plan['action'], { label: string; tone: 'green' | 'blue' | 'amber' | 'slate' }> = {
  link: { label: 'Link existing client', tone: 'blue' }, create: { label: 'Create client record', tone: 'green' },
  conflict: { label: 'Needs a decision', tone: 'amber' }, none: { label: 'Already linked', tone: 'slate' },
};

/** ids: one or more agencies; null = every onboarded agency not yet in Clients & Branches. */
export function ReconcileDialog({ ids, onClose, onDone }: { ids: string[] | null; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void rpc<Row[]>('client_reconciliation_preview', { p_ids: ids }).then((r) => {
      if (!r.ok) { setErr(/does not exist|schema cache|0034/.test(r.error) ? 'Run migration 0060 to enable reconciliation.' : r.error); setRows([]); return; }
      setRows(r.data ?? []);
      setPicked(new Set((r.data ?? []).filter((x) => x.plan.action === 'link' || x.plan.action === 'create').map((x) => x.id)));
    });
  }, [ids]);
  const single = rows?.length === 1 ? rows[0] : null;
  const conflictChoice = single?.plan.action === 'conflict' && !!single.plan.candidates?.length;
  const selected = useMemo(() => (rows ?? []).filter((r) => picked.has(r.id)), [rows, picked]);
  const canApply = reason.trim().length >= 10 && (selected.length > 0 || (conflictChoice && !!choice));
  const apply = async () => {
    setBusy(true); setErr('');
    const target = conflictChoice && choice ? [single!.id] : selected.map((r) => r.id);
    const r = await rpc<{ linked: unknown[]; created: unknown[]; unchanged: unknown[]; skipped: { name: string; reason: string }[] }>('reconcile_agencies_to_clients',
      { p_ids: target, p_reason: reason.trim(), p_partner: conflictChoice && choice ? choice : null });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    const d = r.data;
    const parts = [d.created.length && `${d.created.length} created`, d.linked.length && `${d.linked.length} linked`, d.unchanged.length && `${d.unchanged.length} already linked`].filter(Boolean);
    toast.success(d.created.length + d.linked.length ? 'Added to Clients & Branches' : 'No changes needed', `${parts.join(' · ') || 'Nothing to change'}${d.skipped.length ? ` · ${d.skipped.length} skipped` : ''}. No logins or emails were created.`);
    onDone?.(); onClose();
  };
  return (
    <Modal open onClose={onClose} size="xl" title="Reconcile to Clients & Branches" dirty={!!reason.trim()}
      subtitle="Onboarded agencies without a client record. Review what will change, then confirm."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !canApply} loading={busy} onClick={() => void apply()}>{conflictChoice ? 'Link to the chosen record' : `Reconcile ${selected.length} agenc${selected.length === 1 ? 'y' : 'ies'}`}</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      {!rows ? <p className="text-sm text-ink-soft" role="status">Checking agencies…</p> : rows.length === 0 ? (
        <Alert tone="success" title="Nothing to reconcile">Every onboarded agency already has its client record.</Alert>
      ) : (
        <>
          <Alert tone="info" className="mb-3">Business onboarding and portal access stay separate: no login is created and no email is sent. This is an administrative correction — it is not counted as anyone's onboarding work today.</Alert>
          <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-line">
            <Table head={[<span key="s" className="sr-only">Select</span>, 'Agency', 'Agency ID', 'Historical status', 'Client record', 'Result']}>
              {rows.map((r) => {
                const eligible = r.plan.action === 'link' || r.plan.action === 'create';
                return (
                  <tr key={r.id}>
                    <td className="w-10 px-3">{eligible && <Checkbox checked={picked.has(r.id)} label={<span className="sr-only">Select {r.name}</span>}
                      onCheckedChange={(v) => setPicked((cur) => { const n = new Set(cur); if (v) n.add(r.id); else n.delete(r.id); return n; })} />}</td>
                    <td className="px-4 py-3"><div className="font-semibold text-heading">{r.name ?? r.reference}</div><div className="text-xs text-ink-mute">{[r.contact, r.country, r.agency_type].filter(Boolean).join(' · ') || '—'}</div></td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{r.reference}</td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{r.historical_status ? r.historical_status : 'Imported as onboarded'}{r.source_status ? <div className="text-ink-mute">Sheet: “{r.source_status}”</div> : null}
                      {r.registration_status && <div className="text-ink-mute">Registration: {r.registration_status.replace(/_/g, ' ')}</div>}</td>
                    <td className="px-4 py-3 text-sm">{r.plan.partner_name ?? (r.plan.candidates?.length ? r.plan.candidates.map((c) => c.name).join(', ') : <span className="text-ink-mute">None</span>)}</td>
                    <td className="px-4 py-3"><Badge tone={ACTION[r.plan.action].tone}>{ACTION[r.plan.action].label}</Badge><div className="mt-1 max-w-xs text-[11px] text-ink-mute">{r.plan.reason}</div></td>
                  </tr>
                );
              })}
            </Table>
          </div>
          {conflictChoice && (
            <Field label="Choose the client record for this agency" className="mt-3" hint="Only if you have confirmed it is the same company.">
              <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Choose…</option>
                {single!.plan.candidates!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Reason / evidence" required className="mt-3" hint="Recorded with the reviewer and time as the historical approval (earlier evidence is kept).">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="e.g. Onboarded in 2023 under the previous process; signed agreement on file" />
          </Field>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ onboarding progress
interface Step { key: string; label: string; state: 'done' | 'current' | 'blocked' | 'waiting' | 'skipped'; detail: string | null }
const ICON = { done: CheckCircle2, current: CircleDot, blocked: XCircle, waiting: Circle, skipped: MinusCircle } as const;
const TONE = { done: 'text-emerald-600 dark:text-emerald-400', current: 'text-blue-600 dark:text-blue-400', blocked: 'text-red-600 dark:text-red-400', waiting: 'text-ink-mute', skipped: 'text-ink-mute' } as const;

/** Where this agency's onboarding stands, with the exact blocking reason recorded in the CRM (live). */
export function OnboardingProgress({ agencyId, rev }: { agencyId: string; rev?: unknown }) {
  const [data, setData] = useState<{ path: 'historical' | 'normal'; steps: Step[] } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await rpc<{ path: 'historical' | 'normal'; steps: Step[] }>('agency_onboarding_progress', { p_id: agencyId });
    if (!r.ok) { setErr(/does not exist|schema cache|0034/.test(r.error) ? 'Run migration 0060 to see onboarding progress.' : r.error); return; }
    setErr(''); setData(r.data);
  }, [agencyId]);
  useEffect(() => { void load(); }, [load, rev]);
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 400); };
    const ch = sb.channel(`onb-${agencyId}-${Math.random().toString(36).slice(2, 6)}`);
    for (const table of ['agency_proposals', 'agency_emails', 'partner_registrations', 'registration_agreements']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    ch.subscribe();
    return () => { clearTimeout(t); void sb.removeChannel(ch); };
  }, [agencyId, load]);
  const blocked = data?.steps.find((s) => s.state === 'blocked');
  return (
    <Card>
      <CardHeader title="Onboarding progress" subtitle={data ? (data.path === 'historical' ? 'Historical onboarding (before the registration system)' : 'Proposal → registration → agreement → approval') : undefined} />
      <div className="px-5 pb-5">
        {err && <Alert tone="warning">{err}</Alert>}
        {!data && !err && <p className="text-sm text-ink-soft" role="status">Loading…</p>}
        {blocked && <Alert tone="error" className="mb-3" title={`Blocked at: ${blocked.label}`}><span className="inline-flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{blocked.detail}</span></Alert>}
        {data && (
          <ol className="space-y-2">
            {data.steps.map((s) => {
              const Icon = ICON[s.state];
              return (
                <li key={s.key} className="flex items-start gap-2.5">
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[s.state])} aria-hidden />
                  <div className="min-w-0">
                    <div className={cn('text-sm', s.state === 'waiting' || s.state === 'skipped' ? 'text-ink-soft' : 'font-medium text-heading')}>{s.label}
                      <span className="sr-only"> — {s.state}</span></div>
                    {s.detail && <div className={cn('break-words text-xs', s.state === 'blocked' ? 'text-red-600 dark:text-red-400' : 'text-ink-mute')}>{s.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ one-click verification (0062)
type VerifyResult = { status: 'created' | 'linked' | 'already' | 'review'; partner_id: string | null; partner_name: string | null; reason: string | null; candidates?: { id: string; name: string }[] };

/** Verify → Done. Uses the agency's own record: links its exact client match or creates its client record.
 *  No partner search, no login, no password, no email. Conflicts are flagged for review, never guessed. */
export function VerifyHistoricalDialog({ agency, onClose, onDone }: {
  agency: { id: string; name: string; reference: string; status?: string }; onClose: () => void; onDone?: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [review, setReview] = useState(false);
  const verify = async () => {
    setBusy(true); setErr('');
    const r = await rpc<VerifyResult>('verify_historical_agency', { p_id: agency.id });
    setBusy(false);
    if (!r.ok) return setErr(/verify_historical_agency|schema cache|0034/.test(r.error) ? 'Run migration 0062 to enable one-click verification.' : r.error);
    setRes(r.data);
    onDone?.();
    if (r.data.status !== 'review') toast.success('Historical onboarding verified', `${agency.name} is now in Clients & Partnerships. No login or email was created.`);
  };
  if (review) return <ReconcileDialog ids={[agency.id]} onClose={onClose} onDone={onDone} />;
  const done = res && res.status !== 'review';
  return (
    <Modal open onClose={onClose} title="Verify historical onboarding" subtitle={`${agency.name} · ${agency.reference}`}
      footer={done ? <Button onClick={onClose}>Done</Button> : res?.status === 'review' ? (
        <><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="secondary" onClick={() => setReview(true)}>Review matches…</Button></>
      ) : (
        <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={busy} onClick={() => void verify()}>Verify</Button></>
      )}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-mute">Agency</dt><dd className="font-semibold text-heading">{agency.name}</dd>
        <dt className="text-ink-mute">Agency ID</dt><dd className="text-heading">{agency.reference}</dd>
        <dt className="text-ink-mute">Historical onboarding</dt>
        <dd>{done ? <Badge tone="green" dot>Verified · in Clients & Partnerships</Badge> : <Badge tone="amber" dot>{agency.status ?? 'Historically onboarded · pending verification'}</Badge>}</dd>
      </dl>
      {!res && <p className="mt-4 text-sm text-ink-soft">Verifying adds this agency to Clients & Partnerships using its own details, officer and history. No partner login, password or email is created — portal access stays a separate step.</p>}
      {done && <Alert tone="success" className="mt-4">{res.status === 'created' ? 'Client record created' : res.status === 'linked' ? 'Linked to its existing client record' : 'Already in Clients & Partnerships'}{res.partner_name ? ` — ${res.partner_name}` : ''}.</Alert>}
      {res?.status === 'review' && <Alert tone="warning" className="mt-4" title="Needs an administrator's review">{res.reason ?? 'A conflicting match was found.'} Nothing was linked; the agency is flagged for review.</Alert>}
      {err && <Alert tone="error" className="mt-4">{err}</Alert>}
    </Modal>
  );
}
