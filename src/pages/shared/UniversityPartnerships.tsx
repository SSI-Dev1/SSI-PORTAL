// University Partnerships (Partnership Officer workspace): a manual record of each university /
// institution being approached, with free-text notes and an update history. Saved through
// save_university_partnership / add_university_partnership_note (0044); first contact, meeting
// fixed, onboarded, closed and completed follow-ups count in the Daily Work Report once each.
import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Pencil, Plus, StickyNote } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DatePicker, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, Table, Textarea, usePaged } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { matches } from '../../lib/utils';
import { agencyAccess, fmtDate, fmtWhen, rpc, today } from '../../lib/agencies';

type UpStatus = 'prospect' | 'contacted' | 'in_discussion' | 'meeting_fixed' | 'agreement_sent' | 'onboarded' | 'closed';
const STATUS: Record<UpStatus, { label: string; tone: 'slate' | 'blue' | 'violet' | 'orange' | 'amber' | 'green' | 'red' }> = {
  prospect: { label: 'Prospect', tone: 'slate' }, contacted: { label: 'Contacted', tone: 'blue' }, in_discussion: { label: 'In discussion', tone: 'violet' },
  meeting_fixed: { label: 'Meeting fixed', tone: 'orange' }, agreement_sent: { label: 'Agreement sent', tone: 'amber' }, onboarded: { label: 'Onboarded', tone: 'green' },
  closed: { label: 'Closed', tone: 'red' },
};
interface UniPartnership {
  id: string; reference: string; institution_name: string; university_id: string | null; country: string | null; city: string | null; contact_person: string | null;
  designation: string | null; email: string | null; phone: string | null; website: string | null; status: UpStatus; assigned_officer: string | null;
  follow_up_date: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string;
}
interface UpNote { id: number; partnership_id: string; kind: string; note: string | null; detail: Record<string, unknown>; author: string | null; at: string }

function useUniPartnerships(enabled: boolean) {
  const [rows, setRows] = useState<UniPartnership[] | null>(null);
  useEffect(() => {
    if (!supabase || !enabled) return;
    const sb = supabase;
    let alive = true;
    const load = () => void sb.from('university_partnerships').select('*').order('updated_at', { ascending: false }).limit(2000)
      .then(({ data }) => alive && setRows((data ?? []) as UniPartnership[]));
    load();
    const ch = sb.channel(`uni-partnerships-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'university_partnerships' }, load).subscribe();
    return () => { alive = false; void sb.removeChannel(ch); };
  }, [enabled]);
  return rows;
}

export default function UniversityPartnerships() {
  const { session, db } = useStore();
  const allowed = agencyAccess(session);
  const rows = useUniPartnerships(allowed);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<{ p?: UniPartnership } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => (rows ?? []).filter((r) => (!status || r.status === status)
    && matches(q, r.institution_name, r.country ?? '', r.contact_person ?? '', r.email ?? '', r.reference)), [rows, q, status]);
  const paged = usePaged(shown, 20, `${q}|${status}`);
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee') : '—');
  const open = openId ? rows?.find((r) => r.id === openId) ?? null : null;
  if (!allowed) return <Card><EmptyState icon={GraduationCap} title="University Partnerships are not available" description="Ask an administrator for the Agencies & proposals permission." /></Card>;
  return (
    <>
      <PageHeader title="University Partnerships" subtitle="Universities and institutions you are approaching, recorded by hand with notes and history."
        actions={<Button icon={Plus} onClick={() => setForm({})}>Add university</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search university, country, contact…" className="w-full sm:w-72" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...(Object.keys(STATUS) as UpStatus[]).map((k) => ({ value: k, label: STATUS[k].label }))]} />
          <span className="ml-auto text-xs text-ink-mute">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
        </div>
        {!rows ? <p className="p-6 text-sm text-ink-soft" role="status">Loading…</p> : shown.length === 0 ? (
          <EmptyState icon={GraduationCap} title={rows.length ? 'Nothing matches' : 'No university partnerships yet'}
            action={!rows.length ? <Button icon={Plus} onClick={() => setForm({})}>Add university</Button> : undefined} />
        ) : (
          <>
            <Table className="hr-table" head={['University / institution', 'Contact', 'Status', 'Officer', 'Follow-up', 'Updated', '']}>
              {paged.rows.map((r) => {
                const due = r.follow_up_date && r.follow_up_date <= today() && !['onboarded', 'closed'].includes(r.status);
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <td className="min-w-[200px]"><div className="font-medium text-heading">{r.institution_name}</div><div className="text-xs text-ink-mute">{r.reference}{r.country ? ` · ${r.country}` : ''}</div></td>
                    <td className="text-sm">{r.contact_person ?? '—'}{r.designation ? <span className="text-ink-mute"> · {r.designation}</span> : null}<div className="text-xs text-ink-mute">{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</div></td>
                    <td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    <td className="text-sm">{staffName(r.assigned_officer)}</td>
                    <td className={`whitespace-nowrap text-sm ${due ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtDate(r.follow_up_date)}</td>
                    <td className="whitespace-nowrap text-sm">{fmtWhen(r.updated_at)}</td>
                    <td><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>Open</Button></td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={shown.length} label="universities" />
          </>
        )}
      </Card>
      {form && <PartnershipForm p={form.p} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); setOpenId(id); }} />}
      {open && !form && <PartnershipProfile p={open} staffName={staffName} onClose={() => setOpenId(null)} onEdit={() => setForm({ p: open })} />}
    </>
  );
}

function PartnershipForm({ p, onClose, onSaved }: { p?: UniPartnership; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const { db } = useStore();
  const [f, setF] = useState({
    institution_name: p?.institution_name ?? '', university_id: p?.university_id ?? '', country: p?.country ?? '', city: p?.city ?? '', contact_person: p?.contact_person ?? '',
    designation: p?.designation ?? '', email: p?.email ?? '', phone: p?.phone ?? '', website: p?.website ?? '', status: (p?.status ?? 'prospect') as UpStatus,
    follow_up_date: p?.follow_up_date ?? '', notes: p?.notes ?? '',
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  // Optional link to an existing Education Provider (no second university list is created).
  const providers = useMemo(() => [...db.universities].sort((a, b) => a.name.localeCompare(b.name)), [db.universities]);
  const pickProvider = (id: string) => {
    const u = providers.find((x) => x.id === id);
    setF((x) => ({ ...x, university_id: id, institution_name: x.institution_name || u?.name || '', country: x.country || u?.country || '' }));
  };
  const save = async () => {
    if (busy) return;
    if (f.institution_name.trim().length < 2) return setErr('Enter the university / institution name.');
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('Enter a valid email address, or leave it empty.');
    setBusy(true); setErr('');
    const r = await rpc<{ id: string }>('save_university_partnership', { p_id: p?.id ?? null, p: { ...f, note: note.trim() || null }, p_request: p ? null : req });
    setBusy(false);
    if (!r.ok) return setErr(r.error.replace(/^MISSING: /, ''));
    toast.success(p ? 'University partnership updated' : 'University partnership added'); onSaved(r.data.id);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={p ? 'Edit university partnership' : 'Add university partnership'} subtitle={p?.reference} dirty
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="University / institution name" required className="sm:col-span-2"><Input value={f.institution_name} onChange={set('institution_name')} maxLength={200} autoFocus={!p} /></Field>
        {providers.length > 0 && (
          <Field label="Linked Education Provider" hint="Optional — links this record to the existing provider" className="sm:col-span-2">
            <Select value={f.university_id} onChange={(e) => pickProvider(e.target.value)}>
              <option value="">Not linked</option>
              {providers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.country}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Country"><Input value={f.country} onChange={set('country')} maxLength={80} /></Field>
        <Field label="City"><Input value={f.city} onChange={set('city')} maxLength={80} /></Field>
        <Field label="Contact person"><Input value={f.contact_person} onChange={set('contact_person')} maxLength={120} /></Field>
        <Field label="Designation"><Input value={f.designation} onChange={set('designation')} maxLength={120} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} maxLength={200} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" /></Field>
        <Field label="Website"><Input value={f.website} onChange={set('website')} maxLength={300} /></Field>
        <Field label="Partnership status">
          <Select value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value as UpStatus }))}>{(Object.keys(STATUS) as UpStatus[]).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}</Select>
        </Field>
        <Field label="Follow-up date"><DatePicker value={f.follow_up_date} onChange={(v) => setF((x) => ({ ...x, follow_up_date: v }))} min={p ? undefined : today()} /></Field>
        <Field label="Notes" hint="Free text — background, terms discussed, next steps" className="sm:col-span-2"><Textarea rows={5} value={f.notes} onChange={set('notes')} maxLength={8000} /></Field>
        <Field label={p ? 'Update note (added to the history)' : 'First history note'} className="sm:col-span-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} /></Field>
      </div>
      <p className="mt-3 text-xs text-ink-mute">Moving to Contacted, Meeting fixed, Onboarded or Closed counts once in your Daily Work Report.</p>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

function PartnershipProfile({ p, staffName, onClose, onEdit }: { p: UniPartnership; staffName: (id: string | null) => string; onClose: () => void; onEdit: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState<UpNote[] | null>(null);
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    let alive = true;
    const load = () => void sb.from('university_partnership_notes').select('*').eq('partnership_id', p.id).order('at', { ascending: false }).limit(300)
      .then(({ data }) => alive && setNotes((data ?? []) as UpNote[]));
    load();
    const ch = sb.channel(`up-notes-${p.id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'university_partnership_notes', filter: `partnership_id=eq.${p.id}` }, load).subscribe();
    return () => { alive = false; void sb.removeChannel(ch); };
  }, [p.id]);
  const add = async () => {
    if (busy || !note.trim()) return;
    setBusy(true);
    const r = await rpc('add_university_partnership_note', { p_id: p.id, p_note: note, p_followup_done: followUp });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    setNote(''); setFollowUp(false); toast.success(followUp ? 'Follow-up recorded' : 'Note added');
  };
  const KIND: Record<string, string> = { created: 'Added', status: 'Status changed', edited: 'Details updated', note: 'Note', follow_up_done: 'Follow-up completed' };
  return (
    <Modal open onClose={onClose} size="lg" title={p.institution_name}
      subtitle={<span className="flex flex-wrap items-center gap-2">{p.reference}<Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></span>}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="secondary" icon={Pencil} onClick={onEdit}>Edit</Button></>}>
      <div className="grid gap-5 md:grid-cols-5">
        <div className="space-y-4 md:col-span-3">
          <dl className="grid gap-x-6 gap-y-3 rounded-2xl border border-line p-4 text-sm sm:grid-cols-2">
            {([['Country', [p.city, p.country].filter(Boolean).join(', ')], ['Contact person', p.contact_person], ['Designation', p.designation], ['Email', p.email], ['Phone', p.phone],
              ['Website', p.website], ['Assigned officer', staffName(p.assigned_officer)], ['Follow-up', fmtDate(p.follow_up_date)]] as [string, string | null][]).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="mt-0.5 break-words text-heading">{v || <span className="text-ink-mute">—</span>}</dd></div>
            ))}
          </dl>
          {p.notes && <div><h3 className="mb-1 text-sm font-semibold text-heading">Notes</h3><p className="whitespace-pre-wrap rounded-2xl bg-canvas p-3 text-sm text-ink-soft">{p.notes}</p></div>}
          <section className="rounded-2xl border border-line p-4">
            <Field label="Add a note"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} /></Field>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={followUp} onCheckedChange={(v) => setFollowUp(!!v)} label="This note records a completed follow-up" />
              <Button size="sm" icon={StickyNote} disabled={busy || !note.trim()} onClick={() => void add()}>{busy ? 'Saving…' : 'Add note'}</Button>
            </div>
          </section>
        </div>
        <div className="md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-heading">History</h3>
          {!notes ? <p className="text-sm text-ink-soft">Loading…</p> : notes.length === 0 ? <p className="text-sm text-ink-soft">Nothing yet.</p> : (
            <ol className="max-h-[420px] overflow-y-auto pr-1">{notes.map((n) => (
              <li key={n.id} className="border-l-2 border-line py-2 pl-4">
                <div className="text-sm font-medium text-heading">{KIND[n.kind] ?? n.kind}{n.kind === 'status' && typeof n.detail?.to === 'string' ? `: ${STATUS[n.detail.to as UpStatus]?.label ?? n.detail.to}` : ''}</div>
                {n.note && <div className="whitespace-pre-wrap text-sm text-ink-soft">{n.note}</div>}
                <div className="text-xs text-ink-mute">{fmtWhen(n.at)} · {staffName(n.author)}</div>
              </li>
            ))}</ol>
          )}
        </div>
      </div>
    </Modal>
  );
}
