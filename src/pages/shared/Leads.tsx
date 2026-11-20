// Leads (Partner Success Officers): prospective students from first inquiry to the Student List.
// Contact outcome (Not recorded / Not connected / Connected) is separate from the stage (Cold / Warm /
// Converted / Closed) and from No response; each lead is in exactly one queue. The profile has the six
// Log Activity actions, No Response, Move to Student List and Move to Application. Every change is a
// server function (permissions, history, report credit); lists update through realtime.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, CalendarPlus, CheckCircle2, FilePlus2, MoreHorizontal, Pencil, PhoneCall, PhoneMissed, Plus, StickyNote, UserCheck, UserPlus, UserX, VolumeX } from 'lucide-react';
import { Alert, Badge, Button, Card, DatePicker, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, Pagination, SearchInput, Segmented, Select, Table, Tabs, Textarea, TimePicker, usePaged } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { ContactCorrection } from '../../components/ContactCorrection';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { useStore } from '../../store/store';
import { matches } from '../../lib/utils';
import { CONTACT, contactAllowed, fmtDate, fmtTime, fmtWhen, today, type ContactStatus } from '../../lib/agencies';
import {
  ATTEMPT_OUTCOME, CALL_OUTCOME, LEAD_ACTIVITY, LEAD_QUEUE, LEAD_SOURCE, LEAD_STAGE, agentName, leadQueue, leadRpc, useLeadDetail, useLeads,
  type Lead, type LeadQueue, type LeadSource, type LeadStage, type LeadTask,
} from '../../lib/leads';

type LogKind = 'contact_attempt' | 'call_done' | 'follow_up_done' | 'add_follow_up' | 'note' | 'stage';
// The six Lead Log Activity actions (Sibiya and Zenha Workflow Management Specification).
const LOG: Record<LogKind, { title: string; icon: typeof PhoneCall; report?: string }> = {
  contact_attempt: { title: 'Contact attempt', icon: PhoneMissed, report: 'Follow-ups attempted' },
  call_done: { title: 'Call done', icon: PhoneCall, report: 'Calls completed' },
  follow_up_done: { title: 'Follow-up done', icon: CheckCircle2, report: 'Student follow-ups completed' },
  add_follow_up: { title: 'Add follow-up', icon: CalendarPlus },
  note: { title: 'Add note', icon: StickyNote },
  stage: { title: 'Change stage', icon: Pencil },
};
const TABS: { value: 'all' | LeadQueue; label: string }[] = [
  { value: 'all', label: 'All leads' }, { value: 'pending', label: 'Pending' }, { value: 'no_response', label: 'No response' },
  { value: 'in_progress', label: 'In progress' }, { value: 'converted', label: 'Converted' }, { value: 'closed', label: 'Closed' },
];

export default function Leads() {
  const { session, db } = useStore();
  const { data: rows, error, reload } = useLeads();
  const [tab, setTab] = useState<'all' | LeadQueue>('all');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [agent, setAgent] = useState('');
  const [contact, setContact] = useState('');
  const [emp, setEmp] = useState('');
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'edit'; l: Lead }>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const canAdd = session?.userRole === 'super_admin' || !!session?.permissions.includes('leads');
  const partnerName = (id: string) => db.partners.find((p) => p.id === id)?.name;
  const staffName = (id: string | null | undefined) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee') : '—');
  // Current figures from the saved leads. Queue, contact outcome and stage are three separate
  // groupings: each lead is counted once inside each group, never twice within one.
  const counts = useMemo(() => {
    const c: Record<LeadQueue, number> = { pending: 0, no_response: 0, in_progress: 0, converted: 0, closed: 0 };
    const st: Record<LeadStage, number> = { cold: 0, warm: 0, converted: 0, closed: 0 };
    let connected = 0, notConnected = 0, fresh = 0, due = 0;
    const d = today();
    (rows ?? []).forEach((l) => {
      c[leadQueue(l)] += 1; st[l.stage] += 1;
      if (l.contact_status === 'connected') connected += 1; else if (l.contact_status === 'not_connected') notConnected += 1;
      if (new Date(new Date(l.created_at).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) === d) fresh += 1;
      if (l.next_follow_up && l.next_follow_up <= d && l.stage !== 'converted' && l.stage !== 'closed') due += 1;
    });
    return { ...c, stage: st, connected, notConnected, fresh, due, total: rows?.length ?? 0 };
  }, [rows]);
  const shown = useMemo(() => (rows ?? []).filter((l) => (tab === 'all' || leadQueue(l) === tab) && (!stage || l.stage === stage)
    && (!contact || (contact === 'due' ? !!l.next_follow_up && l.next_follow_up <= today() && l.stage !== 'converted' && l.stage !== 'closed' : l.contact_status === contact))
    && (!emp || l.assigned_to === emp)
    && (!agent || (agent === 'direct' ? !l.partner_id : l.partner_id === agent))
    && matches(q, l.name, l.phone ?? '', l.email ?? '', l.reference, l.qualification ?? '')), [rows, tab, stage, contact, emp, agent, q]);
  const paged = usePaged(shown, 20, `${tab}|${q}|${stage}|${contact}|${emp}|${agent}`);
  const employees = useMemo(() => [...new Set((rows ?? []).map((l) => l.assigned_to).filter((x): x is string => !!x))]
    .map((id) => ({ value: id, label: staffName(id) })).sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, db.staff]);
  const pick = (f: { tab?: 'all' | LeadQueue; stage?: string; contact?: string }) => { setTab(f.tab ?? 'all'); setStage(f.stage ?? ''); setContact(f.contact ?? ''); };
  const profile = profileId ? rows?.find((r) => r.id === profileId) ?? null : null;
  const agentOptions = useMemo(() => {
    const ids = [...new Set((rows ?? []).map((l) => l.partner_id).filter((x): x is string => !!x))];
    return [{ value: '', label: 'All agents' }, { value: 'direct', label: 'Direct' }, ...ids.map((id) => ({ value: id, label: partnerName(id) ?? 'Partner' }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, db.partners]);

  return (
    <>
      <PageHeader title="Leads" subtitle="Prospective students from first inquiry to the Student List. Open a lead to record the contact outcome, log work or move it on."
        actions={canAdd ? <Button icon={Plus} onClick={() => setModal({ kind: 'add' })}>Add Lead</Button> : undefined} />
      {error && <Alert tone="warning" className="mb-4">{error} <Button size="sm" variant="secondary" className="ml-1" onClick={() => void reload()}>Try again</Button></Alert>}
      {rows && (
        <div className="mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Total leads" value={counts.total} hint="All leads you can see" onClick={() => pick({})} />
            <Metric label="New today" value={counts.fresh} hint="Added today (IST)" onClick={() => pick({})} />
            {(['pending', 'no_response', 'converted', 'closed'] as LeadQueue[]).map((k) => (
              <Metric key={k} label={LEAD_QUEUE[k].label} value={counts[k]} hint={LEAD_QUEUE[k].hint} active={tab === k} onClick={() => pick({ tab: k })} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Connected" value={counts.connected} hint="Contact outcome" active={contact === 'connected'} onClick={() => pick({ contact: 'connected' })} />
            <Metric label="Not connected" value={counts.notConnected} hint="Contact outcome" active={contact === 'not_connected'} onClick={() => pick({ contact: 'not_connected' })} />
            <Metric label="Cold" value={counts.stage.cold} hint="Stage" active={stage === 'cold'} onClick={() => pick({ stage: 'cold' })} />
            <Metric label="Warm" value={counts.stage.warm} hint="Stage" active={stage === 'warm'} onClick={() => pick({ stage: 'warm' })} />
            <Metric label="In progress" value={counts.in_progress} hint={LEAD_QUEUE.in_progress.hint} active={tab === 'in_progress'} onClick={() => pick({ tab: 'in_progress' })} />
            <Metric label="Follow-ups due" value={counts.due} hint="Today or overdue" active={contact === 'due'} onClick={() => pick({ contact: 'due' })} />
          </div>
        </div>
      )}
      <Card>
        <Tabs className="px-4" tabs={TABS.map((t) => ({ ...t, count: t.value === 'all' ? rows?.length : counts[t.value] }))} value={tab} onChange={setTab} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, phone, email, reference…" className="w-full sm:w-72" />
          <FilterSelect label="Contact status" value={contact} onChange={setContact} options={[{ value: '', label: 'Any contact status' }, { value: 'due', label: 'Follow-up due' },
            ...(Object.keys(CONTACT) as ContactStatus[]).map((k) => ({ value: k, label: CONTACT[k].label }))]} />
          <FilterSelect label="Stage" value={stage} onChange={setStage} options={[{ value: '', label: 'All stages' }, ...(Object.keys(LEAD_STAGE) as LeadStage[]).map((k) => ({ value: k, label: LEAD_STAGE[k].label }))]} />
          {employees.length > 1 && <FilterSelect label="Employee" value={emp} onChange={setEmp} options={[{ value: '', label: 'All employees' }, ...employees]} />}
          <FilterSelect label="Agent" value={agent} onChange={setAgent} options={agentOptions} />
          <span className="ml-auto text-xs text-ink-mute">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
        </div>
        {!rows ? <p className="p-6 text-sm text-ink-soft" role="status">Loading leads…</p> : shown.length === 0 ? (
          <EmptyState icon={UserPlus} title={rows.length ? 'Nothing here' : 'No leads yet'} description={rows.length ? undefined : 'Add a lead as soon as a student enquires — a name is enough to start.'}
            action={!rows.length && canAdd ? <Button icon={Plus} onClick={() => setModal({ kind: 'add' })}>Add Lead</Button> : undefined} />
        ) : (
          <>
            <Table className="hr-table" head={['Lead', 'Contact', 'Agent', 'Contact status', 'Stage', 'Last contact', 'Next follow-up', 'Assigned to', '']}>
              {paged.rows.map((l) => {
                const qd = leadQueue(l);
                return (
                  <tr key={l.id}>
                    <td className="min-w-[160px]">
                      <button type="button" className="text-left font-medium text-heading hover:text-rust hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => setProfileId(l.id)}>{l.name}</button>
                      <div className="text-xs text-ink-mute">{l.reference}</div>
                    </td>
                    <td className="text-sm">{l.phone ?? '—'}<div className="text-xs text-ink-mute">{l.email ?? ''}</div></td>
                    <td className="text-sm">{agentName(l.partner_id, partnerName)}</td>
                    <td><Badge tone={CONTACT[l.contact_status].tone} dot>{CONTACT[l.contact_status].label}</Badge></td>
                    <td><Badge tone={LEAD_STAGE[l.stage].tone}>{LEAD_STAGE[l.stage].label}</Badge>
                      {(qd === 'pending' || qd === 'no_response') && <div className={`mt-1 text-[11px] font-medium ${qd === 'no_response' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`}>{LEAD_QUEUE[qd].label}</div>}</td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(l.last_contact_at)}</td>
                    <td className={`whitespace-nowrap text-sm ${l.next_follow_up && l.next_follow_up < today() && qd !== 'converted' && qd !== 'closed' ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtDate(l.next_follow_up)}</td>
                    <td className="text-sm">{staffName(l.assigned_to)}<div className="text-xs text-ink-mute">Added {fmtDate(l.created_at)}</div></td>
                    <td className="whitespace-nowrap text-right"><Button size="sm" variant="secondary" onClick={() => setProfileId(l.id)}>Open</Button></td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={shown.length} label="leads" />
          </>
        )}
      </Card>
      {modal && <LeadForm lead={modal.kind === 'edit' ? modal.l : undefined} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); if (id) setProfileId(id); }} />}
      {profile && <LeadProfile l={profile} staffName={staffName} partnerName={partnerName} onClose={() => setProfileId(null)} onEdit={() => setModal({ kind: 'edit', l: profile })} />}
    </>
  );
}

function Metric({ label, value, hint, active, onClick }: { label: string; value: number; hint: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className="rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 aria-pressed:border-brand-400">
      <span className="block font-display text-xl font-semibold tabular-nums text-heading">{value}</span>
      <span className="block text-xs text-ink-soft">{label}</span><span className="block truncate text-[11px] text-ink-mute">{hint}</span>
    </button>
  );
}

// ------------------------------------------------------------------ add / edit
function LeadForm({ lead, onClose, onSaved }: { lead?: Lead; onClose: () => void; onSaved: (id?: string) => void }) {
  const { db, session } = useStore();
  // Super Admin and team managers may assign a lead to someone else (the server allows own team only).
  const canAssign = session?.userRole === 'super_admin' || !!(session as { hasTeam?: boolean } | null)?.hasTeam;
  const toast = useToast();
  const [f, setF] = useState({ name: lead?.name ?? '', phone: lead?.phone ?? '', email: lead?.email ?? '', qualification: lead?.qualification ?? '',
    application_details: lead?.application_details ?? '', partner_id: lead?.partner_id ?? 'direct', source: (lead?.source ?? 'direct') as LeadSource,
    assigned_to: lead?.assigned_to ?? session?.userId ?? '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const partners = useMemo(() => db.partners.filter((p) => !p.internal && !p.archivedAt).sort((a, b) => a.name.localeCompare(b.name)), [db.partners]);
  const dirty = !lead ? [f.name, f.phone, f.email, f.qualification, f.application_details, f.note].some((v) => v.trim()) || f.partner_id !== 'direct' : false;
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (f.name.trim().length < 2) return setErr('Enter the student / lead name.');
    setBusy(true); setErr('');
    const { assigned_to, note, ...rest } = f;
    const payload: Record<string, string> = { ...rest, partner_id: f.partner_id === 'direct' ? '' : f.partner_id, source: f.partner_id === 'direct' ? (f.source === 'partner' ? 'direct' : f.source) : 'partner' };
    if (canAssign && assigned_to && assigned_to !== lead?.assigned_to) payload.assigned_to = assigned_to;
    if (!lead && note.trim()) payload.note = note.trim();
    const r = await leadRpc<{ id: string; reference: string }>('save_lead', { p_id: lead?.id ?? null, p: payload, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(lead ? 'Lead updated' : 'Lead added', r.data.reference);
    onSaved(lead ? undefined : r.data.id);
  };
  return (
    <Modal open onClose={onClose} title={lead ? 'Edit lead' : 'Add Lead'} subtitle={lead?.reference} dirty={dirty} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} loading={busy} onClick={() => void save()}>{lead ? 'Save changes' : 'Add Lead'}</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student / lead name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={160} autoFocus /></Field>
        <Field label="Phone number"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} inputMode="tel" placeholder="+91 98470 00000" /></Field>
        <Field label="Email ID"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={200} /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={(e) => set('qualification', e.target.value)} maxLength={200} placeholder="e.g. BTech Computer Science, 2024" /></Field>
        <Field label="Agent name" hint={f.partner_id === 'direct' ? 'No partner agency: recorded as Direct.' : 'The partner agency this student came through.'}>
          <Select value={f.partner_id} onChange={(e) => set('partner_id', e.target.value)} searchable disabled={lead?.stage === 'converted'}>
            <option value="direct">Direct</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {f.partner_id === 'direct' && (
          <Field label="Source"><Select value={f.source} onChange={(e) => set('source', e.target.value)}>
            {(Object.keys(LEAD_SOURCE) as LeadSource[]).filter((k) => k !== 'partner').map((k) => <option key={k} value={k}>{LEAD_SOURCE[k]}</option>)}
          </Select></Field>
        )}
        <Field label="Application details" className="sm:col-span-2" hint="Course, country, intake or anything the student asked about.">
          <Textarea rows={3} value={f.application_details} onChange={(e) => set('application_details', e.target.value)} maxLength={4000} />
        </Field>
        {canAssign && (
          <Field label="Assigned employee" hint="You, or a member of your team.">
            <Select value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} searchable>
              {db.staff.map((m) => <option key={m.id} value={m.id}>{m.fullName}{m.id === session?.userId ? ' (you)' : ''}</option>)}
            </Select>
          </Field>
        )}
        {!lead && (
          <Field label="Notes" className="sm:col-span-2" hint="Saved as the first entry in the lead's history.">
            <Textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={2000} />
          </Field>
        )}
        {lead && <p className="text-xs text-ink-mute sm:col-span-2">Added {fmtWhen(lead.created_at)}. Notes are added from Log activity → Add note, so earlier notes are kept.</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ profile
function LeadProfile({ l, staffName, partnerName, onClose, onEdit }: {
  l: Lead; staffName: (id: string | null | undefined) => string; partnerName: (id: string) => string | undefined; onClose: () => void; onEdit: () => void;
}) {
  const { session, actions, db } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error } = useLeadDetail(l.id);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogKind | 'no_response' | null>(null);
  const [converting, setConverting] = useState<null | 'student' | 'application'>(null);
  const [appFor, setAppFor] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const superAdmin = session?.userRole === 'super_admin';
  const converted = l.stage === 'converted';
  const closed = l.stage === 'closed';
  const q = leadQueue(l);
  const openTasks = (data?.tasks ?? []).filter((t) => t.status === 'open');
  // Student and application status come from the existing Student List and Applications (store, realtime).
  const student = l.student_id ? db.students.find((x) => x.id === l.student_id) : undefined;
  const apps = l.student_id ? db.applications.filter((a) => a.studentId === l.student_id) : [];

  const setContact = async (v: ContactStatus, note: string | null = null) => {
    if (v === l.contact_status) return false;
    setBusy(true);
    const r = await leadRpc('set_lead_contact_status', { p_id: l.id, p_status: v, p_note: note, p_request: crypto.randomUUID() });
    setBusy(false);
    if (!r.ok) { toast.error('Not saved', r.error); return false; }
    toast.success(`Contact outcome: ${CONTACT[v].label}`); return true;
  };
  const toApplication = () => {
    if (l.student_id) { setAppFor(l.student_id); return; }
    setConverting('application');
  };

  return (
    <Modal open onClose={onClose} size="xl" title={l.name}
      subtitle={<span className="flex flex-wrap items-center gap-2">{l.reference}<Badge tone={LEAD_STAGE[l.stage].tone}>{LEAD_STAGE[l.stage].label}</Badge><Badge tone={LEAD_QUEUE[q].tone} dot>{LEAD_QUEUE[q].label}</Badge></span>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {!converted && <Button variant="secondary" icon={Pencil} onClick={onEdit}>Edit details</Button>}
        {converted && l.student_id ? (
          <Button variant="secondary" onClick={() => { onClose(); navigate(`../students/${l.student_id}`, { relative: 'path' }); }}>Open student</Button>
        ) : !closed && <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setConverting('student')}>Move to Student List</Button>}
        {!closed && <Button icon={FilePlus2} onClick={toApplication}>Move to Application</Button>}
      </>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="rounded-2xl border border-line p-4">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-heading">Contact outcome</h3>
              <Badge tone={CONTACT[l.contact_status].tone} dot>{CONTACT[l.contact_status].label}</Badge></div>
            <div className="flex flex-wrap gap-2">
              {(['connected', 'not_connected'] as const).map((v) => {
                const blocked = v !== l.contact_status && !contactAllowed(l.contact_status, v);
                return (
                  <Button key={v} size="sm" variant={l.contact_status === v ? 'primary' : 'secondary'} icon={v === 'connected' ? UserCheck : UserX}
                    disabled={busy || converted || blocked} aria-pressed={l.contact_status === v}
                    title={blocked ? 'Contact outcome only moves forward. A Super Admin can correct mistakes.' : undefined} onClick={() => void setContact(v)}>{CONTACT[v].label}</Button>
                );
              })}
              {!converted && !closed && <Button size="sm" variant="ghost" icon={VolumeX} disabled={busy || l.no_response} onClick={() => setLog('no_response')}>{l.no_response ? 'Marked No response' : 'No response'}</Button>}
            </div>
            <p className="mt-2 text-xs text-ink-mute">
              {l.contact_status === 'unknown' ? 'Not recorded yet — choose once you know the outcome.' : `Set by ${staffName(l.contact_changed_by)} · ${fmtWhen(l.contact_changed_at)}`}
              {' · Logging attempts, calls or follow-ups never changes it.'}
              {l.no_response && l.no_response_at ? ` No response recorded ${fmtWhen(l.no_response_at)}; it stays open for follow-ups.` : ''}
            </p>
            {superAdmin && !converted && l.contact_status !== 'unknown' && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setCorrecting(true)}>Correct contact outcome…</Button>}
          </section>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line p-4 text-sm">
            {([['Phone', l.phone], ['Email ID', l.email], ['Qualification', l.qualification], ['Agent name', agentName(l.partner_id, partnerName)],
               ['Source', LEAD_SOURCE[l.source]], ['Assigned to', staffName(l.assigned_to)], ['Last contact', l.last_contact_at ? fmtWhen(l.last_contact_at) : 'Not yet'],
               ['Next follow-up', l.next_follow_up ? fmtDate(l.next_follow_up) : 'None scheduled'], ['Added', fmtWhen(l.created_at)], ['Added by', staffName(l.created_by)],
               ['Student List', converted ? (student ? `Converted · ${student.firstName} ${student.lastName}` : 'Converted') : 'Not moved yet'],
               ['Application', apps.length ? apps.map((a) => `${a.ref} · ${a.status}`).join(', ') : converted ? 'No application yet' : '—']] as [string, string | null][]).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="mt-0.5 break-words text-heading">{v || '—'}</dd></div>
            ))}
            <div className="col-span-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Application details</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-heading">{l.application_details || '—'}</dd></div>
          </dl>
          {converted && <Alert tone="success">In the Student List since {fmtWhen(l.converted_at)} (by {staffName(l.converted_by)}). Log further work on the student.</Alert>}
          <section className="rounded-2xl border border-line p-4">
            <h3 className="mb-2 text-sm font-semibold text-heading">Follow-ups</h3>
            {!data ? <p className="text-sm text-ink-soft">Loading…</p> : openTasks.length === 0 ? <p className="text-sm text-ink-mute">No open follow-ups.</p> : (
              <ul className="space-y-2">{openTasks.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
            )}
          </section>
        </div>
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-heading">Activity history</h3>
            {!converted && (
              <Menu width="w-60" trigger={() => <Button size="sm" variant="secondary" icon={MoreHorizontal}>Log activity</Button>}
                items={(Object.keys(LOG) as LogKind[]).filter((k) => !closed || k === 'note' || k === 'stage').map((k) => ({ label: LOG[k].title, icon: LOG[k].icon, onClick: () => setLog(k) }))} />
            )}
          </div>
          {error && <Alert tone="warning">{error}</Alert>}
          {!data ? <p className="text-sm text-ink-soft">Loading…</p> : data.activities.length === 0 ? <p className="text-sm text-ink-mute">No activity yet.</p> : (
            <ol className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
              {data.activities.map((h) => (
                <li key={h.id} className="rounded-xl border border-line p-3">
                  <div className="text-sm font-medium text-heading">{LEAD_ACTIVITY[h.kind] ?? h.kind}
                    {h.outcome ? ` · ${(ATTEMPT_OUTCOME as Record<string, string>)[h.outcome] ?? (CALL_OUTCOME as Record<string, string>)[h.outcome] ?? h.outcome}` : ''}
                    {(h.kind === 'contact_status' || h.kind === 'contact_correction') && typeof h.detail?.to === 'string' ? ` · ${CONTACT[h.detail.to as ContactStatus]?.label ?? h.detail.to}` : ''}
                    {h.kind === 'stage' && typeof h.detail?.to === 'string' ? ` · ${LEAD_STAGE[h.detail.from as LeadStage]?.label ?? h.detail.from} → ${LEAD_STAGE[h.detail.to as LeadStage]?.label ?? h.detail.to}` : ''}
                    {h.kind === 'follow_up_added' && typeof h.detail?.due_date === 'string' ? ` · ${fmtDate(h.detail.due_date)}${h.detail.due_time ? ` ${fmtTime(String(h.detail.due_time))}` : ''}` : ''}
                    {h.kind === 'application' && typeof h.detail?.ref === 'string' ? ` · ${h.detail.ref}` : ''}
                  </div>
                  {h.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">{h.note}</p>}
                  <div className="mt-1 text-xs text-ink-mute">{staffName(h.actor)} · {fmtWhen(h.at)}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      {log && <LogLead l={l} kind={log} tasks={openTasks} onClose={() => setLog(null)} />}
      {converting && <ConvertLead l={l} next={converting} onClose={() => setConverting(null)}
        onDone={(sid) => { setConverting(null); void actions.reload(['students']); if (converting === 'application') setAppFor(sid); }} />}
      {appFor && <ApplicationForm open onClose={() => setAppFor(null)} studentId={appFor} />}
      {correcting && <ContactCorrection name={l.name} current={l.contact_status} onClose={() => setCorrecting(false)} onSave={(to, reason) => setContact(to, reason)} />}
    </Modal>
  );
}

function TaskRow({ t }: { t: LeadTask }) {
  const overdue = t.due_date < today();
  return (
    <li className="flex items-start justify-between gap-2 rounded-xl bg-canvas px-3 py-2 text-sm">
      <div className="min-w-0"><div className={overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'font-medium text-heading'}>{fmtDate(t.due_date)}{t.due_time ? ` · ${fmtTime(t.due_time)}` : ''}{overdue ? ' · overdue' : ''}</div>
        {t.note && <div className="break-words text-xs text-ink-soft">{t.note}</div>}</div>
      {t.carry_count > 0 && <Badge tone="amber">Carried {t.carry_count}×</Badge>}
    </li>
  );
}

// ------------------------------------------------------------------ log activity
function LogLead({ l, kind, tasks, onClose }: { l: Lead; kind: LogKind | 'no_response'; tasks: LeadTask[]; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const [task, setTask] = useState(tasks[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [stage, setStage] = useState<LeadStage>(l.stage === 'cold' ? 'warm' : l.stage === 'warm' ? 'cold' : 'warm');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const title = kind === 'no_response' ? 'No response' : LOG[kind].title;
  const save = async () => {
    setErr('');
    if ((kind === 'contact_attempt' || kind === 'call_done') && !outcome) return setErr('Choose the outcome.');
    if (kind === 'note' && !note.trim()) return setErr('Write the note.');
    if (kind === 'add_follow_up' && !date) return setErr('Choose the follow-up date.');
    if (kind === 'stage' && stage === 'closed' && !note.trim()) return setErr('Give a reason for closing the lead.');
    setBusy(true);
    const r = kind === 'add_follow_up'
      ? await leadRpc('add_lead_follow_up', { p_id: l.id, p_date: date, p_time: time || null, p_note: note || null, p_request: req })
      : kind === 'stage'
        ? await leadRpc('set_lead_stage', { p_id: l.id, p_stage: stage, p_note: note || null, p_request: req })
        : await leadRpc('log_lead_activity', { p_id: l.id, p_kind: kind, p_outcome: outcome || null, p_note: note || null, p_task: kind === 'follow_up_done' ? task || null : null, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(title, kind !== 'no_response' && LOG[kind].report ? `Counted in your Daily Work Report: ${LOG[kind].report}.` : 'Saved to the lead history.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={title} subtitle={`${l.name} · ${l.reference}`} dirty={!!note || !!outcome || !!date}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} loading={busy} onClick={() => void save()}>Save</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="space-y-4">
        {kind === 'contact_attempt' && <Field label="Outcome" required><Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Choose…</option>{Object.entries(ATTEMPT_OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        {kind === 'call_done' && <Field label="Outcome" required hint="Mark Connected separately if you actually reached the student."><Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Choose…</option>{Object.entries(CALL_OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        {kind === 'follow_up_done' && (tasks.length > 0 ? (
          <Field label="Follow-up" hint="The chosen follow-up is marked completed."><Select value={task} onChange={(e) => setTask(e.target.value)}>
            <option value="">Not one of the scheduled follow-ups</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{`${fmtDate(t.due_date)}${t.due_time ? ` ${fmtTime(t.due_time)}` : ''}${t.note ? ` — ${t.note.slice(0, 50)}` : ''}`}</option>)}
          </Select></Field>
        ) : <Alert tone="info">No follow-up is scheduled; this is recorded as a completed follow-up on its own.</Alert>)}
        {kind === 'add_follow_up' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Follow-up date" required><DatePicker value={date} onChange={setDate} min={today()} /></Field>
            <Field label="Time"><TimePicker value={time} onChange={setTime} /></Field>
          </div>
        )}
        {kind === 'stage' && (
          <>
            <p className="text-sm">Current stage: <Badge tone={LEAD_STAGE[l.stage].tone}>{LEAD_STAGE[l.stage].label}</Badge></p>
            <Field label="New stage"><Segmented options={(['cold', 'warm', 'closed'] as LeadStage[]).filter((s) => s !== l.stage).map((s) => ({ value: s, label: LEAD_STAGE[s].label }))} value={stage} onChange={setStage} /></Field>
            <p className="text-xs text-ink-mute">{LEAD_STAGE[stage].hint} Converted is set by Move to Student List, once the student record is saved.</p>
          </>
        )}
        {kind === 'no_response' && <Alert tone="info">The lead moves to the No response list. It is not closed and stays open for follow-ups; marking Connected later moves it back.</Alert>}
        <Field label={kind === 'note' ? 'Note' : kind === 'stage' && stage === 'closed' ? 'Reason' : 'Notes'} required={kind === 'note' || (kind === 'stage' && stage === 'closed')}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Move to Student List
function ConvertLead({ l, next, onClose, onDone }: { l: Lead; next: 'student' | 'application'; onClose: () => void; onDone: (studentId: string) => void }) {
  const toast = useToast();
  const [first, ...rest] = l.name.trim().split(/\s+/);
  const [f, setF] = useState({ first_name: first ?? '', last_name: rest.join(' '), email: l.email ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const save = async () => {
    setErr('');
    if (!f.first_name.trim() || !f.last_name.trim() || !f.email.trim()) return setErr('First name, last name and email are needed for the student record.');
    setBusy(true);
    const r = await leadRpc<{ student_id: string; linked: boolean; already: boolean; agent: string }>('convert_lead_to_student', { p_id: l.id, p: f, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(r.data.already ? 'Already in the Student List' : r.data.linked ? 'Linked to the existing student' : 'Moved to the Student List',
      r.data.agent ? `Agent: ${r.data.agent}` : undefined);
    onDone(r.data.student_id);
  };
  return (
    <Modal open onClose={onClose} title={next === 'application' ? 'Move to Application' : 'Move to Student List'} subtitle={`${l.name} · ${l.reference}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} loading={busy} onClick={() => void save()}>{next === 'application' ? 'Continue to application' : 'Move to Student List'}</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <p className="mb-3 text-sm text-ink-soft">{next === 'application' ? 'The lead first becomes a student (or is linked to the existing one), then the application form opens.' : 'A student record is created, or linked if one with this email already exists under the same agent.'} The lead becomes Converted only once the student is saved; its history and reference are kept.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} maxLength={80} /></Field>
        <Field label="Last name" required><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} maxLength={80} /></Field>
        <Field label="Email ID" required className="sm:col-span-2"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}
