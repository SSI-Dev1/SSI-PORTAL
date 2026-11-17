// Historical onboarding (0055): agencies onboarded under the previous process, before the portal's
// registration workflow. Anyone who works an agency may ask for a review; only administrators (Super
// Admin, "Partner registrations") approve, flag for verification or decline — the database enforces it.
// Approval records an administrative correction: no proposal, registration, agreement, login, email or
// employee work is created.
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, History, XCircle } from 'lucide-react';
import { Alert, Badge, Button, DatePicker, Field, Modal, Segmented, Textarea } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { rpc, fmtDate } from '../../lib/agencies';

export const HISTORICAL_STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'red' | 'slate' }> = {
  requested: { label: 'Historical onboarding review requested', tone: 'amber' },
  approved: { label: 'Historically onboarded', tone: 'green' },
  flagged: { label: 'Historical onboarding — needs verification', tone: 'red' },
  declined: { label: 'Historical onboarding declined', tone: 'slate' },
};

export function RequestHistoricalOnboarding({ agencyId, name, onClose, onDone }: { agencyId: string; name: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await rpc('request_historical_onboarding', { p_id: agencyId, p_note: note.trim(), p_evidence: evidence.trim() || null });
    setBusy(false);
    if (!r.ok) return toast.error('Not sent', r.error);
    toast.success('Review requested', 'An administrator will verify the earlier onboarding. The stage does not change until then.');
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Request Historical Onboarding Review" subtitle={name} dirty={!!note}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={History} disabled={busy || note.trim().length < 10} loading={busy} onClick={() => void save()}>Request review</Button></>}>
      <Alert tone="info" className="mb-4">Use this only for an agency that was already onboarded under the previous process, before the portal registration existed. New agencies are onboarded through registration, agreement and approval. An administrator verifies every request.</Alert>
      <Field label="How and when was this agency onboarded?" required hint="At least 10 characters"><Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Signed MOU in March 2025 through the old process; proposal confirmed by email" /></Field>
      <Field label="Supporting evidence (optional)" className="mt-3" hint="Where the proof is kept — MOU reference, email, file location"><Textarea rows={2} maxLength={2000} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
    </Modal>
  );
}

interface PreviewRow {
  id: string; reference: string; name: string | null; contact: string | null; stage: string; source: string | null; historical_status: string | null;
  request_note: string | null; evidence: string | null; created_at: string; proposals: number; proposal_status: string | null; proposal_confirmed_at: string | null;
  mous: number; registration_status: string | null; linked_partner: string | null; possible_partners: { id: string; name: string }[] | null; blocked: string | null;
}

export function ReviewHistoricalOnboarding({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [err, setErr] = useState('');
  const [decision, setDecision] = useState<'approve' | 'flag' | 'decline'>('approve');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [original, setOriginal] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void rpc<PreviewRow[]>('preview_historical_onboarding', { p_ids: ids }).then((r) => (r.ok ? setRows(r.data) : setErr(r.error)));
  }, [ids]);
  const eligible = (rows ?? []).filter((r) => !r.blocked);
  const save = async () => {
    setBusy(true);
    const r = await rpc<{ done: { id: string; name: string }[]; skipped: { name: string; reason: string }[]; reconciliation: { linked_existing: number; created: number; conflicts: number } | null }>(
      'review_historical_onboarding', { p_ids: ids, p_decision: decision, p_reason: reason.trim(), p_evidence: evidence.trim() || null, p_original_date: original || null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    const verb = decision === 'approve' ? 'approved as historically onboarded' : decision === 'flag' ? 'flagged for verification' : 'declined';
    const rec = r.data.reconciliation;
    toast.success(`${r.data.done.length} agenc${r.data.done.length === 1 ? 'y' : 'ies'} ${verb}`,
      [rec ? `Clients & Branches: ${rec.linked_existing} linked to existing partners, ${rec.created} historical client records${rec.conflicts ? `, ${rec.conflicts} need a choice` : ''}.` : decision === 'approve' ? 'A Super Admin links them in Clients & Branches (Onboarded — needs review).' : '',
        r.data.skipped.length ? `${r.data.skipped.length} skipped: ${r.data.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}` : ''].filter(Boolean).join(' '));
    onDone(); onClose();
  };
  return (
    <Modal open onClose={onClose} size="xl" title="Approve Historical Onboarding" subtitle={`${ids.length} agenc${ids.length === 1 ? 'y' : 'ies'} selected · administrative reconciliation — not anyone's work today`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={decision === 'decline' ? 'danger' : 'primary'} icon={decision === 'approve' ? CheckCircle2 : decision === 'flag' ? Flag : XCircle}
          disabled={busy || !eligible.length || reason.trim().length < 10} loading={busy} onClick={() => void save()}>
          {decision === 'approve' ? `Approve ${eligible.length}` : decision === 'flag' ? `Flag ${eligible.length} for verification` : `Decline ${eligible.length}`}
        </Button>
      </>}>
      {err && <Alert tone="error">{err}</Alert>}
      {!rows && !err && <p className="text-sm text-ink-soft" role="status">Checking the selected agencies…</p>}
      {rows && (
        <div className="space-y-4">
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-heading">{r.name ?? r.reference}</b><span className="text-xs text-ink-mute">{r.reference} · {r.stage.replace(/_/g, ' ')} · {r.source === 'import' ? 'imported' : `added ${fmtDate(r.created_at)}`}</span>
                  {r.historical_status && <Badge tone={HISTORICAL_STATUS[r.historical_status]?.tone ?? 'slate'}>{HISTORICAL_STATUS[r.historical_status]?.label ?? r.historical_status}</Badge>}
                  {r.blocked && <Badge tone="red">Not eligible</Badge>}
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  Proposals: {r.proposals}{r.proposal_status ? ` (latest ${r.proposal_status.replace(/_/g, ' ')}${r.proposal_confirmed_at ? `, confirmed ${fmtDate(r.proposal_confirmed_at)}` : ''})` : ''} · MOUs: {r.mous} · Registration: {r.registration_status ?? 'none'}
                  {r.linked_partner ? ` · Linked client: ${r.linked_partner}` : ''}
                </div>
                {r.request_note && <div className="mt-1 text-xs text-ink-soft">Request: {r.request_note}</div>}
                {r.evidence && <div className="mt-1 text-xs text-ink-soft">Evidence: {r.evidence}</div>}
                {r.possible_partners?.length ? <div className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Existing client with the same name or email: {r.possible_partners.map((p) => p.name).join(', ')} — it is linked, not duplicated.</div> : null}
                {r.blocked && <div className="mt-1 text-xs text-red-600">{r.blocked}</div>}
              </li>
            ))}
          </ul>
          <Field label="Decision">
            <Segmented value={decision} onChange={(v) => setDecision(v as typeof decision)}
              options={[{ value: 'approve', label: 'Approve — already onboarded' }, { value: 'flag', label: 'Flag for verification' }, { value: 'decline', label: 'Decline' }]} />
          </Field>
          {decision === 'approve' && <Alert tone="info">Approved agencies become Onboarded (historical) and count in Onboarded Clients and Clients &amp; Branches. No proposal, registration, agreement, login or email is created, and no employee's daily report changes. Use “Flag” when the evidence is incomplete.</Alert>}
          <Field label={decision === 'approve' ? 'Approval reason' : 'Reason'} required hint="At least 10 characters — kept in the agency history and audit log">
            <Textarea rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {decision === 'approve' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supporting evidence reference (optional)"><Textarea rows={2} maxLength={2000} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="MOU number, email, file location" /></Field>
              <Field label="Original onboarding date (only if known)" hint="Leave empty if not known — today's reconciliation date is recorded anyway"><DatePicker value={original} onChange={(v) => setOriginal(v ?? '')} /></Field>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
