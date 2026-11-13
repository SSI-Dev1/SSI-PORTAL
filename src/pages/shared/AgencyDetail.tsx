// Agency details: contact status, pipeline stage, follow-ups, proposals (commission from the
// commission master, partner-facing values only), MOUs, registration progress and full history.
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarPlus, MoreHorizontal, CheckCircle2, Eye, FileSignature, Handshake, Link2, Mail, Pencil, PhoneCall, Send, StickyNote, UserCheck, UserX, Users, XCircle,
} from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DatePicker, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, SearchInput, Segmented, Select, Table, Textarea } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { cn, matches } from '../../lib/utils';
import {
  ACTIVITY, CONTACT, EMAIL, MANUAL_STAGES, PROPOSAL, REGISTRATION, STAGE, agencyAccess, agencyManager, agencyName, fmtDate, fmtWhen, rpc, sendProposal, today,
  AgencyDemo, useAgencyData, type Agency, type AgencyActivity, type Mou, type Proposal, type Stage, type Terms,
} from '../../lib/agencies';
import { fmtCommission, type ValueKind } from '../../lib/commissions';

type LogKind = 'call' | 'meeting' | 'follow_up_done' | 'note' | 'follow_up';
const LOG_TITLE: Record<LogKind, string> = { call: 'Log call', meeting: 'Record meeting', follow_up_done: 'Follow-up completed', note: 'Add note', follow_up: 'Add follow-up' };

export default function AgencyDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { session, db } = useStore();
  const allowed = agencyAccess(session);
  const manager = agencyManager(session);
  const commissionManager = !!session && (session.userRole === 'super_admin' || session.permissions.includes('commission_manage'));
  const { data, reload } = useAgencyData(allowed);
  const [history, setHistory] = useState<AgencyActivity[] | null>(null);
  const [modal, setModal] = useState<null | { kind: 'edit' } | { kind: 'log'; log: LogKind } | { kind: 'proposal' } | { kind: 'mou' } | { kind: 'stage' }
    | { kind: 'view'; p: Proposal } | { kind: 'sign'; m: Mou }>(null);
  const [busy, setBusy] = useState('');

  const a = data?.agencies.find((x) => x.id === id);
  const proposals = useMemo(() => (data?.proposals ?? []).filter((p) => p.prospect_id === id), [data, id]);
  const mous = useMemo(() => (data?.mous ?? []).filter((m) => m.prospect_id === id), [data, id]);
  const reg = a?.registration_id ? data?.registrations.find((r) => r.id === a.registration_id) : undefined;
  const staffName = (uid: string | null) => (uid ? db.staff.find((s) => s.id === uid)?.fullName ?? (uid === session?.userId ? session?.name : 'SSI GLOBAL') : 'The agency');

  const demo = useContext(AgencyDemo);
  const loadHistory = useCallback(async () => {
    if (demo) { setHistory(demo.activities.filter((h) => h.prospect_id === id)); return; }
    if (!supabase || !id) return;
    const { data: h } = await supabase.from('agency_activities').select('*').eq('prospect_id', id).order('at', { ascending: false }).limit(500);
    setHistory((h ?? []) as AgencyActivity[]);
  }, [id, demo]);
  useEffect(() => { void loadHistory(); }, [loadHistory, data]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string } | { ok: true; data: unknown }>, done: string) => {
    setBusy(key);
    const r = await fn();
    setBusy('');
    if (!r.ok) return toast.error('Not saved', (r as { error?: string }).error);
    toast.success(done);
    void reload();
  };
  const contact = (s: 'connected' | 'not_connected') => run('contact', () => rpc('set_agency_contact_status', { p_id: id, p_status: s, p_note: null }), s === 'connected' ? 'Marked Connected' : 'Marked Not connected');
  const send = async (p: Proposal) => {
    setBusy(`send:${p.id}`);
    const r = await sendProposal(p.id);
    setBusy('');
    if (r.ok) toast.success('Proposal sent', r.message); else toast.error('Not sent', r.message);
    void reload();
  };

  if (!allowed) return <Card><EmptyState icon={Users} title="Agencies are not available" /></Card>;
  if (!data) return <div className="p-6 text-sm text-ink-soft" role="status">Loading agency…</div>;
  if (!a) return <Card><EmptyState icon={Users} title="Agency not found" description="It may have been assigned to someone else." action={<Button variant="secondary" onClick={() => navigate('..', { relative: 'path' })}>Back to Agencies</Button>} /></Card>;

  const closed = a.stage === 'closed' || a.stage === 'onboarded';
  const openProposal = proposals.find((p) => ['draft', 'pending_approval', 'sending', 'delivery_failed', 'awaiting_confirmation'].includes(p.status));
  return (
    <>
      <Link to=".." relative="path" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-heading"><ArrowLeft className="h-4 w-4" />Agencies</Link>
      <PageHeader
        title={agencyName(a)}
        subtitle={<span className="flex flex-wrap items-center gap-2">{a.reference}<Badge tone={CONTACT[a.contact_status].tone} dot>{CONTACT[a.contact_status].label}</Badge><Badge tone={STAGE[a.stage].tone}>{STAGE[a.stage].label}</Badge></span>}
        actions={<>
          <Button variant="secondary" icon={Pencil} onClick={() => setModal({ kind: 'edit' })}>Edit</Button>
          {a.contact_status === 'not_connected'
            ? <Button variant="secondary" icon={UserCheck} disabled={!!busy} onClick={() => void contact('connected')}>Mark Connected</Button>
            : <Button variant="secondary" icon={UserX} disabled={!!busy} onClick={() => void contact('not_connected')}>Mark Not connected</Button>}
          <Menu width="w-56" trigger={() => <Button variant="secondary" icon={MoreHorizontal}>Log activity</Button>} items={[
            { label: 'Log call', icon: PhoneCall, onClick: () => setModal({ kind: 'log', log: 'call' }) },
            { label: 'Add follow-up', icon: CalendarPlus, onClick: () => setModal({ kind: 'log', log: 'follow_up' }) },
            { label: 'Follow-up completed', icon: CheckCircle2, onClick: () => setModal({ kind: 'log', log: 'follow_up_done' }) },
            { label: 'Record meeting', icon: Handshake, onClick: () => setModal({ kind: 'log', log: 'meeting' }) },
            { label: 'Add note', icon: StickyNote, onClick: () => setModal({ kind: 'log', log: 'note' }) },
            { label: 'Record MOU sent', icon: FileSignature, onClick: () => setModal({ kind: 'mou' }) },
            { label: 'Change stage', icon: Pencil, onClick: () => setModal({ kind: 'stage' }) },
          ]} />
          <Button icon={Send} disabled={closed} onClick={() => setModal({ kind: 'proposal' })}>Send Proposal</Button>
        </>}
      />
      {a.partner_id && <Alert tone="success" className="mb-4">Onboarded — linked to the partner in Clients & Branches{manager ? <> · <Link className="underline" to={`../../partners/${a.partner_id}`} relative="path">open partner</Link></> : null}.</Alert>}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="min-w-0 lg:col-span-1">
          <CardHeader title="Agency details" />
          <dl className="grid gap-3 px-5 pb-5 text-sm">
            {([
              ['Company', a.company_name], ['Contact person', a.contact_name], ['Phone', a.phone], ['Email', a.email], ['Country', a.country],
              ['Assigned officer', staffName(a.assigned_officer)], ['Contact status changed', a.contact_changed_at ? `${fmtWhen(a.contact_changed_at)} · ${staffName(a.contact_changed_by)}` : null],
              ['Last contact', fmtDate(a.last_contact_at)], ['Next follow-up', fmtDate(a.next_follow_up)], ['Selected commission', a.selected_tier],
              ['Added', `${fmtWhen(a.created_at)} · ${staffName(a.created_by)}`],
            ] as [string, string | null][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-ink-mute">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-heading">{v || '—'}</dd></div>
            ))}
          </dl>
          {a.notes && <div className="mx-5 mb-5 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm text-ink-soft">{a.notes}</div>}
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:col-span-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Proposals" subtitle="Commission comes from Commission Management — partner-facing rates only." action={<Button size="sm" icon={Send} disabled={closed} onClick={() => setModal({ kind: 'proposal' })}>Send Proposal</Button>} />
            {proposals.length === 0 ? <p className="px-5 pb-5 text-sm text-ink-soft">No proposal yet.</p> : (
              <Table className="hr-table" head={['Proposal', 'Commission', 'Status', 'Email', 'Sent', 'Confirmed', '']}>
                {proposals.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap font-medium text-heading">{p.reference}<div className="text-xs font-normal text-ink-mute">{p.recipient_email}</div></td>
                    <td className="text-sm">{p.arrangement.tier_label}<div className="text-xs text-ink-mute">{p.arrangement.universities.length} universit{p.arrangement.universities.length === 1 ? 'y' : 'ies'}</div></td>
                    <td><Badge tone={PROPOSAL[p.status].tone}>{PROPOSAL[p.status].label}</Badge></td>
                    <td className="text-xs text-ink-soft" title={EMAIL[p.email_status] + (p.email_detail ? ` · ${p.email_detail}` : '')}>{p.email_status === 'not_sent' ? '—' : p.email_status === 'accepted' ? 'Accepted (not yet delivered)' : p.email_status === 'delivered' ? 'Delivered' : 'Failed'}</td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(p.sent_at)}</td>
                    <td className="whitespace-nowrap text-sm">{p.confirmed_at ? <>{fmtDate(p.confirmed_at)}<div className="text-xs text-ink-mute">{p.confirmed_name}</div></> : p.declined_at ? 'Declined' : '—'}</td>
                    <td className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" icon={Eye} aria-label="View proposal" onClick={() => setModal({ kind: 'view', p })} />
                      {(p.status === 'draft' || p.status === 'delivery_failed') && <Button size="sm" icon={Mail} disabled={busy === `send:${p.id}`} onClick={() => void send(p)}>{busy === `send:${p.id}` ? 'Sending…' : p.status === 'draft' ? 'Send' : 'Retry'}</Button>}
                      {p.status === 'pending_approval' && commissionManager && <>
                        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void run('approve', () => rpc('decide_agency_proposal', { p_id: p.id, p_approve: true, p_note: null }), 'Custom commission approved — the officer can send it now')}>Approve</Button>
                        <Button size="sm" variant="ghost" icon={XCircle} aria-label="Reject" disabled={!!busy} onClick={() => void run('reject', () => rpc('decide_agency_proposal', { p_id: p.id, p_approve: false, p_note: null }), 'Custom commission rejected')} />
                      </>}
                      {['draft', 'pending_approval', 'delivery_failed', 'awaiting_confirmation'].includes(p.status) && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run('cancel', () => rpc('cancel_agency_proposal', { p_id: p.id }), 'Proposal cancelled')}>Cancel</Button>}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            {openProposal?.status === 'pending_approval' && !commissionManager && <Alert tone="info" className="mx-5 mb-5">The custom commission is waiting for a commission manager's approval. You can send it once approved.</Alert>}
          </Card>

          <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
            <Card className="min-w-0">
              <CardHeader title="Registration" />
              <div className="px-5 pb-5 text-sm">
                {a.registration_id ? (
                  <>
                    <p>{reg ? <>{reg.reference} · <Badge tone={REGISTRATION[reg.status]?.tone ?? 'slate'}>{REGISTRATION[reg.status]?.label ?? reg.status}</Badge></> : <Badge tone={STAGE[a.stage].tone}>{STAGE[a.stage].label}</Badge>}</p>
                    <p className="mt-2 text-ink-soft">Approval and the partner account are handled by SSI GLOBAL administrators{manager ? <> in <Link className="underline" to="../../partners/registrations" relative="path">Partner Registrations</Link></> : ''}.</p>
                  </>
                ) : (
                  <>
                    <p className="text-ink-soft">The registration form is emailed automatically when the agency confirms a proposal{manager ? ', or you can issue it now' : ''}.</p>
                    {manager && (a.stage === 'registration_pending' || a.stage === 'proposal_confirmed' || a.stage === 'mou_sent') && (
                      <Button size="sm" className="mt-3" icon={Link2} disabled={!!busy} onClick={() => void run('issue', () => rpc('issue_agency_registration', { p_prospect: a.id }), 'Registration created — email the link from Partner Registrations')}>Issue registration link</Button>
                    )}
                  </>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="MOU" action={<Button size="sm" variant="secondary" icon={FileSignature} onClick={() => setModal({ kind: 'mou' })}>Record MOU sent</Button>} />
              <div className="px-5 pb-5 text-sm">
                {mous.length === 0 ? <p className="text-ink-soft">No MOU recorded. Record one only when it has actually been sent.</p> : mous.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                    <span>{m.reference ?? 'MOU'} · sent {fmtDate(m.sent_on)}{m.signed_on ? ` · signed ${fmtDate(m.signed_on)}` : ''}</span>
                    <span className="flex items-center gap-1"><Badge tone={m.status === 'signed' ? 'green' : m.status === 'cancelled' ? 'slate' : 'violet'}>{m.status === 'sent' ? 'Sent' : m.status === 'signed' ? 'Signed' : 'Cancelled'}</Badge>
                      {m.status === 'sent' && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'sign', m })}>Update</Button>}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="History" subtitle="Every contact, note, proposal and registration step. Nothing is deleted." />
            {!history ? <p className="px-5 pb-5 text-sm text-ink-soft">Loading…</p> : history.length === 0 ? <p className="px-5 pb-5 text-sm text-ink-soft">Nothing yet.</p> : (
              <ol className="px-5 pb-5">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-line py-2 pl-4">
                    <div className="text-sm font-medium text-heading">{ACTIVITY[h.kind] ?? h.kind}{h.kind === 'stage' || h.kind === 'contact_status' ? `: ${label(h)}` : ''}</div>
                    {h.note && <div className="whitespace-pre-wrap text-sm text-ink-soft">{h.note}</div>}
                    {typeof h.detail?.next_follow_up === 'string' && <div className="text-xs text-ink-mute">Next follow-up {fmtDate(h.detail.next_follow_up)}</div>}
                    <div className="text-xs text-ink-mute">{fmtWhen(h.at)} · {staffName(h.actor)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {modal?.kind === 'edit' && <EditAgency a={a} manager={manager} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'log' && <LogActivity a={a} kind={modal.log} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'stage' && <ChangeStage a={a} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'mou' && <RecordMou a={a} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'sign' && <UpdateMou m={modal.m} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'view' && <ViewProposal p={modal.p} onClose={() => setModal(null)} />}
      {modal?.kind === 'proposal' && <ProposalForm a={a} onClose={() => setModal(null)} onDone={reload} />}
    </>
  );
}

function label(h: AgencyActivity) {
  const to = h.detail?.to as string | undefined;
  if (h.kind === 'stage') return to && to in STAGE ? STAGE[to as Stage].label : to ?? '';
  return to === 'connected' ? 'Connected' : 'Not connected';
}

// ------------------------------------------------------------------ small modals
function EditAgency({ a, manager, onClose, onSaved }: { a: Agency; manager: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { db } = useStore();
  const [f, setF] = useState({ company_name: a.company_name ?? '', contact_name: a.contact_name ?? '', phone: a.phone ?? '', email: a.email ?? '', country: a.country ?? '', notes: a.notes ?? '', assigned_officer: a.assigned_officer ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.company_name.trim() && !f.contact_name.trim() && !f.phone.trim()) return toast.error('Keep at least the agency name, contact person or phone number');
    setBusy(true);
    const { assigned_officer, ...rest } = f;
    const r = await rpc('update_agency_prospect', { p_id: a.id, p: manager ? { ...rest, assigned_officer } : rest });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success('Agency updated'); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Edit agency" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Agency / company name"><Input value={f.company_name} onChange={set('company_name')} maxLength={160} /></Field>
        <Field label="Contact person"><Input value={f.contact_name} onChange={set('contact_name')} maxLength={120} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} maxLength={40} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set('email')} maxLength={200} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set('country')} maxLength={80} /></Field>
        {manager && <Field label="Assigned officer"><Select value={f.assigned_officer} onChange={set('assigned_officer')}><option value="">—</option>{db.staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>}
        <Field label="Internal notes" className="sm:col-span-2"><Textarea rows={4} value={f.notes} onChange={set('notes')} maxLength={4000} /></Field>
      </div>
    </Modal>
  );
}

function LogActivity({ a, kind, onClose, onSaved }: { a: Agency; kind: LogKind; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [next, setNext] = useState(kind === 'follow_up' ? '' : '');
  const [busy, setBusy] = useState(false);
  const [req] = useState(() => crypto.randomUUID());
  const save = async () => {
    if (kind === 'follow_up' && !next) return toast.error('Choose the follow-up date');
    if (kind === 'note' && !note.trim()) return toast.error('Write the note');
    setBusy(true);
    const r = await rpc('log_agency_activity', { p_id: a.id, p_kind: kind, p_note: note || null, p_next: next || null, p_request: req });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(LOG_TITLE[kind] + ' — saved'); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={LOG_TITLE[kind]} subtitle={agencyName(a)} dirty={!!note.trim()}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      <Field label={kind === 'note' ? 'Note' : 'What was discussed'}><Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus /></Field>
      <Field label={kind === 'follow_up' ? 'Follow-up date' : 'Next follow-up (optional)'} required={kind === 'follow_up'} className="mt-3">
        <DatePicker value={next} onChange={setNext} min={today()} />
      </Field>
      {(kind === 'call' || kind === 'follow_up_done' || kind === 'meeting') && <p className="mt-3 text-xs text-ink-mute">Counts in your Daily Work Report automatically ({kind === 'meeting' ? 'Meetings fixed' : 'Follow-up calls completed'}).</p>}
    </Modal>
  );
}

function ChangeStage({ a, onClose, onSaved }: { a: Agency; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [stage, setStage] = useState<Stage>(MANUAL_STAGES.includes(a.stage) ? a.stage : 'discussion');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const options = a.stage === 'onboarded' ? (['inactive'] as Stage[]) : MANUAL_STAGES;
  const save = async () => {
    setBusy(true);
    const r = await rpc('set_agency_stage', { p_id: a.id, p_stage: stage, p_note: note || null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(`Stage: ${STAGE[stage].label}`); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Change stage" subtitle="Proposal, MOU, registration and onboarding stages follow those events automatically."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      <Field label="Stage"><Select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>{options.map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}</Select></Field>
      <Field label="Reason / note" className="mt-3"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Field>
    </Modal>
  );
}

function RecordMou({ a, onClose, onSaved }: { a: Agency; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [ref, setRef] = useState('');
  const [on, setOn] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await rpc('record_agency_mou', { p_id: a.id, p_reference: ref || null, p_sent_on: on, p_note: note || null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success('MOU recorded as sent'); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Record MOU sent" subtitle="Record it only once the MOU has actually been sent. Sent is not signed."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !on} onClick={() => void save()}>Record</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="MOU reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} /></Field>
        <Field label="Sent on" required><DatePicker value={on} onChange={setOn} max={today()} clearable={false} /></Field>
        <Field label="Note" className="sm:col-span-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

function UpdateMou({ m, onClose, onSaved }: { m: Mou; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'signed' | 'cancelled'>('signed');
  const [on, setOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await rpc('set_agency_mou_status', { p_mou: m.id, p_status: status, p_signed_on: status === 'signed' ? on : null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(status === 'signed' ? 'MOU marked signed' : 'MOU cancelled'); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Update ${m.reference ?? 'MOU'}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      <Segmented options={[{ value: 'signed', label: 'Signed' }, { value: 'cancelled', label: 'Cancelled' }]} value={status} onChange={(v) => setStatus(v as 'signed' | 'cancelled')} />
      {status === 'signed' && <Field label="Signed on" required className="mt-3"><DatePicker value={on} onChange={setOn} min={m.sent_on} max={today()} clearable={false} /></Field>}
    </Modal>
  );
}

function ViewProposal({ p, onClose }: { p: Proposal; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={`Proposal ${p.reference}`} subtitle={`${p.company_name} · ${p.recipient_name} <${p.recipient_email}>`}>
      <div className="flex flex-wrap gap-2 text-sm"><Badge tone={PROPOSAL[p.status].tone}>{PROPOSAL[p.status].label}</Badge><span>{p.arrangement.tier_label} · {p.country}</span>
        {p.expires_at && <span className="text-ink-mute">valid until {fmtDate(p.expires_at)}</span>}</div>
      {p.message && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm">{p.message}</p>}
      <Table className="hr-table mt-3" head={['University', 'Country', 'Commission']}>
        {p.arrangement.universities.map((u) => (
          <tr key={u.record_id}><td>{[u.university, u.study_level, u.variant].filter(Boolean).join(' · ')}{u.conditions && <div className="text-xs text-ink-mute">{u.conditions}</div>}</td>
            <td>{u.country}</td><td className="font-semibold tabular-nums">{fmtCommission(u.commission_kind as ValueKind, String(u.commission_value), u.currency)}</td></tr>
        ))}
      </Table>
      <h4 className="mt-4 text-sm font-semibold text-heading">{p.terms_title}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{p.terms_body}</p>
      <dl className="mt-4 grid gap-1 text-xs text-ink-mute">
        <div>Prepared {fmtWhen(p.created_at)} · sent {fmtWhen(p.sent_at)} · email: {EMAIL[p.email_status]}</div>
        {p.first_viewed_at && <div>Opened by the recipient {fmtWhen(p.first_viewed_at)} (opening does not confirm)</div>}
        {p.confirmed_at && <div>Confirmed {fmtWhen(p.confirmed_at)} by {p.confirmed_name}</div>}
        {p.declined_at && <div>Declined {fmtWhen(p.declined_at)}{p.decline_reason ? ` — ${p.decline_reason}` : ''}</div>}
      </dl>
    </Modal>
  );
}

// ------------------------------------------------------------------ proposal form
interface Option { record_id: string; university: string; country: string; study_level: string | null; variant: string | null; intake: string | null;
  tier_id: string; tier_label: string; commission_kind: ValueKind; commission_value: number; currency: string | null; conditions: string | null }

function ProposalForm({ a, onClose, onDone }: { a: Agency; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ company_name: a.company_name ?? '', recipient_name: a.contact_name ?? '', recipient_email: a.email ?? '', country: a.country ?? '', message: '' });
  const [arr, setArr] = useState<'tier' | 'custom'>('tier');
  const [tier, setTier] = useState('');
  const [custom, setCustom] = useState({ kind: 'percent', value: '', currency: 'GBP' });
  const [options, setOptions] = useState<Option[] | null>(null);
  const [terms, setTerms] = useState<Terms | null | undefined>(undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [uniCountry, setUniCountry] = useState('');
  const [q, setQ] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [req] = useState(() => crypto.randomUUID());
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    void (async () => {
      const o = await rpc<Option[]>('proposal_commission_options', { p_country: null });
      if (!o.ok) { setLoadErr(o.error); setOptions([]); } else setOptions(o.data);
      if (supabase) { const { data } = await supabase.from('proposal_terms').select('*').eq('active', true).maybeSingle(); setTerms((data as Terms | null) ?? null); }
    })();
  }, []);
  const tiers = useMemo(() => [...new Map((options ?? []).map((o) => [o.tier_id, o.tier_label])).entries()], [options]);
  useEffect(() => { if (!tier && tiers.length) setTier(tiers[0][0]); }, [tiers, tier]);
  const records = useMemo(() => {
    const m = new Map<string, { o: Option; rates: Record<string, Option> }>();
    for (const o of options ?? []) {
      const e = m.get(o.record_id) ?? { o, rates: {} };
      e.rates[o.tier_id] = o;
      m.set(o.record_id, e);
    }
    return [...m.values()];
  }, [options]);
  const countries = useMemo(() => [...new Set(records.map((r) => r.o.country))].sort(), [records]);
  const shown = records.filter((r) => (!uniCountry || r.o.country === uniCountry) && matches(q, r.o.university, r.o.variant ?? '', r.o.study_level ?? ''));
  const eligible = (r: (typeof records)[number]) => arr === 'custom' || !!r.rates[tier];
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const validate = () => {
    const m: string[] = [];
    if (!f.company_name.trim()) m.push('Agency / company name');
    if (!f.recipient_name.trim()) m.push('Primary contact name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.recipient_email.trim())) m.push('Valid recipient email');
    if (!f.country.trim()) m.push('Country');
    if (arr === 'tier' && !tier) m.push('Commission tier');
    if (arr === 'custom' && !(Number(custom.value) > 0)) m.push('Custom commission value');
    if (picked.size === 0) m.push('At least one university');
    if (!terms) m.push('Approved proposal terms (an administrator must publish them)');
    setMissing(m);
    return m.length === 0;
  };
  const submit = async () => {
    if (!validate()) return;
    const ids = [...picked].filter((id) => { const r = records.find((x) => x.o.record_id === id); return r && eligible(r); });
    setBusy(true);
    const r = await rpc<{ id: string; status: string }>('create_agency_proposal', { p_prospect: a.id, p_request: req, p: {
      ...f, arrangement: arr, tier_id: tier, custom_kind: custom.kind, custom_value: custom.value, custom_currency: custom.currency, record_ids: ids, terms_id: terms?.id,
    } });
    if (!r.ok) { setBusy(false); return toast.error('Proposal not created', r.error); }
    if (r.data.status === 'pending_approval') {
      setBusy(false);
      toast.info('Waiting for approval', 'A custom commission must be approved by a commission manager before it is sent.');
      onDone(); return onClose();
    }
    const s = await sendProposal(r.data.id);
    setBusy(false);
    if (s.ok) toast.success('Proposal sent', s.message); else toast.error('Proposal saved but not sent', s.message);
    onDone(); onClose();
  };

  return (
    <Modal open onClose={onClose} size="wide" dirty title="Send Proposal" subtitle={`${agencyName(a)} · emailed as “SSI GLOBAL — Partnership Proposal for ${f.company_name || '…'}”`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Send} disabled={busy || options === null} onClick={() => void submit()}>{busy ? 'Sending…' : arr === 'custom' ? 'Submit for approval' : 'Send Proposal'}</Button></>}>
      {missing.length > 0 && <Alert tone="error" className="mb-4" title="Add these before sending">{missing.join(' · ')}</Alert>}
      {loadErr && <Alert tone="warning" className="mb-4">{loadErr}</Alert>}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Agency / company name" required><Input value={f.company_name} onChange={set('company_name')} maxLength={160} invalid={missing.includes('Agency / company name')} /></Field>
        <Field label="Primary contact" required><Input value={f.recipient_name} onChange={set('recipient_name')} maxLength={120} invalid={missing.includes('Primary contact name')} /></Field>
        <Field label="Recipient email" required><Input type="email" value={f.recipient_email} onChange={set('recipient_email')} maxLength={200} invalid={missing.includes('Valid recipient email')} /></Field>
        <Field label="Country" required><Input value={f.country} onChange={set('country')} maxLength={80} invalid={missing.includes('Country')} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Commission arrangement"><Segmented options={[{ value: 'tier', label: 'Standard tier' }, { value: 'custom', label: 'Custom commission' }]} value={arr} onChange={(v) => setArr(v as 'tier' | 'custom')} /></Field>
        {arr === 'tier' ? (
          <Field label="Tier"><Segmented options={tiers.map(([v, l]) => ({ value: v, label: l }))} value={tier} onChange={setTier} /></Field>
        ) : (
          <>
            <Field label="Type"><Segmented options={[{ value: 'percent', label: '%' }, { value: 'amount', label: 'Amount' }]} value={custom.kind} onChange={(v) => setCustom((c) => ({ ...c, kind: v }))} /></Field>
            <Field label={custom.kind === 'percent' ? 'Percent' : 'Amount'}><Input type="number" min={0} step="0.01" value={custom.value} onChange={(e) => setCustom((c) => ({ ...c, value: e.target.value }))} className="w-28" /></Field>
            {custom.kind === 'amount' && <Field label="Currency"><Input value={custom.currency} maxLength={3} onChange={(e) => setCustom((c) => ({ ...c, currency: e.target.value.toUpperCase() }))} className="w-20" /></Field>}
          </>
        )}
      </div>
      {arr === 'custom' && <Alert tone="info" className="mt-3">A custom commission needs a commission manager's approval before it can be sent.</Alert>}

      <div className="mt-4 rounded-2xl border border-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search university…" className="w-full sm:w-60" />
          <FilterSelect label="Country" value={uniCountry} onChange={setUniCountry} options={[{ value: '', label: 'All countries' }, ...countries]} />
          <Button size="sm" variant="secondary" onClick={() => setPicked((s) => new Set([...s, ...shown.filter(eligible).map((r) => r.o.record_id)]))}>Select all {shown.filter(eligible).length} shown</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          <span className="ml-auto text-sm text-ink-soft"><b className="text-heading">{picked.size}</b> selected</span>
        </div>
        <div className="max-h-[320px] overflow-auto">
          {options === null ? <p className="p-4 text-sm text-ink-soft">Loading commission options…</p> : shown.length === 0 ? <p className="p-4 text-sm text-ink-soft">No commission records match.</p> : (
            <Table className="hr-table" head={['', 'University', 'Country', arr === 'tier' ? `${tiers.find(([v]) => v === tier)?.[1] ?? 'Tier'} commission` : 'Commission', 'Conditions']}>
              {shown.map((r) => {
                const rate = r.rates[tier];
                const ok = eligible(r);
                return (
                  <tr key={r.o.record_id} className={cn(!ok && 'opacity-50')}>
                    <td><Checkbox checked={picked.has(r.o.record_id) && ok} disabled={!ok} onCheckedChange={() => toggle(r.o.record_id)} label={<span className="sr-only">Select {r.o.university}</span>} /></td>
                    <td className="min-w-[200px]">{r.o.university}<div className="text-xs text-ink-mute">{[r.o.study_level, r.o.variant, r.o.intake].filter(Boolean).join(' · ')}</div></td>
                    <td>{r.o.country}</td>
                    <td className="whitespace-nowrap font-semibold tabular-nums">{arr === 'custom' ? (custom.value ? fmtCommission(custom.kind as ValueKind, custom.value, custom.kind === 'amount' ? custom.currency : null) : '—')
                      : rate ? fmtCommission(rate.commission_kind, String(rate.commission_value), rate.currency) : <span className="font-normal text-ink-mute">No valid rate</span>}</td>
                    <td className="max-w-[240px] text-xs text-ink-soft">{(arr === 'tier' ? rate?.conditions : r.o.conditions) ?? '—'}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
      </div>

      <Field label="Personal message (optional)" className="mt-4"><Textarea rows={3} value={f.message} onChange={set('message')} maxLength={2000} /></Field>
      <div className="mt-4 rounded-2xl bg-canvas p-4 text-sm">
        {terms === undefined ? 'Loading terms…' : terms ? (<><b className="text-heading">{terms.title}</b><p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-ink-soft">{terms.body}</p></>)
          : <span className="text-red-600 dark:text-red-400">No approved proposal terms are published. Ask an administrator to publish them in Agencies → Proposal terms & settings.</span>}
      </div>
      <p className="mt-3 text-xs text-ink-mute">Only partner-facing commission is included — never SSI GLOBAL's own commission, processing routes or portal names. The agency confirms on a secure page; opening the email does not accept anything.</p>
    </Modal>
  );
}
