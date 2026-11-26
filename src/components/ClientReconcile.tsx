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
import { prepareUpload, UploadError } from '../lib/files';
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

// ------------------------------------------------------------------ Complete Historical Onboarding (0065)
type CompleteResult = { status: 'completed' | 'attached' | 'repeat'; partner_id: string | null; partner_name: string | null; version?: number; from?: string };
interface AgencyFacts { stage: string; source: string | null; source_status: string | null; historical_status: string | null; partner_id: string | null;
  historical_original_date: string | null; historical_evidence: string | null }
interface MouDoc { id: string; file_name: string; version: number; uploaded_at: string; storage_path: string }
const STAGE_LABEL: Record<string, string> = { new_prospect: 'New prospect', contacted: 'Contacted', proposal_sent: 'Proposal sent', mou_sent: 'MOU sent',
  approved: 'Approved', onboarded: 'Onboarded', closed: 'Closed', inactive: 'Inactive' };
const DOC_BUCKET = 'agency-documents';

/** Opens a stored MOU through a 60-second signed link (private storage, staff only). */
export async function openAgencyDocument(path: string) {
  if (!supabase) return;
  const { data } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 60);
  if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
}

/** The agency's historical MOUs (newest version first). */
export function useAgencyMous(agencyId: string, rev?: unknown) {
  const [docs, setDocs] = useState<MouDoc[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.from('agency_documents').select('id,file_name,version,uploaded_at,storage_path').eq('agency_id', agencyId).eq('kind', 'historical_mou')
      .order('version', { ascending: false }).then(({ data }) => { if (alive) setDocs((data ?? []) as MouDoc[]); });
    return () => { alive = false; };
  }, [agencyId, rev]);
  return docs;
}

/** Complete Historical Onboarding: review the agency, attach the existing MOU, confirm — done. The agency
 *  becomes Onboarded and is added to Clients & Partnerships in the same step; no second approval, no
 *  partner search, no login, password or email. Already onboarded: the MOU is attached without restarting. */
export function VerifyHistoricalDialog({ agency, onClose, onDone }: {
  agency: { id: string; name: string; reference: string; status?: string }; onClose: () => void; onDone?: () => void;
}) {
  const toast = useToast();
  const [facts, setFacts] = useState<AgencyFacts | null>(null);
  const docs = useAgencyMous(agency.id);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState('');
  const [originalDate, setOriginalDate] = useState('');
  const [emailRef, setEmailRef] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [belongs, setBelongs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<CompleteResult | null>(null);
  const requestId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from('agency_prospects').select('stage,source,source_status,historical_status,partner_id,historical_original_date,historical_evidence')
      .eq('id', agency.id).maybeSingle().then(({ data }) => setFacts((data ?? null) as AgencyFacts | null));
  }, [agency.id]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const already = facts?.stage === 'onboarded';
  const pick = async (f: File | undefined) => {
    setFileErr(''); setBelongs(false);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null); setFile(null);
    if (!f) return;
    try {
      const p = await prepareUpload(f);
      if (p.ext !== 'pdf') throw new UploadError('Attach the MOU as a PDF.');
      setFile(f);
      setPreview(URL.createObjectURL(f));
    } catch (e) {
      setFileErr(e instanceof UploadError ? e.message : 'This file cannot be used.');
    }
  };

  const complete = async () => {
    if (!file || !confirmed || !belongs || busy || !supabase) return;
    setBusy(true); setErr('');
    const path = `${agency.id}/${crypto.randomUUID()}.pdf`;
    const up = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (up.error) { setBusy(false); return setErr('The MOU could not be uploaded. Check the file and try again.'); }
    const r = await rpc<CompleteResult>('complete_historical_onboarding', {
      p_id: agency.id, p_path: path, p_file_name: file.name, p_size: file.size, p_confirm: true,
      p_original_date: originalDate || null, p_email_ref: emailRef.trim() || null, p_notes: notes.trim() || null, p_request: requestId,
    });
    setBusy(false);
    if (!r.ok) {
      void supabase.storage.from(DOC_BUCKET).remove([path]);   // nothing was recorded: remove the upload
      return setErr(r.error);
    }
    setRes(r.data);
    onDone?.();
    toast.success(r.data.status === 'attached' ? 'MOU attached' : 'Historical onboarding completed',
      r.data.status === 'attached' ? `${agency.name} stays onboarded; the MOU is on its record.` : `${agency.name} has been added to Clients & Partnerships. No login or email was created.`);
  };

  if (res) {
    return (
      <Modal open onClose={onClose} title={res.status === 'attached' ? 'MOU attached' : 'Historical Onboarding Completed'} subtitle={`${agency.name} · ${agency.reference}`}
        footer={<Button onClick={onClose}>Done</Button>}>
        <Alert tone="success">
          {res.status === 'attached' ? 'The MOU is attached to the existing record. Onboarding was not restarted.' : 'The Agency has been added to Clients and Partnerships.'}
          {res.partner_name ? ` Client record: ${res.partner_name}.` : ''}
        </Alert>
        <p className="mt-3 text-sm text-ink-soft">Portal access is separate: no partner login, password or email was created.</p>
      </Modal>
    );
  }
  const canSubmit = !!file && confirmed && belongs && !busy;
  return (
    <Modal open onClose={onClose} title={already ? 'Attach historical MOU' : 'Complete Historical Onboarding'} subtitle={`${agency.name} · ${agency.reference}`}
      dirty={!!file || !!notes.trim()}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!canSubmit} onClick={() => void complete()}>{already ? 'Attach MOU' : 'Verify and Complete'}</Button></>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-mute">Agency</dt><dd className="font-semibold text-heading">{agency.name}</dd>
        <dt className="text-ink-mute">Current status</dt><dd className="text-heading">{facts ? STAGE_LABEL[facts.stage] ?? facts.stage : '…'}{facts?.source_status ? ` · original sheet: “${facts.source_status}”` : ''}</dd>
        <dt className="text-ink-mute">Onboarding</dt>
        <dd>{facts?.partner_id ? <Badge tone="green" dot>In Clients & Partnerships</Badge> : already ? <Badge tone="amber" dot>Onboarded · not in Clients & Partnerships yet</Badge> : <Badge tone="slate" dot>Not onboarded in the CRM</Badge>}</dd>
        {docs.length > 0 && <><dt className="text-ink-mute">MOU on file</dt><dd className="space-y-1">{docs.map((d) => (
          <button key={d.id} type="button" className="block text-left text-rust underline-offset-2 hover:underline" onClick={() => void openAgencyDocument(d.storage_path)}>{d.file_name} · v{d.version}</button>
        ))}</dd></>}
      </dl>

      <div className="mt-5 space-y-4">
        <Field label="Attach Existing MOU or Partnership Agreement" required hint={fileErr || 'PDF up to 10 MB — the signed copy exchanged by email. It is stored privately and not changed.'}>
          <input type="file" accept="application/pdf,.pdf" aria-label="Attach Existing MOU or Partnership Agreement" onChange={(e) => void pick(e.target.files?.[0])}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-rust hover:file:bg-brand-100 dark:file:bg-brand-500/10" />
        </Field>
        {file && (
          <div className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all font-medium text-heading">{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
              {preview && <a href={preview} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-rust hover:underline">Preview</a>}
            </div>
            <div className="mt-2"><Checkbox checked={belongs} onCheckedChange={setBelongs} label={`This document belongs to ${agency.name}`} /></div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Original partnership date" hint="Only if known">
            <input type="date" value={originalDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setOriginalDate(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink dark:bg-canvas/50" />
          </Field>
          <Field label="Email reference" hint="Optional — e.g. subject and date">
            <input value={emailRef} maxLength={500} onChange={(e) => setEmailRef(e.target.value)} placeholder="e.g. “Signed MOU” · 12 Jun 2024"
              className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink dark:bg-canvas/50" />
          </Field>
        </div>
        <Field label="Historical notes" hint="Optional"><Textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Checkbox checked={confirmed} onCheckedChange={setConfirmed}
          label="I confirm that this Agency was previously approved and onboarded under SSI GLOBAL's historical partnership process." />
        {!already && facts && facts.stage !== 'onboarded' && (
          <p className="text-xs text-ink-mute">A proposal or MOU that was only sent is not enough — complete this only for a partnership that was actually agreed. Otherwise leave the agency at its current stage.</p>
        )}
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}
