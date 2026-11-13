// LinkedIn Outreach (Partnership Officers, Senior IRM): a manual list of people contacted on
// LinkedIn — no LinkedIn connection or scraping. Only a name is needed to start. "Convert to
// Agency" needs a phone number and moves the prospect into the Agency List (or links it to the
// agency that already has that phone / email / name), keeping the LinkedIn history.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, CalendarPlus, Linkedin, MessageSquare, MoreHorizontal, Pencil, Plus, Send, StickyNote, ThumbsDown, ThumbsUp, UserCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, DatePicker, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, Pagination, SearchInput, Table, Textarea, usePaged } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { matches } from '../../lib/utils';
import { LI_ACTIVITY, LI_STATUS, agencyAccess, fmtDate, fmtWhen, rpc, today, useLinkedIn, type LinkedInActivity, type LinkedInProspect, type LinkedInStatus } from '../../lib/agencies';

type Kind = 'contacted' | 'follow_up' | 'response' | 'interested' | 'not_interested' | 'note' | 'follow_up_date';
const KIND: Record<Kind, { title: string; icon: typeof Send; report?: string }> = {
  contacted: { title: 'Record contact', icon: Send, report: 'LinkedIn connections contacted' }, follow_up: { title: 'Follow-up message sent', icon: MessageSquare, report: 'Follow-up messages' },
  response: { title: 'Record response', icon: MessageSquare }, interested: { title: 'Positive response', icon: ThumbsUp, report: 'Positive responses' },
  not_interested: { title: 'Not interested', icon: ThumbsDown, report: 'Closed' }, note: { title: 'Add note', icon: StickyNote }, follow_up_date: { title: 'Set follow-up date', icon: CalendarPlus },
};

export default function LinkedInOutreach() {
  const { session, db } = useStore();
  const navigate = useNavigate();
  const allowed = agencyAccess(session);
  const { rows, error, reload } = useLinkedIn(allowed);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'edit'; p: LinkedInProspect } | { kind: 'log'; p: LinkedInProspect; log: Kind } | { kind: 'convert'; p: LinkedInProspect } | { kind: 'history'; p: LinkedInProspect }>(null);
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee') : '—');
  const shown = useMemo(() => (rows ?? []).filter((p) => (!status || p.status === status) && matches(q, p.name, p.company_name ?? '', p.phone ?? '', p.email ?? '', p.reference)), [rows, q, status]);
  const paged = usePaged(shown, 20, `${q}|${status}`);
  if (!allowed) return <Card><EmptyState icon={Linkedin} title="LinkedIn Outreach is not available" description="Ask an administrator for the Agencies & proposals permission." /></Card>;

  return (
    <>
      <PageHeader title="LinkedIn Outreach" subtitle="People you contact on LinkedIn, tracked by hand. Convert them to the Agency List when they are interested."
        actions={<Button icon={Plus} onClick={() => setModal({ kind: 'add' })}>Add LinkedIn Prospect</Button>} />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, company, phone, email…" className="w-full sm:w-72" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...(Object.keys(LI_STATUS) as LinkedInStatus[]).map((k) => ({ value: k, label: LI_STATUS[k].label }))]} />
          <span className="ml-auto text-xs text-ink-mute">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
        </div>
        {!rows ? <p className="p-6 text-sm text-ink-soft" role="status">Loading prospects…</p> : shown.length === 0 ? (
          <EmptyState icon={Linkedin} title={rows.length ? 'Nothing matches' : 'No LinkedIn prospects yet'} description={rows.length ? undefined : 'Add someone as soon as you connect — a name is enough.'}
            action={!rows.length ? <Button icon={Plus} onClick={() => setModal({ kind: 'add' })}>Add LinkedIn Prospect</Button> : undefined} />
        ) : (
          <>
            <Table className="hr-table" head={['Prospect', 'Company', 'Status', 'Last contact', 'Follow-up', 'Employee', 'Conversion', '']}>
              {paged.rows.map((p) => {
                const due = p.next_follow_up && p.next_follow_up <= today() && p.status !== 'converted';
                return (
                  <tr key={p.id}>
                    <td className="min-w-[160px]"><button type="button" className="text-left font-medium text-heading hover:underline" onClick={() => setModal({ kind: 'history', p })}>{p.name}</button>
                      <div className="text-xs text-ink-mute">{p.reference}{p.linkedin_url ? <> · <a className="underline" href={p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`} target="_blank" rel="noreferrer noopener">profile</a></> : ''}</div></td>
                    <td className="text-sm">{p.company_name ?? '—'}<div className="text-xs text-ink-mute">{[p.phone, p.email].filter(Boolean).join(' · ')}</div></td>
                    <td><Badge tone={LI_STATUS[p.status].tone} dot>{LI_STATUS[p.status].label}</Badge></td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(p.last_contact_at)}</td>
                    <td className={`whitespace-nowrap text-sm ${due ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtDate(p.next_follow_up)}</td>
                    <td className="text-sm">{staffName(p.assigned_to)}</td>
                    <td className="text-sm">{p.agency_id ? <Button size="sm" variant="ghost" onClick={() => navigate(`../${p.agency_id}`, { relative: 'path' })}>Open agency</Button> : '—'}</td>
                    <td className="whitespace-nowrap">
                      {p.status !== 'converted' && <Button size="sm" variant="secondary" icon={ArrowRightLeft} onClick={() => setModal({ kind: 'convert', p })}>Convert to Agency</Button>}
                      <Menu width="w-56" trigger={() => <Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label={`Actions for ${p.name}`} />} items={[
                        ...(p.status !== 'converted' ? (['contacted', 'follow_up', 'response', 'interested', 'not_interested', 'follow_up_date'] as Kind[]).map((k) => ({ label: KIND[k].title, icon: KIND[k].icon, onClick: () => setModal({ kind: 'log', p, log: k }) })) : []),
                        { label: 'Add note', icon: StickyNote, onClick: () => setModal({ kind: 'log', p, log: 'note' }) },
                        { label: 'Edit', icon: Pencil, onClick: () => setModal({ kind: 'edit', p }) },
                        { label: 'History', icon: UserCheck, onClick: () => setModal({ kind: 'history', p }) },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={shown.length} label="prospects" />
          </>
        )}
      </Card>
      {(modal?.kind === 'add' || modal?.kind === 'edit') && <ProspectForm p={modal.kind === 'edit' ? modal.p : undefined} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'log' && <LogLinkedIn p={modal.p} kind={modal.log} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'convert' && <ConvertToAgency p={modal.p} onClose={() => setModal(null)} onDone={(id) => { void reload(); navigate(`../${id}`, { relative: 'path' }); }} />}
      {modal?.kind === 'history' && <History p={modal.p} staffName={staffName} onClose={() => setModal(null)} />}
    </>
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
    if (kind === 'follow_up_date' && !next) return toast.error('Choose the follow-up date');
    if (kind === 'note' && !note.trim()) return toast.error('Write the note');
    setBusy(true);
    const r = await rpc('log_linkedin_activity', { p_id: p.id, p_kind: kind, p_note: note || null, p_next: next || null, p_request: req });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(`${KIND[kind].title} — saved`); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={KIND[kind].title} subtitle={p.name} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      {kind !== 'follow_up_date' && <Field label="Note"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus /></Field>}
      <Field label={kind === 'follow_up_date' ? 'Follow-up date' : 'Next follow-up (optional)'} required={kind === 'follow_up_date'} className="mt-3"><DatePicker value={next} onChange={setNext} min={today()} /></Field>
      {KIND[kind].report && <p className="mt-3 text-xs text-ink-mute">Counts in your Daily Work Report ({KIND[kind].report}).</p>}
    </Modal>
  );
}

const PHONE_OK = (s: string) => /^\+?[0-9 ()./-]{7,30}$/.test(s.trim()) && s.replace(/\D/g, '').length >= 7 && s.replace(/\D/g, '').length <= 15;

function ConvertToAgency({ p, onClose, onDone }: { p: LinkedInProspect; onClose: () => void; onDone: (agencyId: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ company_name: p.company_name ?? p.name, contact_name: p.name, phone: p.phone ?? '', email: p.email ?? '', country: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const phoneBad = !PHONE_OK(f.phone);
  const save = async () => {
    if (!f.company_name.trim()) return setErr('Enter the agency name.');
    if (phoneBad) return setErr('Enter a valid phone number (7 to 15 digits) — it is required to add the agency.');
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('Enter a valid email address, or leave it empty.');
    setBusy(true); setErr('');
    const r = await rpc<{ agency_id: string; linked: boolean }>('convert_linkedin_prospect', { p_id: p.id, p: f });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(r.data.linked ? 'Linked to the existing agency' : 'Added to the Agency List', r.data.linked ? 'An agency with this phone, email or name already existed — no duplicate was created.' : undefined);
    onClose(); onDone(r.data.agency_id);
  };
  return (
    <Modal open onClose={onClose} title="Convert to Agency" subtitle={`${p.name} · ${p.reference}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={ArrowRightLeft} disabled={busy} onClick={() => void save()}>Convert</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Agency name" required><Input value={f.company_name} onChange={set('company_name')} maxLength={160} /></Field>
        <Field label="Contact person"><Input value={f.contact_name} onChange={set('contact_name')} maxLength={120} /></Field>
        <Field label="Phone number" required error={f.phone && phoneBad ? 'Enter a valid phone number' : undefined}><Input value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" invalid={!!f.phone && phoneBad} /></Field>
        <Field label="Email (needed later to send a proposal)"><Input type="email" value={f.email} onChange={set('email')} maxLength={200} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set('country')} maxLength={80} /></Field>
      </div>
      <p className="mt-3 text-xs text-ink-mute">The LinkedIn history stays with the prospect, which is marked Converted and linked to the agency. If an agency with this phone, email or name exists, it is linked instead of creating a duplicate.</p>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

function History({ p, staffName, onClose }: { p: LinkedInProspect; staffName: (id: string | null) => string; onClose: () => void }) {
  const [rows, setRows] = useState<LinkedInActivity[] | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return setRows([]);
    const { data } = await supabase.from('linkedin_activities').select('*').eq('prospect_id', p.id).order('at', { ascending: false }).limit(300);
    setRows((data ?? []) as LinkedInActivity[]);
  }, [p.id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <Modal open onClose={onClose} title={p.name} subtitle={`${p.reference} · ${LI_STATUS[p.status].label}`}>
      {p.notes && <p className="mb-3 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm text-ink-soft">{p.notes}</p>}
      {!rows ? <p className="text-sm text-ink-soft">Loading…</p> : rows.length === 0 ? <p className="text-sm text-ink-soft">No activity yet.</p> : (
        <ol>{rows.map((h) => (
          <li key={h.id} className="border-l-2 border-line py-2 pl-4">
            <div className="text-sm font-medium text-heading">{LI_ACTIVITY[h.kind] ?? h.kind}</div>
            {h.note && <div className="whitespace-pre-wrap text-sm text-ink-soft">{h.note}</div>}
            <div className="text-xs text-ink-mute">{fmtWhen(h.at)} · {staffName(h.actor)}</div>
          </li>
        ))}</ol>
      )}
    </Modal>
  );
}
