// Partnership Agreement review inside Partner Registrations (0054): status, every document version,
// Annexure A, review (request changes / approve for countersigning / reject), countersigning by an
// authorised signatory, and sending the final copy. The database and the partner-registration Edge
// Function enforce who may do each step; buttons only reflect it.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Eye, FileSignature, FileUp, Loader2, MessageSquareWarning, Send, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DatePicker, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { supabase } from '../../auth/auth';
import { serverMessage } from '../../data/hr';

export type AgreementStatus = 'not_generated' | 'template_missing' | 'annexure_missing' | 'ready' | 'partner_signed' | 'pending_review' | 'changes_requested'
  | 'approved_for_countersign' | 'countersigned' | 'sent' | 'completed' | 'rejected';
export const AGREEMENT_STATUS: Record<AgreementStatus, { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'orange' | 'navy' }> = {
  not_generated: { label: 'Agreement Not Generated', tone: 'slate' }, template_missing: { label: 'Template needed', tone: 'red' },
  annexure_missing: { label: 'Annexure A needed', tone: 'red' }, ready: { label: 'Awaiting Partner Signature', tone: 'blue' },
  partner_signed: { label: 'Partner Signed and Uploaded', tone: 'violet' }, pending_review: { label: 'Pending SSI Review', tone: 'orange' },
  changes_requested: { label: 'Changes Requested', tone: 'amber' }, approved_for_countersign: { label: 'Awaiting SSI Signature', tone: 'violet' },
  countersigned: { label: 'Countersigned', tone: 'green' }, sent: { label: 'Final Agreement Sent', tone: 'green' }, completed: { label: 'Completed', tone: 'navy' },
  rejected: { label: 'Rejected', tone: 'red' },
};
export interface RegistrationAgreement {
  registration_id: string; status: AgreementStatus; agency_type: string | null; template_id: string | null; agreement_date: string | null;
  annexure_resolution: string | null; reviewer: string | null; review: { reasons?: string[]; note?: string | null; at?: string } | null;
  countersigned_by: string | null; countersigned_at: string | null; version_flag: string | null; sent_at: string | null; email_status: string | null; email_detail: string | null;
  completed_at: string | null; updated_at: string;
}
interface AgreementFile {
  id: string; kind: 'generated' | 'annexure' | 'partner_signed' | 'countersigned'; version: number; sha256: string; size: number; pages: number | null; file_name: string | null;
  uploaded_by: string | null; uploaded_at: string; superseded_at: string | null; review_status: string | null; reviewed_by: string | null; reviewed_at: string | null;
}
const KIND: Record<AgreementFile['kind'], string> = { generated: 'Generated agreement', annexure: 'Annexure A', partner_signed: 'Partner-signed copy', countersigned: 'SSI countersigned final' };
const REASONS = [['missing_signature', 'Missing signature'], ['missing_seal', 'Missing company seal'], ['incomplete_pages', 'Incomplete pages'],
  ['company_info', 'Incorrect company information'], ['representative', 'Incorrect authorised representative'], ['wrong_version', 'Wrong document version'], ['other', 'Other']] as const;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

async function fn<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Not configured' };
  const { data, error } = await supabase.functions.invoke('partner-registration', { body });
  if (!error) return { ok: true, data: data as T };
  const ctx = (error as { context?: unknown }).context;
  const p = ctx instanceof Response ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null;
  return { ok: false, error: p?.error ?? 'Please try again.' };
}
async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Not configured' };
  const { data, error } = await supabase.rpc(name, args);
  return error ? { ok: false, error: serverMessage(error) } : { ok: true, data: data as T };
}
/** Uploads a PDF through a one-time signed URL from the Edge Function, then asks it to take the file. */
async function uploadPdf(file: File, urlAction: string, attachAction: string, extra: Record<string, unknown>) {
  if (!supabase) return { ok: false as const, error: 'Not configured' };
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return { ok: false as const, error: 'Upload a PDF file.' };
  const u = await fn<{ path: string; uploadToken: string }>({ action: urlAction, size: file.size, ...extra });
  if (!u.ok) return u;
  const up = await supabase.storage.from('partner-registration-files').uploadToSignedUrl(u.data.path, u.data.uploadToken, file, { contentType: 'application/pdf' });
  if (up.error) return { ok: false as const, error: 'The upload failed. Please try again.' };
  return await fn<{ ok: boolean; flag?: string | null; id?: string; version?: number }>({ action: attachAction, path: u.data.path, name: file.name, ...extra });
}

export function useCanCountersign() {
  const [can, setCan] = useState(false);
  useEffect(() => { void rpc<boolean>('can_countersign_agreements', {}).then((r) => setCan(r.ok && r.data === true)); }, []);
  return can;
}

export function AgreementPanel({ registrationId, regStatus, staffName, isSuper, staff, onChangesLink, onChanged }: {
  registrationId: string; regStatus: string; staffName: (id: string | null) => string; isSuper: boolean; staff: { id: string; fullName: string }[];
  onChangesLink: (token: string, expiresAt: string) => void; onChanged: () => void;
}) {
  const toast = useToast();
  const canSign = useCanCountersign();
  const [ag, setAg] = useState<RegistrationAgreement | null | undefined>(undefined);
  const [files, setFiles] = useState<AgreementFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'changes' | 'reject' | 'annexure' | 'send' | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [a, f] = await Promise.all([
      supabase.from('registration_agreements').select('*').eq('registration_id', registrationId).maybeSingle(),
      supabase.from('registration_agreement_files').select('id, kind, version, sha256, size, pages, file_name, uploaded_by, uploaded_at, superseded_at, review_status, reviewed_by, reviewed_at')
        .eq('registration_id', registrationId).order('uploaded_at', { ascending: false }),
    ]);
    setAg((a.data ?? null) as RegistrationAgreement | null);
    setFiles((f.data ?? []) as AgreementFile[]);
  }, [registrationId]);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const sb = supabase;
    let t = 0;
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(() => void load(), 250); };
    const ch = sb.channel(`agreement-${registrationId.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_agreements', filter: `registration_id=eq.${registrationId}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_agreement_files', filter: `registration_id=eq.${registrationId}` }, soon)
      .subscribe();
    return () => { window.clearTimeout(t); void sb.removeChannel(ch); };
  }, [load, registrationId]);

  const run = async (key: string, p: Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(key);
    const r = await p;
    setBusy(null);
    if (!r.ok) { toast.error('Not done', (r as { error: string }).error); return false; }
    toast.success(ok);
    void load(); onChanged();
    return true;
  };
  const open = async (f: AgreementFile, download = false) => {
    const r = await fn<{ url: string }>({ action: 'agreement_file_url', registrationId, fileId: f.id, download });
    if (!r.ok) return toast.error('Could not open the document', r.error);
    window.open(r.data.url, '_blank', 'noopener,noreferrer');
  };
  const pick = (cb: (f: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,.pdf';
    input.onchange = () => { const f = input.files?.[0]; if (f) cb(f); };
    input.click();
  };

  if (ag === undefined) return <Card className="p-5 text-sm text-ink-soft"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading the agreement…</Card>;
  const status: AgreementStatus = ag?.status ?? 'not_generated';
  const current = (k: AgreementFile['kind']) => files.find((f) => f.kind === k && !f.superseded_at);
  const signed = current('partner_signed');
  const final = current('countersigned');
  const preSign = ['not_generated', 'template_missing', 'annexure_missing', 'ready', 'changes_requested'].includes(status);
  const canReview = status === 'pending_review' && ['submitted', 'in_review'].includes(regStatus);

  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><FileSignature className="h-4 w-4 text-rust" />Partnership Agreement</span>}
        subtitle={ag?.agency_type ? `${ag.agency_type === 'domestic' ? 'Domestic' : 'International'} template${ag.agreement_date ? ` · agreement date ${new Date(`${ag.agreement_date}T00:00:00`).toLocaleDateString('en-GB', { dateStyle: 'medium' })}` : ''}` : 'Signed agreement workflow'}
        action={<Badge tone={AGREEMENT_STATUS[status].tone} dot>{AGREEMENT_STATUS[status].label}</Badge>} />
      <div className="space-y-4 px-5 pb-5">
        {status === 'template_missing' && <Alert tone="error" title="No approved agreement template">{ag?.agency_type ? `There is no approved ${ag.agency_type} agreement template. A Super Admin must upload and approve one (Agreement templates).` : <>The agreement depends on the agency type. Choose it here (the agency in the Agency List gets it too) — the partner can then download the agreement from the registration form.
            <Select className="mt-2 max-w-xs" value="" aria-label="Agency type for the agreement" disabled={!!busy}
              onChange={(e) => e.target.value && void run('type', rpc('set_registration_agreement_type', { p_reg: registrationId, p_type: e.target.value }), 'Agreement type set — the agreement is prepared for the partner')}>
              <option value="">Choose the agency type…</option><option value="domestic">Domestic</option><option value="international">International</option>
            </Select></>}</Alert>}
        {status === 'annexure_missing' && <Alert tone="error" title="Annexure A (commission rates) is missing">The agreement refers to Annexure A, which is not part of the template. When the agency accepted a proposal, Annexure A is built automatically from its confirmed rates; this registration has none. Attach this agency's Annexure A (partner-facing rates only — no tiers or SSI internal commission), or a Super Admin records how it is covered. The agreement is not issued until then.</Alert>}
        {ag?.version_flag && <Alert tone="warning" title="Check the countersigned copy">{ag.version_flag}</Alert>}
        {ag?.review?.note && <Alert tone={status === 'rejected' ? 'error' : 'warning'} title={status === 'rejected' ? 'Rejected' : 'Last review'}>
          {(ag.review.reasons ?? []).map((r) => REASONS.find((x) => x[0] === r)?.[1] ?? r).join(' · ')}{ag.review.note ? ` — ${ag.review.note}` : ''}</Alert>}
        {ag?.annexure_resolution && <p className="text-xs text-ink-mute">Annexure A: {ag.annexure_resolution}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assigned reviewer">
            <Select value={ag?.reviewer ?? ''} aria-label="Assigned reviewer" onChange={(e) => e.target.value && void run('reviewer', rpc('set_agreement_details', { p_reg: registrationId, p_reviewer: e.target.value }), 'Reviewer assigned')}>
              <option value="">{ag?.reviewer ? staffName(ag.reviewer) : 'Not assigned'}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </Select>
          </Field>
          {preSign && (
            <Field label="Agreement date" hint="Defaults to the date the agreement is first generated">
              <DatePicker value={ag?.agreement_date ?? ''} onChange={(v) => v && void run('date', rpc('set_agreement_details', { p_reg: registrationId, p_date: v }), 'Agreement date set — the agreement is regenerated')} />
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Documents (every version is kept)</div>
          {files.length === 0 ? <p className="text-sm text-ink-soft">No documents yet. The agreement is generated when the agency reaches “Review Document” in its form.</p> : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {files.map((f) => (
                <li key={f.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${f.superseded_at ? 'opacity-60' : ''}`}>
                  <span className="min-w-0 flex-1"><b className="text-heading">{KIND[f.kind]}</b> v{f.version}{f.superseded_at ? ' (earlier version)' : ''}
                    <span className="block text-xs text-ink-mute">{fmt(f.uploaded_at)} · {f.uploaded_by ? staffName(f.uploaded_by) : f.kind === 'generated' ? 'System' : 'Agency'} · {f.pages ?? '?'} pages · SHA-256 {f.sha256.slice(0, 12)}…{f.review_status ? ` · review: ${f.review_status.replace('_', ' ')}` : ''}</span></span>
                  <Button size="sm" variant="ghost" icon={Eye} onClick={() => void open(f)}>View</Button>
                  <Button size="sm" variant="ghost" icon={Download} onClick={() => void open(f, true)}>Download</Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {preSign && <Button size="sm" variant="secondary" icon={FileUp} disabled={!!busy} loading={busy === 'annexure'}
            onClick={() => pick((f) => void run('annexure', uploadPdf(f, 'annexure_upload_url', 'attach_annexure', { registrationId }), 'Annexure A attached — the agreement is regenerated'))}>Attach Annexure A</Button>}
          {preSign && isSuper && status === 'annexure_missing' && <Button size="sm" variant="ghost" onClick={() => setDialog('annexure')}>Resolve without separate annexure…</Button>}
          {canReview && <>
            <Button size="sm" variant="secondary" icon={MessageSquareWarning} onClick={() => setDialog('changes')}>Request Changes</Button>
            <Button size="sm" variant="danger" icon={XCircle} onClick={() => setDialog('reject')}>Reject document</Button>
            <Button size="sm" icon={CheckCircle2} disabled={!!busy} loading={busy === 'approve'} onClick={() => void run('approve', rpc('approve_agreement_for_countersign', { p_reg: registrationId }), 'Approved for countersigning')}>Approve for Countersigning</Button>
          </>}
          {status === 'pending_review' && !['submitted', 'in_review'].includes(regStatus) && <p className="text-xs text-ink-mute">Review the agreement while the registration is submitted or in review.</p>}
          {status === 'approved_for_countersign' && (canSign ? <>
            {signed && <Button size="sm" variant="secondary" icon={Download} onClick={() => void open(signed, true)}>Download partner-signed copy</Button>}
            <Button size="sm" icon={ShieldCheck} disabled={!!busy} loading={busy === 'countersign'}
              onClick={() => pick((f) => void run('countersign', uploadPdf(f, 'countersign_upload_url', 'attach_countersigned', { registrationId }), 'Countersigned agreement saved'))}>Upload Countersigned Agreement</Button>
          </> : <p className="self-center text-xs text-ink-mute">Waiting for an authorised SSI GLOBAL signatory to countersign.</p>)}
          {(status === 'countersigned' || status === 'sent' || status === 'completed') && final && <>
            <Button size="sm" variant="secondary" icon={Download} onClick={() => void open(final, true)}>Download final</Button>
            <Button size="sm" icon={Send} onClick={() => setDialog('send')}>{status === 'countersigned' ? 'Send Countersigned Agreement' : 'Send again'}</Button>
          </>}
          {(status === 'sent' || status === 'completed') && <p className="w-full text-xs text-ink-mute">Sent {fmt(ag?.sent_at ?? null)} · email {ag?.email_status === 'accepted' ? 'accepted by the email service (delivery not confirmed)' : ag?.email_status === 'failed' ? `failed — ${ag.email_detail ?? ''}` : 'not configured'}{status === 'completed' ? ` · downloaded by the agency ${fmt(ag?.completed_at ?? null)}` : ''}</p>}
        </div>
        {sentLink && <Alert tone="info" title="Private download link (shown once)">Share it only with the agency if the email did not arrive: <span className="break-all font-mono text-xs">{sentLink}</span></Alert>}
      </div>

      <ChangesDialog open={dialog === 'changes'} onClose={() => setDialog(null)} onSubmit={async (reasons, note) => {
        setBusy('changes');
        const r = await rpc<{ token: string; expires_at: string }>('request_agreement_changes', { p_reg: registrationId, p_reasons: reasons, p_note: note || null, p_days: 14 });
        setBusy(null);
        if (!r.ok) return toast.error('Not done', r.error);
        setDialog(null); toast.success('Changes requested', 'Send the correction link to the agency.');
        void load(); onChanged(); onChangesLink(r.data.token, r.data.expires_at);
      }} />
      <NoteDialog open={dialog === 'reject'} title="Reject the signed document" label="Reason" confirm="Reject document" danger onClose={() => setDialog(null)}
        onConfirm={async (note) => { if (await run('reject', rpc('reject_agreement', { p_reg: registrationId, p_note: note }), 'Document rejected')) setDialog(null); }} />
      <NoteDialog open={dialog === 'annexure'} title="Resolve Annexure A" label="How is the commission annexure covered? (recorded for audit)" confirm="Record decision" onClose={() => setDialog(null)}
        onConfirm={async (note) => { if (await run('resolve', rpc('resolve_agreement_annexure', { p_reg: registrationId, p_note: note }), 'Recorded — the agreement can be issued')) setDialog(null); }} />
      <SendDialog open={dialog === 'send'} onClose={() => setDialog(null)} onSend={async (email) => {
        setBusy('send');
        const r = await fn<{ emailStatus: string; detail: string | null; link: string }>({ action: 'send_agreement', registrationId, email: email || undefined });
        setBusy(null);
        if (!r.ok) return toast.error('Not sent', r.error);
        setDialog(null);
        if (r.data.emailStatus === 'accepted') toast.success('Countersigned agreement sent', 'The agency received a private download link.');
        else { toast.error('Email not sent', r.data.detail ?? 'Share the private link instead.'); setSentLink(r.data.link); }
        void load(); onChanged();
      }} />
    </Card>
  );
}

function ChangesDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (reasons: string[], note: string) => void }) {
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setReasons([]); setNote(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Request a corrected signed agreement" subtitle="The agency gets a new link to the same registration to upload a corrected copy. The current copy stays in the history."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!reasons.length && note.trim().length < 3} onClick={() => onSubmit(reasons, note.trim())}>Request changes</Button></>}>
      <div className="grid gap-2 sm:grid-cols-2">
        {REASONS.map(([k, l]) => <Checkbox key={k} checked={reasons.includes(k)} label={l} onCheckedChange={(v) => setReasons((x) => (v ? [...x, k] : x.filter((y) => y !== k)))} />)}
      </div>
      <Field label="Comments for the agency" className="mt-4"><Textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function NoteDialog({ open, title, label, confirm, danger, onClose, onConfirm }: { open: boolean; title: string; label: string; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} disabled={note.trim().length < 3} onClick={() => onConfirm(note.trim())}>{confirm}</Button></>}>
      <Field label={label}><Textarea rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

function SendDialog({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (email: string) => void }) {
  const [email, setEmail] = useState('');
  useEffect(() => { if (open) setEmail(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Send Countersigned Agreement"
      subtitle="Emails “SSI GLOBAL — Your Countersigned Partnership Agreement” with a private link that expires in 30 days. The document is never attached or made public."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Send} onClick={() => onSend(email.trim())}>Send</Button></>}>
      <Field label="Send to (optional)" hint="Leave empty to use the agency's registered email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- templates (Super Admin)
interface Template { id: string; agency_type: string; version: number; name: string; layout: string; sha256: string; pages: number; requires_annexure: boolean; status: string; uploaded_at: string; approved_at: string | null; ssi_signatory_name: string | null; ssi_signatory_designation: string | null }

export function AgreementTemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Template[] | null>(null);
  const [f, setF] = useState({ agencyType: 'domestic', name: 'Memorandum of Understanding / Strategic Recruitment Partner Agreement (Domestic)', layout: 'ssi_domestic_v1',
    requiresAnnexure: true, signatoryName: 'Abhirami AG', signatoryDesignation: 'Chief Business Officer', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('agreement_templates').select('*').order('agency_type').order('version', { ascending: false });
    setRows((data ?? []) as Template[]);
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    const r = await uploadPdf(file, 'template_upload_url', 'attach_template', f);
    setBusy(false);
    if (!r.ok) return toast.error('Template not saved', r.error);
    toast.success('Template uploaded as a draft', 'Review it, then approve it to use it for new agreements.');
    setFile(null); void load();
  };
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Agreement templates" subtitle="Approved legal templates per agency type. Only an approved template is issued; approving a new version retires the previous one. Clause text is never edited here.">
      <div className="space-y-5">
        {rows === null ? <p className="text-sm text-ink-soft">Loading…</p> : rows.length === 0 ? <Alert tone="warning">No templates yet. Upload the approved Domestic agreement below. International agencies stay flagged until an International template is approved.</Alert> : (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1"><b className="text-heading">{t.agency_type === 'domestic' ? 'Domestic' : 'International'} v{t.version}</b> · {t.name}
                  <span className="block text-xs text-ink-mute">{t.pages} pages · {t.requires_annexure ? 'requires Annexure A' : 'no annexure'} · SSI signatory {t.ssi_signatory_name ?? '—'} ({t.ssi_signatory_designation ?? '—'}) · SHA-256 {t.sha256.slice(0, 12)}… · uploaded {fmt(t.uploaded_at)}</span></span>
                <Badge tone={t.status === 'approved' ? 'green' : t.status === 'draft' ? 'amber' : 'slate'}>{t.status}</Badge>
                {t.status === 'draft' && <Button size="sm" icon={CheckCircle2} onClick={async () => { const r = await rpc('approve_agreement_template', { p_id: t.id }); if (!r.ok) return toast.error('Not approved', r.error); toast.success('Template approved'); void load(); }}>Approve</Button>}
              </li>
            ))}
          </ul>
        )}
        <Card className="p-4">
          <div className="mb-3 font-semibold text-heading">Upload a template</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Agency type"><Select value={f.agencyType} onChange={(e) => setF({ ...f, agencyType: e.target.value })} aria-label="Agency type"><option value="domestic">Domestic</option><option value="international">International</option></Select></Field>
            <Field label="Layout" hint="Where the partner details are filled in. A new document needs to be measured first."><Select value={f.layout} onChange={(e) => setF({ ...f, layout: e.target.value })} aria-label="Layout"><option value="ssi_domestic_v1">SSI Domestic agreement (13 pages)</option></Select></Field>
            <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="SSI signatory (as printed)"><Input value={f.signatoryName} onChange={(e) => setF({ ...f, signatoryName: e.target.value })} /></Field>
            <Field label="Signatory designation"><Input value={f.signatoryDesignation} onChange={(e) => setF({ ...f, signatoryDesignation: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Checkbox checked={f.requiresAnnexure} onCheckedChange={(v) => setF({ ...f, requiresAnnexure: v })} label="Requires Annexure A (commission rates) before it is issued" /></div>
            <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-ink-soft hover:border-brand-300">
              <Upload className="h-4 w-4 text-rust" />{file ? file.name : 'Choose the template PDF…'}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <Button icon={FileUp} disabled={!file || busy} loading={busy} onClick={() => void upload()}>Upload as draft</Button>
          </div>
        </Card>
      </div>
    </Modal>
  );
}
