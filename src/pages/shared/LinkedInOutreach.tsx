// LinkedIn Outreach (Partnership Officers, Senior IRM): a manual list of people contacted on
// LinkedIn — no LinkedIn connection or scraping. Only a name is needed to start. Clicking a name
// opens the prospect's profile: contact status (Connected / Not connected, recorded only when
// chosen), details, activity history and "Move to Agency List", which needs the agency name, the
// point of contact's full name and a phone number, links to an existing agency instead of
// duplicating it, and keeps the LinkedIn history.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, ExternalLink, Linkedin, MessageSquare, MoreHorizontal, Pencil, Plus, Send, StickyNote, UserCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, DatePicker, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, Pagination, SearchInput, Segmented, Select, Table, Textarea, usePaged } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { cn, matches } from '../../lib/utils';
import { CONTACT, LI_ACTIVITY, LI_STATUS, agencyAccess, fmtDate, fmtWhen, rpc, today, useLinkedIn, type AgencyType, type ContactStatus, type LinkedInActivity, type LinkedInProspect, type LinkedInStatus } from '../../lib/agencies';

// LinkedIn log activity: exactly three actions (Abigail's Portal Development Specification).
type Kind = 'follow_up' | 'note' | 'stage';
const KIND: Record<Kind, { title: string; icon: typeof Send; report?: string }> = {
  follow_up: { title: 'Follow-up completed', icon: MessageSquare, report: 'Follow-up messages sent' },
  note: { title: 'Add note', icon: StickyNote },
  stage: { title: 'Change stage', icon: Pencil },
};
type LiStage = 'contacted' | 'responded' | 'interested' | 'not_interested';
const LI_STAGES: { value: LiStage; label: string; hint: string }[] = [
  { value: 'contacted', label: 'Contacted', hint: 'Outreach message sent.' },
  { value: 'responded', label: 'Responded', hint: 'They replied.' },
  { value: 'interested', label: 'Positive response', hint: 'Counts as a positive response and moves the contact to the Agency List — missing details are asked for.' },
  { value: 'not_interested', label: 'Closed', hint: 'Counts as Closed. The lead and its history are kept.' },
];

export default function LinkedInOutreach() {
  const { session, db } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const allowed = agencyAccess(session);
  const { rows, error, reload } = useLinkedIn(allowed);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [contact, setContact] = useState('');
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'edit'; p: LinkedInProspect } | { kind: 'log'; p: LinkedInProspect; log: Kind } | { kind: 'convert'; p: LinkedInProspect }>(null);
  // The open profile is kept by id so it always shows the live row (realtime updates).
  const [profileId, setProfileId] = useState<string | null>(params.get('p'));
  useEffect(() => {
    const id = params.get('p');
    if (id) { setProfileId(id); setParams((x) => { const n = new URLSearchParams(x); n.delete('p'); return n; }, { replace: true }); }
  }, [params, setParams]);
  const staffName = (id: string | null | undefined) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee') : '—');
  const shown = useMemo(() => (rows ?? []).filter((p) => (!status || p.status === status) && (!contact || (p.contact_status ?? 'unknown') === contact)
    && matches(q, p.name, p.company_name ?? '', p.phone ?? '', p.email ?? '', p.reference)), [rows, q, status, contact]);
  const paged = usePaged(shown, 20, `${q}|${status}|${contact}`);
  const profile = profileId ? rows?.find((r) => r.id === profileId) ?? null : null;
  if (!allowed) return <Card><EmptyState icon={Linkedin} title="LinkedIn Outreach is not available" description="Ask an administrator for the Agencies & proposals permission." /></Card>;

  return (
    <>
      <PageHeader title="LinkedIn Outreach" subtitle="People you contact on LinkedIn, tracked by hand. Open a prospect to record the contact status or move them to the Agency List."
        actions={<Button icon={Plus} onClick={() => setModal({ kind: 'add' })}>Add LinkedIn Prospect</Button>} />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, company, phone, email…" className="w-full sm:w-72" />
          <FilterSelect label="Contact" value={contact} onChange={setContact} options={[{ value: '', label: 'Any contact status' }, ...(Object.keys(CONTACT) as ContactStatus[]).map((k) => ({ value: k, label: CONTACT[k].label }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...(Object.keys(LI_STATUS) as LinkedInStatus[]).map((k) => ({ value: k, label: LI_STATUS[k].label }))]} />
          <span className="ml-auto text-xs text-ink-mute">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
        </div>
        {!rows ? <p className="p-6 text-sm text-ink-soft" role="status">Loading prospects…</p> : shown.length === 0 ? (
          <EmptyState icon={Linkedin} title={rows.length ? 'Nothing matches' : 'No LinkedIn prospects yet'} description={rows.length ? undefined : 'Add someone as soon as you connect — a name is enough.'}
            action={!rows.length ? <Button icon={Plus} onClick={() => setModal({ kind: 'add' })}>Add LinkedIn Prospect</Button> : undefined} />
        ) : (
          <>
            <Table className="hr-table" head={['Prospect', 'Company', 'Contact', 'Outreach', 'Last contact', 'Follow-up', 'Employee', 'Agency', '']}>
              {paged.rows.map((p) => {
                const due = p.next_follow_up && p.next_follow_up <= today() && p.status !== 'converted';
                const cs = CONTACT[p.contact_status ?? 'unknown'];
                return (
                  <tr key={p.id}>
                    <td className="min-w-[160px]">
                      <button type="button" className="text-left font-medium text-heading hover:text-rust hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => setProfileId(p.id)}>{p.name}</button>
                      <div className="text-xs text-ink-mute">{p.reference}</div>
                    </td>
                    <td className="text-sm">{p.company_name ?? '—'}<div className="text-xs text-ink-mute">{[p.phone, p.email].filter(Boolean).join(' · ')}</div></td>
                    <td><Badge tone={cs.tone} dot>{cs.label}</Badge></td>
                    <td><Badge tone={LI_STATUS[p.status].tone}>{LI_STATUS[p.status].label}</Badge></td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(p.last_contact_at)}</td>
                    <td className={`whitespace-nowrap text-sm ${due ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtDate(p.next_follow_up)}</td>
                    <td className="text-sm">{staffName(p.assigned_to)}</td>
                    <td className="text-sm">{p.agency_id ? <Button size="sm" variant="ghost" onClick={() => navigate(`../${p.agency_id}`, { relative: 'path' })}>Open agency</Button> : <span className="text-ink-mute">Not moved</span>}</td>
                    <td className="whitespace-nowrap text-right"><Button size="sm" variant="secondary" icon={UserCheck} onClick={() => setProfileId(p.id)}>Open profile</Button></td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={shown.length} label="prospects" />
          </>
        )}
      </Card>
      {profile && <ProspectProfile p={profile} staffName={staffName} onClose={() => setProfileId(null)}
        onEdit={() => setModal({ kind: 'edit', p: profile })} onLog={(k) => setModal({ kind: 'log', p: profile, log: k })}
        onConvert={() => setModal({ kind: 'convert', p: profile })} onOpenAgency={(id) => navigate(`../${id}`, { relative: 'path' })} onChanged={reload} />}
      {modal?.kind === 'log' && modal.log === 'stage' && <LinkedInStage p={modal.p} onClose={() => setModal(null)} onSaved={reload}
        onNeedsDetails={() => setModal({ kind: 'convert', p: modal.p })} onConverted={(id) => { setModal(null); setProfileId(null); navigate(`../${id}`, { relative: 'path' }); }} />}
      {(modal?.kind === 'add' || modal?.kind === 'edit') && <ProspectForm p={modal.kind === 'edit' ? modal.p : undefined} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'log' && modal.log !== 'stage' && <LogLinkedIn p={modal.p} kind={modal.log} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'convert' && <MoveToAgency p={modal.p} onClose={() => setModal(null)} onDone={() => void reload()} />}
    </>
  );
}

// ------------------------------------------------------------------ profile
function ProspectProfile({ p, staffName, onClose, onEdit, onLog, onConvert, onOpenAgency, onChanged }: {
  p: LinkedInProspect; staffName: (id: string | null | undefined) => string; onClose: () => void; onEdit: () => void; onLog: (k: Kind) => void;
  onConvert: () => void; onOpenAgency: (id: string) => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<LinkedInActivity[] | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return setRows([]);
    const { data } = await supabase.from('linkedin_activities').select('*').eq('prospect_id', p.id).order('at', { ascending: false }).limit(300);
    setRows((data ?? []) as LinkedInActivity[]);
  }, [p.id]);
  // Re-read the history whenever the prospect changes (realtime row update).
  useEffect(() => { void load(); }, [load, p.updated_at]);
  const cs = p.contact_status ?? 'unknown';
  const converted = p.status === 'converted' || !!p.agency_id;
  const setContact = async (v: 'connected' | 'not_connected') => {
    if (v === cs) return;
    setBusy(true);
    const r = await rpc('set_linkedin_contact_status', { p_id: p.id, p_status: v, p_note: null, p_request: crypto.randomUUID() });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(`Contact status: ${CONTACT[v].label}`); onChanged();
  };
  const url = p.linkedin_url ? (p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`) : null;
  const rowsOf: [string, React.ReactNode][] = [
    ['Company', p.company_name], ['Phone', p.phone], ['Email', p.email],
    ['LinkedIn profile', url ? <a className="text-rust underline" href={url} target="_blank" rel="noreferrer noopener">{p.linkedin_url}</a> : null],
    ['Assigned officer', staffName(p.assigned_to)], ['Date added', fmtWhen(p.created_at)],
    ['Last contact', fmtDate(p.last_contact_at)], ['Next follow-up', fmtDate(p.next_follow_up)],
  ];
  return (
    <Modal open onClose={onClose} size="lg" title={p.name}
      subtitle={<span className="flex flex-wrap items-center gap-2">{p.reference}<Badge tone={LI_STATUS[p.status].tone}>{LI_STATUS[p.status].label}</Badge></span>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="secondary" icon={Pencil} onClick={onEdit}>Edit details</Button>
        {converted && p.agency_id
          ? <Button icon={ExternalLink} onClick={() => onOpenAgency(p.agency_id!)}>Open in Agency List</Button>
          : <Button icon={ArrowRightLeft} onClick={onConvert}>Move to Agency List</Button>}
      </>}>
      <div className="grid gap-5 md:grid-cols-5">
        <div className="space-y-4 md:col-span-3">
          <section className="rounded-2xl border border-line p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-heading">Contact status</h3>
              <Badge tone={CONTACT[cs].tone} dot>{CONTACT[cs].label}</Badge>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Contact status">
              {(['connected', 'not_connected'] as const).map((v) => (
                <button key={v} type="button" disabled={busy || converted} aria-pressed={cs === v} onClick={() => void setContact(v)}
                  className={cn('rounded-xl border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-60',
                    cs === v ? 'border-rust bg-brand-50 text-rust dark:bg-brand-500/10' : 'border-line text-ink-soft hover:border-brand-300 hover:text-heading')}>
                  {CONTACT[v].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-mute">
              {cs === 'unknown' ? 'Not recorded yet — choose one once you know the outcome.' : `Set by ${staffName(p.contact_changed_by)} · ${fmtWhen(p.contact_changed_at)}`}
              {converted ? ' · Now tracked in the Agency List.' : ''}
            </p>
          </section>
          <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-line p-4 text-sm sm:grid-cols-2">
            {rowsOf.map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="mt-0.5 break-words text-heading">{v || <span className="text-ink-mute">—</span>}</dd></div>
            ))}
          </dl>
          {p.notes && <div><h3 className="mb-1 text-sm font-semibold text-heading">Contact notes</h3><p className="whitespace-pre-wrap rounded-2xl bg-canvas p-3 text-sm text-ink-soft">{p.notes}</p></div>}
          {p.conversion_pending && !converted && (
            <Alert tone="warning" title="Positive response — Agency List pending">Add the agency name and a phone number to finish moving this contact. <Button size="sm" variant="secondary" className="ml-1" onClick={onConvert}>Complete details</Button></Alert>
          )}
          <section className="rounded-2xl border border-line p-4">
            <h3 className="text-sm font-semibold text-heading">Agency conversion</h3>
            {converted ? <p className="mt-1 text-sm text-ink-soft">Moved to the Agency List{p.converted_at ? ` on ${fmtWhen(p.converted_at)}` : ''}. Proposals, registration and onboarding continue there.</p>
              : <p className="mt-1 text-sm text-ink-soft">Not moved yet. Moving needs the agency name, the point of contact's full name and a phone number; email can wait until a proposal is sent.</p>}
          </section>
        </div>
        <div className="md:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-heading">Activity history</h3>
            <Menu width="w-56" trigger={() => <Button size="sm" variant="secondary" icon={MoreHorizontal}>Log activity</Button>} items={
              (converted ? (['note'] as Kind[]) : (['follow_up', 'note', 'stage'] as Kind[])).map((k) => ({ label: KIND[k].title, icon: KIND[k].icon, onClick: () => onLog(k) }))} />
          </div>
          {!rows ? <p className="text-sm text-ink-soft">Loading…</p> : rows.length === 0 ? <p className="text-sm text-ink-soft">No activity yet.</p> : (
            <ol className="max-h-[420px] overflow-y-auto pr-1">{rows.map((h) => (
              <li key={h.id} className="border-l-2 border-line py-2 pl-4">
                <div className="text-sm font-medium text-heading">{LI_ACTIVITY[h.kind] ?? h.kind}{h.kind === 'contact_status' && typeof h.detail?.to === 'string' ? ` · ${CONTACT[h.detail.to as ContactStatus]?.label ?? h.detail.to}` : ''}</div>
                {h.note && <div className="whitespace-pre-wrap text-sm text-ink-soft">{h.note}</div>}
                <div className="text-xs text-ink-mute">{fmtWhen(h.at)} · {staffName(h.actor)}</div>
              </li>
            ))}</ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ProspectForm({ p, onClose, onSaved }: { p?: LinkedInProspect; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: p?.name ?? '', company_name: p?.company_name ?? '', phone: p?.phone ?? '', email: p?.email ?? '', linkedin_url: p?.linkedin_url ?? '', notes: p?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.name.trim()) return setErr('Enter the name.');
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('Enter a valid email address, or leave it empty.');
    setBusy(true); setErr('');
    const r = p ? await rpc('update_linkedin_prospect', { p_id: p.id, p: f }) : await rpc<{ reference: string }>('create_linkedin_prospect', { p: f, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(p ? 'Prospect updated' : 'LinkedIn prospect added'); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={p ? 'Edit LinkedIn prospect' : 'Add LinkedIn Prospect'} subtitle={p ? p.reference : 'Only the name is needed now.'} dirty={!!f.name.trim() && !p}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>{p ? 'Save' : 'Add prospect'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={set('name')} maxLength={120} autoFocus /></Field>
        <Field label="Company / agency"><Input value={f.company_name} onChange={set('company_name')} maxLength={160} /></Field>
        <Field label="LinkedIn profile link"><Input value={f.linkedin_url} onChange={set('linkedin_url')} maxLength={300} placeholder="linkedin.com/in/…" /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} maxLength={200} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={3} value={f.notes} onChange={set('notes')} maxLength={4000} /></Field>
      </div>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

function LogLinkedIn({ p, kind, onClose, onSaved }: { p: LinkedInProspect; kind: Kind; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [req] = useState(() => crypto.randomUUID());
  const save = async () => {
    if (busy) return;
    if (kind === 'note' && !note.trim()) return toast.error('Write the note');
    setBusy(true);
    const r = await rpc('log_linkedin_activity', { p_id: p.id, p_kind: kind, p_note: note || null, p_next: next || null, p_request: req });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(`${KIND[kind].title} — saved`); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={KIND[kind].title} subtitle={p.name} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      <Field label="Note" required={kind === 'note'}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus /></Field>
      {kind === 'follow_up' && <Field label="Next follow-up (optional)" className="mt-3"><DatePicker value={next} onChange={setNext} min={today()} /></Field>}
      <p className="mt-3 text-xs text-ink-mute">{KIND[kind].report ? `Counts in your Daily Work Report (${KIND[kind].report}).` : 'Saved to the history. It does not change any report figure.'}</p>
    </Modal>
  );
}

function LinkedInStage({ p, onClose, onSaved, onNeedsDetails, onConverted }: {
  p: LinkedInProspect; onClose: () => void; onSaved: () => void; onNeedsDetails: () => void; onConverted: (agencyId: string) => void;
}) {
  const toast = useToast();
  const [stage, setStage] = useState<LiStage>(p.status === 'not_contacted' ? 'contacted' : p.status === 'contacted' ? 'responded' : 'interested');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [req] = useState(() => crypto.randomUUID());
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const r = await rpc<{ status: string; agency_id?: string; conversion_pending?: boolean; missing?: string[] }>('set_linkedin_stage',
      { p_id: p.id, p_stage: stage, p_note: note || null, p_next: next || null, p_request: req });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    onSaved();
    if (r.data.status === 'converted' && r.data.agency_id) {
      toast.success('Positive response — moved to the Agency List', 'The LinkedIn record and its history are kept.');
      return onConverted(r.data.agency_id);
    }
    if (r.data.conversion_pending) {
      toast.info('Positive response recorded', `To finish moving to the Agency List, add: ${(r.data.missing ?? []).join(', ')}.`);
      return onNeedsDetails();
    }
    toast.success(`Stage: ${LI_STAGES.find((s) => s.value === stage)?.label}`); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Change stage" subtitle={p.name}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <Field label="Stage"><Select value={stage} onChange={(e) => setStage(e.target.value as LiStage)}>{LI_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
      <p className="mt-2 text-xs text-ink-mute">{LI_STAGES.find((s) => s.value === stage)?.hint}</p>
      <Field label="Note" className="mt-3"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Field>
      {stage !== 'not_interested' && stage !== 'interested' && <Field label="Next follow-up (optional)" className="mt-3"><DatePicker value={next} onChange={setNext} min={today()} /></Field>}
    </Modal>
  );
}

const PHONE_OK = (s: string) => /^\+?[0-9 ()./-]{7,30}$/.test(s.trim()) && s.replace(/\D/g, '').length >= 7 && s.replace(/\D/g, '').length <= 15;
const EMAIL_OK = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const URL_OK = (s: string) => /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\//i.test(s.trim());

// Move to Agency List: agency name, the point of contact's full name and a phone number are
// required; everything else is optional. Fields already on the prospect are filled in.
function MoveToAgency({ p, onClose, onDone }: { p: LinkedInProspect; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ company_name: p.company_name ?? '', contact_name: p.name, phone: p.phone ?? '', email: p.email ?? '', country: '', linkedin_url: p.linkedin_url ?? '', notes: '' });
  const [agencyType, setAgencyType] = useState<AgencyType | ''>('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const errors: Partial<Record<keyof typeof f, string>> = {
    company_name: f.company_name.trim() ? undefined : 'Enter the agency / company name',
    contact_name: f.contact_name.trim() ? undefined : "Enter the point of contact's full name",
    phone: !f.phone.trim() ? 'Enter the phone number' : PHONE_OK(f.phone) ? undefined : 'Enter a valid phone number (7 to 15 digits)',
    email: f.email.trim() && !EMAIL_OK(f.email) ? 'Enter a valid email address, or leave it empty' : undefined,
    linkedin_url: f.linkedin_url.trim() && !URL_OK(f.linkedin_url) ? 'Enter a linkedin.com profile link, or leave it empty' : undefined,
  };
  const missing = Object.values(errors).filter(Boolean) as string[];
  const show = (k: keyof typeof f) => (tried ? errors[k] : undefined);
  const save = async () => {
    setTried(true); setErr('');
    if (missing.length) return;
    setBusy(true);
    const r = await rpc<{ agency_id: string; linked: boolean; duplicate: boolean }>('convert_linkedin_prospect', { p_id: p.id, p: { ...f, phone: f.phone.trim(), agency_type: agencyType || null } });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(r.data.linked ? 'Prospect linked to the existing agency' : 'Prospect successfully moved to Agency List.',
      r.data.linked ? 'An agency with this phone, email or name was already listed — no duplicate was created.' : 'Open it there to send a proposal.');
    onDone(); onClose();
    navigate(`../${r.data.agency_id}`, { relative: 'path' });
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Move to Agency List" subtitle={`${p.name} · ${p.reference}`} dirty
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={ArrowRightLeft} disabled={busy} onClick={() => void save()}>{busy ? 'Moving…' : 'Move to Agency List'}</Button></>}>
      {tried && missing.length > 0 && <Alert tone="warning" className="mb-4" title="Complete these to continue">{missing.join(' · ')}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Agency / company name" required error={show('company_name')}><Input value={f.company_name} onChange={set('company_name')} maxLength={160} invalid={!!show('company_name')} autoFocus={!f.company_name} /></Field>
        <Field label="Point of contact full name" required error={show('contact_name')}><Input value={f.contact_name} onChange={set('contact_name')} maxLength={120} invalid={!!show('contact_name')} /></Field>
        <Field label="Phone number" required error={show('phone')}><Input value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" invalid={!!show('phone')} placeholder="+91 98765 43210" /></Field>
        <Field label="Email address" hint="Optional now — needed before a proposal is sent" error={show('email')}><Input type="email" value={f.email} onChange={set('email')} maxLength={200} invalid={!!show('email')} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set('country')} maxLength={80} /></Field>
        <Field label="Agency type" hint="Optional — leave Not classified if unsure">
          <Segmented options={[{ value: '', label: 'Not classified' }, { value: 'domestic', label: 'Domestic' }, { value: 'international', label: 'International' }]} value={agencyType} onChange={(v) => setAgencyType(v as AgencyType | '')} />
        </Field>
        <Field label="LinkedIn profile link" error={show('linkedin_url')}><Input value={f.linkedin_url} onChange={set('linkedin_url')} maxLength={300} invalid={!!show('linkedin_url')} placeholder="linkedin.com/in/…" /></Field>
        <Field label="Additional notes" className="sm:col-span-2"><Textarea rows={3} value={f.notes} onChange={set('notes')} maxLength={2000} /></Field>
      </div>
      <p className="mt-3 text-xs text-ink-mute">The prospect and its LinkedIn history stay here, marked Converted and linked to the agency. If the Agency List already has this phone, email or name, it is linked instead of creating a duplicate. No partner login or portal access is created.</p>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}
