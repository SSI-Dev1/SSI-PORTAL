// Clients & Branches → Partner Registrations (Super Admin, and Admin Staff with "Partner
// registrations"). Generates company-specific registration links, reviews submissions, requests
// changes, rejects or approves — and "Approve & Create Partner" opens the existing Add Partner
// dialog prefilled from the registration. The database enforces who may do each step (0030).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardCopy, Download, ExternalLink, FileText, History, Link2, Mail, MessageSquareWarning, Plus, RefreshCw, Send, ShieldOff, UserPlus, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Segmented, Table, Tabs, Textarea, usePaged } from '../../components/ui';
import { KPI } from '../../components/hr';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { FORM_SECTIONS, fieldByKey, type Answers } from '../../../supabase/functions/_shared/partnerRegistrationForm';
import { PartnerDialog, CredentialsOnce, createdAccount, type CreatedAccount } from './UserManagement';
import { serverMessage } from '../../data/hr';
import { cn, matches } from '../../lib/utils';

type Status = 'link_generated' | 'in_progress' | 'submitted' | 'in_review' | 'changes_requested' | 'approved' | 'rejected' | 'activated';
interface Registration {
  id: string; reference: string; company_name: string; intended_email: string | null; country: string | null; internal_notes: string | null;
  link_expires_at: string | null; link_status: 'active' | 'revoked' | 'closed'; status: Status; form_version: string | null; answers: Answers;
  files: Record<string, { id: string; name: string; size: number; mime: string }>; verified_email: string | null; submission_count: number;
  submitted_at: string | null; first_opened_at: string | null; change_request: { reason: string; fields: string[]; instructions: string | null } | null;
  assigned_reviewer: string | null; reviewed_by: string | null; reviewed_at: string | null; decision_reason: string | null; provisioning_since: string | null;
  partner_id: string | null; partner_admin_id: string | null; activated_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}
interface RegEvent { id: number; registration_id: string; at: string; actor: string | null; action: string; detail: Record<string, unknown> | null }

const STATUS: Record<Status, { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'orange' | 'navy' }> = {
  link_generated: { label: 'Link generated', tone: 'slate' }, in_progress: { label: 'In progress', tone: 'blue' }, submitted: { label: 'Submitted', tone: 'orange' },
  in_review: { label: 'In review', tone: 'violet' }, changes_requested: { label: 'Changes requested', tone: 'amber' }, approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' }, activated: { label: 'Activated', tone: 'navy' },
};
const EVENT: Record<string, string> = {
  link_created: 'Link generated', link_regenerated: 'New link generated', link_revoked: 'Link revoked', link_emailed: 'Link emailed', started: 'Applicant started the form',
  submitted: 'Submitted', resubmitted: 'Corrections submitted', review_started: 'Review started', changes_requested: 'Changes requested', rejected: 'Rejected',
  approved: 'Approved', provisioning_started: 'Partner account creation started', provisioning_failed: 'Partner account creation failed', activated: 'Partner account created — Activated',
};
const linkUrl = (token: string) => `${window.location.origin}${window.location.pathname}#/partner-registration/${token}`;
const linkState = (r: Registration) => (r.link_status !== 'active' ? r.link_status : r.link_expires_at && new Date(r.link_expires_at) < new Date() ? 'expired' : 'active');
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Not configured' };
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: serverMessage(error) } : { ok: true, data: data as T };
}

function useRegistrations() {
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return setRows([]);
    const { data, error: e } = await supabase.from('partner_registrations').select('*').order('created_at', { ascending: false }).limit(2000);
    if (e) { setError(/partner_registrations/.test(e.message) ? 'Run migration 0030 to enable Partner Registrations.' : 'Registrations could not be loaded.'); setRows([]); return; }
    setError(null);
    setRows((data ?? []) as Registration[]);
  }, []);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const sb = supabase;
    let t = 0;
    const ch = sb.channel(`registrations-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_registrations' }, () => { window.clearTimeout(t); t = window.setTimeout(() => void load(), 250); })
      .subscribe();
    return () => { window.clearTimeout(t); void sb.removeChannel(ch); };
  }, [load]);
  return { rows, error, reload: load };
}

export default function PartnerRegistrations() {
  const { db, session } = useStore();
  const { rows, error, reload } = useRegistrations();
  const [tab, setTab] = useState<'all' | Status>('all');
  const [q, setQ] = useState('');
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState<{ reg: Pick<Registration, 'id' | 'company_name' | 'intended_email' | 'reference'>; token: string; expiresAt: string; kind: 'invite' | 'changes' } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const all = rows ?? [];
  const list = all.filter((r) => (tab === 'all' || r.status === tab)
    && matches(q, r.company_name, r.reference, r.country ?? '', r.intended_email ?? '', String(r.answers.contact_email ?? ''), String(r.answers.registered_email ?? ''), String(r.answers.country ?? '')));
  const paged = usePaged(list, 20, `${tab}${q}`);
  const count = (s: Status) => all.filter((r) => r.status === s).length;
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session.name : 'Admin') : '—');
  const selected = all.find((r) => r.id === openId) ?? null;

  return (
    <>
      <Link to="../partners" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-rust"><ArrowLeft className="h-4 w-4" /> Clients &amp; Branches</Link>
      <PageHeader title="Partner Registrations" subtitle="Send a company its own registration link, review what it submits, and create the partner only after approval."
        actions={<Button icon={Link2} onClick={() => setGenerating(true)}>Generate Partner Registration Link</Button>} />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KPI icon={Link2} label="Link generated" value={count('link_generated')} onClick={() => setTab('link_generated')} />
        <KPI icon={FileText} tone="navy" label="In progress" value={count('in_progress')} onClick={() => setTab('in_progress')} />
        <KPI icon={Send} tone="orange" label="Pending review" value={count('submitted') + count('in_review')} hint={`${count('submitted')} new · ${count('in_review')} in review`} onClick={() => setTab('submitted')} />
        <KPI icon={MessageSquareWarning} tone="amber" label="Changes requested" value={count('changes_requested')} onClick={() => setTab('changes_requested')} />
        <KPI icon={CheckCircle2} tone="green" label="Approved" value={count('approved')} hint="Awaiting partner account" onClick={() => setTab('approved')} />
        <KPI icon={XCircle} tone="red" label="Rejected" value={count('rejected')} onClick={() => setTab('rejected')} />
        <KPI icon={UserPlus} tone="navy" label="Activated partners" value={count('activated')} onClick={() => setTab('activated')} />
      </div>
      <Card>
        <div className="border-b border-line px-4 pt-3">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All registrations', count: all.length }, ...(Object.keys(STATUS) as Status[]).map((s) => ({ value: s, label: STATUS[s].label, count: count(s) || undefined }))]} />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Company, email, country or reference…" className="w-full sm:w-80" />
        </div>
        {rows === null ? <div className="p-6 text-sm text-ink-soft">Loading…</div> : list.length === 0 ? (
          <EmptyState icon={Link2} title={all.length ? 'Nothing matches' : 'No registrations yet'} description={all.length ? undefined : 'Generate a registration link for a company to start.'}
            action={!all.length ? <Button icon={Plus} onClick={() => setGenerating(true)}>Generate link</Button> : undefined} />
        ) : (
          <>
            <Table className="hr-table" head={['Company', 'Primary contact', 'Email', 'Country', 'Link', 'Submitted', 'Status', 'Reviewer', '']}>
              {paged.rows.map((r) => {
                const ls = linkState(r);
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <td className="min-w-[180px]"><div className="font-medium text-heading">{r.company_name}</div><div className="text-xs text-ink-mute">{r.reference}</div></td>
                    <td>{String(r.answers.contact_full_name ?? '') || '—'}</td>
                    <td className="max-w-[200px] truncate">{String(r.answers.contact_email ?? '') || r.intended_email || '—'}</td>
                    <td>{String(r.answers.country ?? '') || r.country || '—'}</td>
                    <td><Badge tone={ls === 'active' ? 'green' : ls === 'expired' ? 'amber' : 'slate'}>{ls === 'active' ? 'Active' : ls === 'expired' ? 'Expired' : ls === 'revoked' ? 'Revoked' : 'Closed'}</Badge></td>
                    <td className="whitespace-nowrap text-xs">{r.submitted_at ? fmt(r.submitted_at) : '—'}{r.submission_count > 1 && <div className="text-ink-mute">revision {r.submission_count}</div>}</td>
                    <td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    <td className="text-xs">{staffName(r.assigned_reviewer)}</td>
                    <td className="text-right"><Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>Open</Button></td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={list.length} label="registrations" />
          </>
        )}
      </Card>
      <GenerateModal open={generating} onClose={() => setGenerating(false)} onCreated={(reg, token, expiresAt) => { setGenerating(false); setLink({ reg, token, expiresAt, kind: 'invite' }); void reload(); }} />
      <LinkModal value={link} onClose={() => setLink(null)} onRegenerated={(token, expiresAt) => link && setLink({ ...link, token, expiresAt })} onView={(id) => { setLink(null); setOpenId(id); }} />
      {selected && <DetailsModal reg={selected} staffName={staffName} onClose={() => setOpenId(null)} onLink={(token, expiresAt, kind) => setLink({ reg: selected, token, expiresAt, kind })} reload={reload} />}
    </>
  );
}

// ------------------------------------------------------------------ generate

function GenerateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (reg: Pick<Registration, 'id' | 'company_name' | 'intended_email' | 'reference'>, token: string, expiresAt: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ company: '', email: '', country: '', days: '14', notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ company: '', email: '', country: '', days: '14', notes: '' }); }, [open]);
  const emailErr = f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) ? 'Enter a valid email' : '';
  const save = async () => {
    setBusy(true);
    const r = await rpc<{ id: string; reference: string; token: string; expires_at: string }>('create_partner_registration',
      { p_company: f.company.trim(), p_email: f.email.trim() || null, p_country: f.country.trim() || null, p_days: Number(f.days), p_notes: f.notes.trim() || null });
    setBusy(false);
    if (!r.ok) return toast.error('Link not created', r.error);
    onCreated({ id: r.data.id, company_name: f.company.trim(), intended_email: f.email.trim() || null, reference: r.data.reference }, r.data.token, r.data.expires_at);
  };
  return (
    <Modal open={open} onClose={onClose} title="Generate Partner Registration Link" subtitle="Only the company name is needed. The link opens a registration form for this company — it never gives portal access or creates an account." dirty={!!f.company}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Link2} disabled={busy || f.company.trim().length < 2 || !!emailErr} onClick={() => void save()}>{busy ? 'Generating…' : 'Generate Link'}</Button></>}>
      <div className="space-y-4">
        <Field label="Company Name" required><Input value={f.company} maxLength={160} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="e.g. Sterling Education" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary Contact Email" hint="Optional — used to email the link" error={emailErr || undefined}><Input type="email" value={f.email} maxLength={200} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Country" hint="Optional"><Input value={f.country} maxLength={80} onChange={(e) => setF({ ...f, country: e.target.value })} /></Field>
        </div>
        <Field label="Link Expiration"><Segmented value={f.days} onChange={(v) => setF({ ...f, days: v })} options={[{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '60', label: '60 days' }]} /></Field>
        <Field label="Internal Notes" hint="Optional — never shown to the company"><Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function LinkModal({ value, onClose, onRegenerated, onView }: {
  value: { reg: Pick<Registration, 'id' | 'company_name' | 'intended_email' | 'reference'>; token: string; expiresAt: string; kind: 'invite' | 'changes' } | null;
  onClose: () => void; onRegenerated: (token: string, expiresAt: string) => void; onView: (id: string) => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  useEffect(() => { if (value) { setEmail(value.reg.intended_email ?? ''); setConfirmRevoke(false); } }, [value]);
  if (!value) return null;
  const url = linkUrl(value.token);
  const expires = new Date(value.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const message = value.kind === 'changes'
    ? `Hello,\n\nSSI GLOBAL has reviewed the partner registration for ${value.reg.company_name} and needs a few corrections. Please open your registration form here:\n${url}\n\nThe link is valid until ${expires}.\n\nThank you,\nSSI GLOBAL`
    : `Hello,\n\nThank you for your interest in partnering with SSI GLOBAL. Please register ${value.reg.company_name} using this secure form:\n${url}\n\nThe link is valid until ${expires}. Submitting the form starts our review — it does not activate a partner account.\n\nThank you,\nSSI GLOBAL`;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); } catch { toast.error('Could not copy', 'Select the text and copy it instead.'); }
  };
  const sendEmail = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke('partner-registration', { body: { action: 'email_link', registrationId: value.reg.id, token: value.token, kind: value.kind, email: email.trim() } });
    setBusy(false);
    if (error) {
      const ctx = (error as { context?: unknown }).context;
      const msg = ctx instanceof Response ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : null;
      return toast.error('Email not sent', msg ?? 'The email service could not be reached.');
    }
    toast.success('Link emailed', `Sent to ${email.trim()}.`);
  };
  const regenerate = async () => {
    setBusy(true);
    const r = await rpc<{ token: string; expires_at: string }>('regenerate_registration_link', { p_id: value.reg.id, p_days: 14 });
    setBusy(false);
    if (!r.ok) return toast.error('Not regenerated', r.error);
    onRegenerated(r.data.token, r.data.expires_at);
    toast.success('New link generated', 'The previous link no longer works.');
  };
  const revoke = async () => {
    setBusy(true);
    const r = await rpc('revoke_registration_link', { p_id: value.reg.id, p_reason: 'Revoked from the link window' });
    setBusy(false);
    if (!r.ok) return toast.error('Not revoked', r.error);
    toast.success('Link revoked', 'It no longer opens the form.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={value.kind === 'changes' ? 'Correction link ready' : 'Registration link ready'} subtitle={`${value.reg.company_name} · ${value.reg.reference} · valid until ${expires}`}
      footer={<><Button variant="secondary" onClick={() => onView(value.reg.id)}>View Registration Status</Button><Button onClick={onClose}>Done</Button></>}>
      <div className="space-y-4">
        <Alert tone="warning">Copy or send this link now. For security only a fingerprint of it is stored, so it can't be shown again — generate a new link if you need it later.</Alert>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas p-2">
          <code className="min-w-0 flex-1 truncate px-2 text-xs text-heading" title={url}>{url}</code>
          <Button size="sm" icon={ClipboardCopy} onClick={() => void copy(url, 'Link')}>Copy Link</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Open Form Preview</Button>
          <Button size="sm" variant="secondary" icon={ClipboardCopy} onClick={() => void copy(message, 'Invitation message')}>Copy Invitation Message</Button>
          <Button size="sm" variant="secondary" icon={RefreshCw} disabled={busy} onClick={() => void regenerate()}>Regenerate Link</Button>
          {confirmRevoke ? <Button size="sm" variant="danger" icon={ShieldOff} disabled={busy} onClick={() => void revoke()}>Confirm revoke</Button>
            : <Button size="sm" variant="ghost" icon={ShieldOff} onClick={() => setConfirmRevoke(true)}>Revoke Link</Button>}
        </div>
        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 text-sm font-semibold text-heading">Email the link</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" value={email} icon={Mail} onChange={(e) => setEmail(e.target.value)} placeholder="contact@company.com" className="flex-1" />
            <Button icon={Send} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())} onClick={() => void sendEmail()}>Send email</Button>
          </div>
          <p className="mt-1.5 text-xs text-ink-mute">Or share it through WhatsApp with “Copy Invitation Message”.</p>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ details & review

function DetailsModal({ reg, staffName, onClose, onLink, reload }: {
  reg: Registration; staffName: (id: string | null) => string; onClose: () => void;
  onLink: (token: string, expiresAt: string, kind: 'invite' | 'changes') => void; reload: () => Promise<void> | void;
}) {
  const toast = useToast();
  const { db, session } = useStore();
  const [events, setEvents] = useState<RegEvent[]>([]);
  const [revisions, setRevisions] = useState<{ revision: number; answers: Answers; submitted_at: string }[]>([]);
  const [rev, setRev] = useState<number | 'current'>('current');
  const [dialog, setDialog] = useState<'changes' | 'reject' | 'approve' | 'create' | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const loadExtra = useCallback(async () => {
    if (!supabase) return;
    const [ev, rv] = await Promise.all([
      supabase.from('partner_registration_events').select('*').eq('registration_id', reg.id).order('at', { ascending: false }),
      supabase.from('partner_registration_revisions').select('revision, answers, submitted_at').eq('registration_id', reg.id).order('revision', { ascending: false }),
    ]);
    setEvents((ev.data ?? []) as RegEvent[]);
    setRevisions((rv.data ?? []) as { revision: number; answers: Answers; submitted_at: string }[]);
  }, [reg.id]);
  useEffect(() => { void loadExtra(); }, [loadExtra, reg.updated_at]);
  const answers = rev === 'current' ? reg.answers : revisions.find((r) => r.revision === rev)?.answers ?? reg.answers;
  const prev = revisions.length > 1 ? revisions[1].answers : null;
  const isSuper = session?.userRole === 'super_admin';
  const duplicate = useMemo(() => {
    const name = reg.company_name.trim().toLowerCase();
    const emails = [reg.answers.registered_email, reg.answers.company_email, reg.answers.contact_email].map((e) => String(e ?? '').toLowerCase()).filter(Boolean);
    return db.partners.find((p) => p.name.trim().toLowerCase() === name || emails.includes(String(p.email ?? '').toLowerCase()));
  }, [db.partners, reg]);
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const r = await rpc(fn, args);
    if (!r.ok) { toast.error('Not done', r.error); return false; }
    toast.success(ok);
    void reload();
    void loadExtra();
    return true;
  };
  const openFile = async (key: string) => {
    if (!supabase) return;
    const fileId = reg.files[key]?.id;
    const { data: f } = await supabase.from('partner_registration_files').select('storage_path').eq('id', fileId).maybeSingle();
    if (!f) return toast.error('File not found');
    const { data, error } = await supabase.storage.from('partner-registration-files').createSignedUrl(f.storage_path as string, 60);
    if (error || !data) return toast.error('Could not open the file');
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  const canReview = reg.status === 'submitted' || reg.status === 'in_review';
  const prefill = {
    name: String(reg.answers.company_name_correction ?? '') || reg.company_name, contactName: String(reg.answers.contact_full_name ?? ''),
    email: String(reg.answers.company_email ?? reg.answers.contact_email ?? ''), phone: String(reg.answers.contact_number ?? reg.answers.contact_mobile ?? ''),
    country: String(reg.answers.country ?? reg.country ?? 'India'), branch: String(reg.answers.city ?? ''), address: [reg.answers.office_address, reg.answers.state, reg.answers.postal_code].filter(Boolean).join(', '),
    loginEmail: String(reg.answers.registered_email ?? reg.answers.contact_email ?? ''),
  };
  return (
    <>
      <Modal open onClose={onClose} size="xl" title={reg.company_name} subtitle={`${reg.reference} · ${STATUS[reg.status].label}${reg.submitted_at ? ` · submitted ${fmt(reg.submitted_at)}` : ''}`}
        footer={<div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {(reg.status === 'link_generated' || reg.status === 'in_progress' || reg.status === 'changes_requested') && <>
              <Button size="sm" variant="secondary" icon={RefreshCw} onClick={async () => { const r = await rpc<{ token: string; expires_at: string }>('regenerate_registration_link', { p_id: reg.id, p_days: 14 }); if (!r.ok) return toast.error('Not regenerated', r.error); onLink(r.data.token, r.data.expires_at, reg.status === 'changes_requested' ? 'changes' : 'invite'); void reload(); }}>New link</Button>
              {reg.link_status === 'active' && <Button size="sm" variant="ghost" icon={ShieldOff} onClick={() => void act('revoke_registration_link', { p_id: reg.id, p_reason: 'Revoked from registration details' }, 'Link revoked')}>Revoke link</Button>}
            </>}
          </div>
          <div className="flex flex-wrap gap-2">
            {reg.status === 'submitted' && <Button size="sm" variant="secondary" onClick={() => void act('start_registration_review', { p_id: reg.id }, 'Review started')}>Start review</Button>}
            {canReview && <>
              <Button size="sm" variant="secondary" icon={MessageSquareWarning} onClick={() => setDialog('changes')}>Request Changes</Button>
              <Button size="sm" variant="danger" icon={XCircle} onClick={() => setDialog('reject')}>Reject</Button>
              <Button size="sm" icon={CheckCircle2} onClick={() => setDialog('approve')}>Approve</Button>
            </>}
            {reg.status === 'approved' && <>
              <Button size="sm" variant="danger" icon={XCircle} onClick={() => setDialog('reject')}>Reject</Button>
              {isSuper ? <Button size="sm" icon={UserPlus} disabled={!!reg.provisioning_since} onClick={() => setDialog('create')}>Approve &amp; Create Partner</Button>
                : <span className="self-center text-xs text-ink-mute">A Super Admin creates the partner account.</span>}
            </>}
          </div>
        </div>}>
        <div className="space-y-5">
          {reg.status === 'activated' && <Alert tone="success" title="Partner activated">Partner account created {fmt(reg.activated_at)}. <Link to={`../partners/${reg.partner_id}`} className="font-semibold underline" onClick={onClose}>Open partner</Link></Alert>}
          {reg.status === 'approved' && duplicate && <Alert tone="warning" title="A similar partner already exists">“{duplicate.name}” has the same name or email. Check before creating another partner.</Alert>}
          {reg.status === 'rejected' && <Alert tone="error" title="Rejected">{reg.decision_reason} · {staffName(reg.reviewed_by)}, {fmt(reg.reviewed_at)}</Alert>}
          {reg.status === 'changes_requested' && reg.change_request && <Alert tone="warning" title="Changes requested">{reg.change_request.reason}{reg.change_request.fields.length ? ` · ${reg.change_request.fields.map((k) => fieldByKey.get(k)?.label ?? k).join(', ')}` : ''}</Alert>}
          {reg.internal_notes && <Alert tone="info" title="Internal notes">{reg.internal_notes}</Alert>}
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <Info k="Reference" v={reg.reference} /><Info k="Link" v={linkState(reg)} /><Info k="Reviewer" v={staffName(reg.assigned_reviewer)} />
            <Info k="Login email" v={`${String(reg.answers.registered_email ?? '—')}${reg.verified_email && reg.verified_email === String(reg.answers.registered_email ?? '').toLowerCase() ? ' ✓ verified' : reg.answers.registered_email ? ' (not verified)' : ''}`} />
          </div>
          {revisions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-soft">Showing:</span>
              <FilterSelect label="Revision" value={String(rev)} onChange={(v) => setRev(v === 'current' ? 'current' : Number(v))}
                options={[{ value: 'current', label: 'Latest' }, ...revisions.map((r) => ({ value: String(r.revision), label: `Revision ${r.revision} · ${fmt(r.submitted_at)}` }))]} />
              {rev === 'current' && <span className="text-xs text-ink-mute">Changed answers since the previous submission are highlighted.</span>}
            </div>
          )}
          {Object.keys(answers).length <= 1 && !reg.submitted_at ? <EmptyState icon={FileText} title="Nothing submitted yet" description={reg.first_opened_at ? `Opened ${fmt(reg.first_opened_at)}.` : 'The company has not opened the link yet.'} /> : FORM_SECTIONS.map((s, i) => (
            <Card key={s.id}>
              <CardHeader title={`Section ${i + 1} – ${s.title}`} />
              <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 sm:grid-cols-2">
                {s.fields.filter((f) => !f.showWhen || answers[f.showWhen.key] === f.showWhen.equals).map((f) => {
                  const v = answers[f.key];
                  const changed = rev === 'current' && prev && f.type !== 'file' && JSON.stringify(prev[f.key] ?? null) !== JSON.stringify(v ?? null);
                  return (
                    <div key={f.key} className={cn((f.type === 'textarea' || f.type === 'checkbox') && 'sm:col-span-2', changed && 'rounded-lg bg-amber-50 p-1.5 dark:bg-amber-500/10')}>
                      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{f.type === 'checkbox' ? 'Declaration' : f.label}{f.source === 'added' && <span className="ml-1 normal-case tracking-normal text-ink-mute">(added)</span>}{changed && <span className="ml-1 text-amber-700">changed</span>}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-heading">
                        {f.type === 'file' ? (reg.files[f.key] ? <button type="button" className="inline-flex items-center gap-1 font-semibold text-rust hover:underline" onClick={() => void openFile(f.key)}><Download className="h-3.5 w-3.5" />{reg.files[f.key].name}</button> : '—')
                          : f.type === 'checkbox' ? <>{v === true ? '✓' : '✗'} {f.label}</> : (v as string) || '—'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Card>
          ))}
          <Card>
            <CardHeader title="Review history" />
            {events.length === 0 ? <EmptyState icon={History} title="No history" /> : (
              <ol className="space-y-2 px-5 pb-5">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-heading">{EVENT[e.action] ?? e.action}{e.detail && (e.detail.reason || e.detail.note) ? <span className="font-normal text-ink-soft"> — {String(e.detail.reason ?? e.detail.note)}</span> : null}</span>
                    <span className="text-xs text-ink-mute">{e.actor ? staffName(e.actor) : 'Applicant'} · {fmt(e.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </Modal>
      <ChangesModal open={dialog === 'changes'} reg={reg} onClose={() => setDialog(null)} onDone={(token, expiresAt) => { setDialog(null); void reload(); onLink(token, expiresAt, 'changes'); }} />
      <ReasonModal open={dialog === 'reject'} title="Reject registration" danger confirm="Reject registration" label="Internal reason" required
        body="The company is not given a partner account. The submitted information is kept, and the link stops working."
        onClose={() => setDialog(null)} onConfirm={async (reason) => { if (await act('reject_registration', { p_id: reg.id, p_reason: reason }, 'Registration rejected')) setDialog(null); }} />
      <ReasonModal open={dialog === 'approve'} title="Approve registration" confirm="Approve" label="Note (optional)"
        body="Approval does not create anything yet. A Super Admin then uses “Approve & Create Partner” to create the partner and its login."
        onClose={() => setDialog(null)} onConfirm={async (note) => { if (await act('approve_registration', { p_id: reg.id, p_note: note || null }, 'Registration approved')) setDialog(null); }} />
      <PartnerDialog open={dialog === 'create'} onClose={() => setDialog(null)} initial={prefill} registrationId={reg.id}
        onCreated={async (email, password, delivery) => { setDialog(null); setCreated(createdAccount(`${prefill.contactName || 'Partner Admin'}'s login`, email, password, delivery)); void reload(); void loadExtra(); }} />
      <CredentialsOnce data={created} onClose={() => setCreated(null)} />
    </>
  );
}

const Info = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl bg-canvas px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</div><div className="truncate font-medium capitalize text-heading">{v}</div></div>
);

function ChangesModal({ open, reg, onClose, onDone }: { open: boolean; reg: Registration; onClose: () => void; onDone: (token: string, expiresAt: string) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setFields([]); setInstructions(''); } }, [open]);
  const toggle = (k: string) => setFields((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  const save = async () => {
    setBusy(true);
    const r = await rpc<{ token: string; expires_at: string }>('request_registration_changes', { p_id: reg.id, p_reason: reason.trim(), p_fields: fields, p_instructions: instructions.trim() || null, p_days: 14 });
    setBusy(false);
    if (!r.ok) return toast.error('Not sent', r.error);
    toast.success('Changes requested', 'Send the new link to the company.');
    onDone(r.data.token, r.data.expires_at);
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Request Changes" subtitle="The company gets a new link to the same registration, with its previous answers. Earlier submissions are kept."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : 'Request changes'}</Button></>}>
      <div className="space-y-4">
        <Field label="Reason" required hint="Shown to the company"><Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Fields requiring correction">
          <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-line p-3">
            {FORM_SECTIONS.map((s) => (
              <div key={s.id}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-mute">{s.title}</div>
                <div className="grid gap-1 sm:grid-cols-2">{s.fields.filter((f) => !f.locked).map((f) => <Checkbox key={f.key} checked={fields.includes(f.key)} onCheckedChange={() => toggle(f.key)} label={f.type === 'checkbox' ? f.label.slice(0, 60) + (f.label.length > 60 ? '…' : '') : f.label} />)}</div>
              </div>
            ))}
          </div>
        </Field>
        <Field label="Additional Instructions" hint="Optional — shown to the company"><Textarea rows={2} maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ReasonModal({ open, title, body, label, required, danger, confirm, onClose, onConfirm }: {
  open: boolean; title: string; body: string; label: string; required?: boolean; danger?: boolean; confirm: string; onClose: () => void; onConfirm: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} disabled={busy || (required && text.trim().length < 3)} onClick={async () => { setBusy(true); await onConfirm(text.trim()); setBusy(false); }}>{confirm}</Button></>}>
      <p className="mb-3 text-sm text-ink-soft">{body}</p>
      <Field label={label} required={required}><Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Modal>
  );
}
