// Agency details: contact status, pipeline stage, follow-ups, proposals (commission from the
// commission master, partner-facing values only), MOUs, registration progress and full history.
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarPlus, MoreHorizontal, CheckCircle2, Eye, FileSignature, Handshake, Link2, Mail, Pencil, PhoneCall, Send, StickyNote, UserCheck, UserCog, UserX, Users, XCircle,
} from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DatePicker, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, SearchInput, Segmented, Select, Table, Textarea } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { cn, matches } from '../../lib/utils';
import {
  ACTIVITY, CONTACT, EMAIL, MANUAL_STAGES, stageLabel, PROPOSAL, REGISTRATION, STAGE, agencyAccess, agencyManager, agencyName, fmtDate, fmtWhen, rpc, sendProposal, today,
  AgencyDemo, EMAIL_STATE, resendAgencyEmail, useAgencyData, type Agency, type AgencyEmail, type AgencyActivity, type Mou, type Proposal, type Stage, type Terms,
  AGENCY_TYPE, typeKey, type AgencyType,
} from '../../lib/agencies';
import { fmtCommission, type ValueKind } from '../../lib/commissions';
import { AgencyTypeBadge, AssignOfficerModal, OfficerHistory, useOfficerCandidates } from './AgencyBulk';

type LogKind = 'contact_attempt' | 'call' | 'meeting' | 'follow_up_done' | 'note' | 'follow_up';
const LOG_TITLE: Record<LogKind, string> = { contact_attempt: 'Contact attempt (no answer / not reached)', call: 'Log call', meeting: 'Record meeting', follow_up_done: 'Follow-up completed', note: 'Add note', follow_up: 'Add follow-up' };

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
  const [modal, setModal] = useState<null | { kind: 'edit' } | { kind: 'log'; log: LogKind } | { kind: 'proposal' } | { kind: 'email' } | { kind: 'mou' } | { kind: 'stage' }
    | { kind: 'view'; p: Proposal } | { kind: 'sign'; m: Mou }>(null);
  const [busy, setBusy] = useState('');

  const a = data?.agencies.find((x) => x.id === id);
  const proposals = useMemo(() => (data?.proposals ?? []).filter((p) => p.prospect_id === id), [data, id]);
  const mous = useMemo(() => (data?.mous ?? []).filter((m) => m.prospect_id === id), [data, id]);
  const reg = a?.registration_id ? data?.registrations.find((r) => r.id === a.registration_id) : undefined;
  const candidates = useOfficerCandidates(allowed);
  const [changingOfficer, setChangingOfficer] = useState(false);
  const staffName = (uid: string | null) => (uid ? candidates.find((c) => c.id === uid)?.full_name ?? db.staff.find((s) => s.id === uid)?.fullName ?? (uid === session?.userId ? session?.name : 'SSI GLOBAL') : 'The agency');

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
  // Email is optional until a proposal is sent: ask for it first when the agency has none.
  const startProposal = () => setModal({ kind: a?.email ? 'proposal' : 'email' });
  const [emails, setEmails] = useState<AgencyEmail[]>([]);
  useEffect(() => {
    if (!supabase || !id || demo) return;
    void supabase.from('agency_emails').select('*').eq('prospect_id', id).then(({ data: e }) => setEmails((e ?? []) as AgencyEmail[]));
  }, [id, data, demo]);
  const retry = async (kind: 'mou' | 'registration') => {
    setBusy(`retry:${kind}`);
    const r = await resendAgencyEmail(id, kind);
    setBusy('');
    if (r.ok) toast.success(r.message); else toast.error('Not sent', r.message);
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
        subtitle={<span className="flex flex-wrap items-center gap-2">{a.reference}<Badge tone={CONTACT[a.contact_status].tone} dot>{CONTACT[a.contact_status].label}</Badge><Badge tone={STAGE[a.stage].tone}>{stageLabel(a)}</Badge><AgencyTypeBadge type={a.agency_type} /></span>}
        actions={<>
          <Button variant="secondary" icon={Pencil} onClick={() => setModal({ kind: 'edit' })}>Edit</Button>
          {!a.assigned_officer && <Button variant="secondary" icon={UserCheck} disabled={!!busy} onClick={() => void run('claim', () => rpc('claim_agency', { p_id: id }), 'You are now the officer for this agency')}>Take this agency</Button>}
          {manager && <Button variant="secondary" icon={UserCog} onClick={() => setChangingOfficer(true)}>Change officer</Button>}
          {a.contact_status !== 'connected' && <Button variant="secondary" icon={UserCheck} disabled={!!busy} onClick={() => void contact('connected')}>Mark Connected</Button>}
          {a.contact_status !== 'not_connected' && <Button variant="secondary" icon={UserX} disabled={!!busy} onClick={() => void contact('not_connected')}>Mark Not connected</Button>}
          <Menu width="w-56" trigger={() => <Button variant="secondary" icon={MoreHorizontal}>Log activity</Button>} items={[
            { label: 'Contact attempt', icon: PhoneCall, onClick: () => setModal({ kind: 'log', log: 'contact_attempt' }) },
            { label: 'Log call', icon: PhoneCall, onClick: () => setModal({ kind: 'log', log: 'call' }) },
            { label: 'Add follow-up', icon: CalendarPlus, onClick: () => setModal({ kind: 'log', log: 'follow_up' }) },
            { label: 'Follow-up completed', icon: CheckCircle2, onClick: () => setModal({ kind: 'log', log: 'follow_up_done' }) },
            { label: 'Record meeting', icon: Handshake, onClick: () => setModal({ kind: 'log', log: 'meeting' }) },
            { label: 'Add note', icon: StickyNote, onClick: () => setModal({ kind: 'log', log: 'note' }) },
            { label: 'Record MOU sent', icon: FileSignature, onClick: () => setModal({ kind: 'mou' }) },
            { label: 'Change stage', icon: Pencil, onClick: () => setModal({ kind: 'stage' }) },
          ]} />
          <Button icon={Send} disabled={closed} onClick={startProposal}>Send Proposal</Button>
        </>}
      />
      {changingOfficer && <AssignOfficerModal ids={[a.id]} current={a.assigned_officer} candidates={candidates} onClose={() => setChangingOfficer(false)} />}
      {a.partner_id && <Alert tone="success" className="mb-4">Onboarded — linked to the partner in Clients & Branches{manager ? <> · <Link className="underline" to={`../../partners/${a.partner_id}`} relative="path">open partner</Link></> : null}.</Alert>}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="min-w-0 lg:col-span-1">
          <CardHeader title="Agency details" />
          <dl className="grid gap-3 px-5 pb-5 text-sm">
            {([
              ['Company', a.company_name], ['Contact person', a.contact_name], ['Phone', a.phone], ['Email', a.email], ['Country', a.country],
              ['Agency type', AGENCY_TYPE[typeKey(a.agency_type)].label + (a.agency_type_changed_at ? ` · ${fmtWhen(a.agency_type_changed_at)} · ${staffName(a.agency_type_changed_by ?? null)}` : '')],
              ['Assigned officer', a.assigned_officer ? staffName(a.assigned_officer) : 'Unassigned'], ['Contact status changed', a.contact_changed_at ? `${fmtWhen(a.contact_changed_at)} · ${staffName(a.contact_changed_by)}` : null],
              ['Last contact', fmtDate(a.last_contact_at)], ['Next follow-up', fmtDate(a.next_follow_up)], ['Selected commission', a.selected_tier],
              ['Added', `${fmtWhen(a.created_at)} · ${staffName(a.created_by)}`],
            ] as [string, string | null][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-ink-mute">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-heading">{v || '—'}</dd></div>
            ))}
          </dl>
          {a.notes && <div className="mx-5 mb-5 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm text-ink-soft">{a.notes}</div>}
          <OfficerHistory prospectId={a.id} nameOf={staffName} refreshKey={a.assigned_officer} />
          {a.source === 'linkedin' && (
            <div className="mx-5 mb-5 rounded-xl border border-line p-3 text-xs text-ink-soft">
              <div className="font-semibold text-heading">Source: LinkedIn Outreach</div>
              Prospect {String((a.source_values as { linkedin_reference?: string } | null)?.linkedin_reference ?? '—')} · moved {fmtWhen(a.created_at)}.
              {(a.source_values as { linkedin_id?: string } | null)?.linkedin_id && (
                <> <Link className="font-semibold text-rust underline" to={`../linkedin?p=${(a.source_values as { linkedin_id: string }).linkedin_id}`} relative="path">Open LinkedIn history</Link></>
              )}
            </div>
          )}
          {a.source === 'import' && (
            <div className="mx-5 mb-5 rounded-xl border border-line p-3 text-xs text-ink-soft">
              <div className="font-semibold text-heading">Imported from a spreadsheet</div>
              Row {a.source_row ?? '—'} · original status “{a.source_status ?? '—'}” · {fmtWhen(a.created_at)}. Contact status and dates before the import are not known.
            </div>
          )}
          {a.needs_reconciliation && <Reconcile a={a} manager={manager} onSaved={reload} />}
          {!a.needs_reconciliation && a.historical_onboarded && !a.partner_id && (
            <p className="mx-5 mb-5 text-xs text-ink-mute">Onboarded before the CRM; no partner account is linked{a.reconciliation_note ? ` — ${a.reconciliation_note}` : ''}.</p>
          )}
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:col-span-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Proposals" subtitle="Commission comes from Commission Management — partner-facing rates only." action={<Button size="sm" icon={Send} disabled={closed} onClick={startProposal}>Send Proposal</Button>} />
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
          {(emails.length > 0 || a.stage === 'proposal_confirmed' || a.registration_id) && (
            <Card>
              <CardHeader title="Onboarding emails" subtitle="Sent automatically after the agency confirms a proposal. Each is tracked on its own." />
              <div className="grid gap-2 px-5 pb-5 text-sm sm:grid-cols-2">
                {(['mou', 'registration'] as const).map((k) => {
                  const e = emails.find((x) => x.kind === k);
                  return (
                    <div key={k} className="rounded-xl border border-line p-3">
                      <div className="flex items-center justify-between gap-2"><b className="text-heading">{k === 'mou' ? 'MOU email' : 'Registration form email'}</b>
                        {e ? <Badge tone={EMAIL_STATE[e.status].tone}>{EMAIL_STATE[e.status].label}</Badge> : <Badge tone="slate">Not sent</Badge>}</div>
                      <p className="mt-1 text-xs text-ink-mute">{e ? `${e.attempts} attempt${e.attempts === 1 ? '' : 's'} · ${fmtWhen(e.updated_at)}${e.detail ? ` · ${e.detail}` : ''}` : k === 'registration' && !a.registration_id ? 'No registration yet.' : '—'}</p>
                      {(!e || e.status === 'failed' || e.status === 'not_configured' || e.status === 'accepted') && (k === 'mou' || a.registration_id) && (
                        <Button size="sm" variant="secondary" className="mt-2" disabled={!!busy} onClick={() => void retry(k)}>{busy === `retry:${k}` ? 'Sending…' : e ? 'Send again' : 'Send now'}</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

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

      {modal?.kind === 'edit' && <EditAgency a={a} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'log' && <LogActivity a={a} kind={modal.log} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'stage' && <ChangeStage a={a} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'mou' && <RecordMou a={a} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'sign' && <UpdateMou m={modal.m} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === 'view' && <ViewProposal p={modal.p} onClose={() => setModal(null)} />}
      {modal?.kind === 'proposal' && <ProposalForm a={a} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'email' && <AskEmail a={a} onClose={() => setModal(null)} onSaved={() => { void reload(); setModal({ kind: 'proposal' }); }} />}
    </>
  );
}

function label(h: AgencyActivity) {
  const to = h.detail?.to as string | undefined;
  if (h.kind === 'stage') return to && to in STAGE ? STAGE[to as Stage].label : to ?? '';
  return to === 'connected' ? 'Connected' : 'Not connected';
}

// ------------------------------------------------------------------ small modals
/** A proposal needs an email address: ask for it, save it on the agency, then continue. */
function AskEmail({ a, onClose, onSaved }: { a: Agency; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const save = async () => {
    if (bad) return;
    setBusy(true);
    const r = await rpc('update_agency_prospect', { p_id: a.id, p: { email: email.trim() } });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Email needed to send a proposal" subtitle={`${agencyName(a)} has no email address yet.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || bad} onClick={() => void save()}>Save & continue</Button></>}>
      <Field label="Agency email" required error={email && bad ? 'Enter a valid email address' : undefined}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoFocus invalid={!!email && bad} />
      </Field>
      <p className="mt-2 text-xs text-ink-mute">Saved on the agency. The proposal, MOU and registration form are sent to this address.</p>
    </Modal>
  );
}

function EditAgency({ a, onClose, onSaved }: { a: Agency; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ company_name: a.company_name ?? '', contact_name: a.contact_name ?? '', phone: a.phone ?? '', email: a.email ?? '', country: a.country ?? '', notes: a.notes ?? '' });
  const [agencyType, setAgencyType] = useState<AgencyType | ''>(a.agency_type ?? '');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.company_name.trim() && !f.contact_name.trim() && !f.phone.trim()) return toast.error('Keep at least the agency name, contact person or phone number');
    setBusy(true);
    // The officer is changed with "Change officer" (eligible employees only, kept in the officer history).
    // Agency Type is sent only when chosen; an edit never clears a classification.
    const r = await rpc('update_agency_prospect', { p_id: a.id, p: { ...f, ...(agencyType && agencyType !== a.agency_type ? { agency_type: agencyType } : {}) } });
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
        <Field label="Agency type">
          <Segmented options={[...(a.agency_type ? [] : [{ value: '', label: 'Not classified' }]), { value: 'domestic', label: 'Domestic' }, { value: 'international', label: 'International' }]}
            value={agencyType} onChange={(v) => setAgencyType(v as AgencyType | '')} />
        </Field>
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
interface Edit { value: string; kind?: 'percent' | 'amount'; currency?: string }
interface Line { id: string; university: string; sub: string; country: string; base: Option | undefined; kind: 'percent' | 'amount' | undefined; value: string;
  currency: string | null; conditions: string | null; customized: boolean; needsApproval: boolean; problem: string }

/**
 * Send Proposal. Standard tier: the tier's partner rates as they are. Custom commission: choose a
 * base tier, then every selected commission record (each university / level / campus / intake rule
 * is its own row) starts at that tier's rate and can be changed on its own. Edits are kept while
 * searching, filtering or switching rows; nothing reloads the values except an explicit reset.
 */
function ProposalForm({ a, onClose, onDone }: { a: Agency; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { session } = useStore();
  const commissionManager = !!session && (session.userRole === 'super_admin' || session.permissions.includes('commission_manage'));
  const [f, setF] = useState({ company_name: a.company_name ?? '', recipient_name: a.contact_name ?? '', recipient_email: a.email ?? '', country: a.country ?? '', message: '' });
  const [mode, setMode] = useState<'tier' | 'custom'>('tier');
  const [tier, setTier] = useState('');
  const [options, setOptions] = useState<Option[] | null>(null);
  const [terms, setTerms] = useState<Terms | null | undefined>(undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [uniCountry, setUniCountry] = useState('');
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [bulk, setBulk] = useState('');
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [req] = useState(() => crypto.randomUUID());
  const [loadErr, setLoadErr] = useState('');

  // Loaded once: realtime updates never reset the form.
  const demo = useContext(AgencyDemo);
  useEffect(() => {
    if (demo?.demoOptions) { setOptions(demo.demoOptions as Option[]); setTerms(demo.demoTerms ?? null); return; }
    void (async () => {
      const o = await rpc<Option[]>('proposal_commission_options', { p_country: null });
      if (!o.ok) { setLoadErr(o.error); setOptions([]); } else setOptions(o.data);
      if (supabase) { const { data } = await supabase.from('proposal_terms').select('*').eq('active', true).maybeSingle(); setTerms((data as Terms | null) ?? null); }
    })();
  }, [demo]);
  const tiers = useMemo(() => [...new Map((options ?? []).map((o) => [o.tier_id, o.tier_label])).entries()], [options]);
  useEffect(() => { if (!tier && tiers.length) setTier(tiers[0][0]); }, [tiers, tier]);
  const tierLabel = tiers.find(([v]) => v === tier)?.[1] ?? 'tier';
  const records = useMemo(() => {
    const m = new Map<string, { o: Option; rates: Record<string, Option> }>();
    for (const o of options ?? []) {
      const e = m.get(o.record_id) ?? { o, rates: {} };
      e.rates[o.tier_id] = o;
      m.set(o.record_id, e);
    }
    return [...m.values()].sort((x, y) => x.o.country.localeCompare(y.o.country) || x.o.university.localeCompare(y.o.university));
  }, [options]);
  const byId = useMemo(() => new Map(records.map((r) => [r.o.record_id, r])), [records]);

  const lineOf = (id: string): Line | null => {
    const r = byId.get(id);
    if (!r) return null;
    const base = r.rates[tier];
    const e = edits[id];
    const kind = base?.commission_kind as 'percent' | 'amount' | undefined ?? e?.kind;
    const value = mode === 'tier' ? String(base?.commission_value ?? '') : e?.value ?? (base ? String(base.commission_value) : '');
    const currency = base ? base.currency : kind === 'amount' ? (e?.currency ?? '').toUpperCase() || null : null;
    const n = Number(value);
    const problem = mode === 'tier' ? (base ? '' : `No ${tierLabel} rate`)
      : !kind ? 'Choose percent or amount' : !(n > 0) ? 'Enter the commission' : kind === 'percent' && n > 100 ? 'At most 100%'
      : kind === 'amount' && !/^[A-Z]{3}$/.test(currency ?? '') ? 'Enter the currency' : '';
    const customized = mode === 'custom' && (!base || n !== Number(base.commission_value));
    const needsApproval = mode === 'custom' && (!base || n > Number(base.commission_value));
    return { id, university: r.o.university, sub: [r.o.study_level, r.o.variant, r.o.intake].filter(Boolean).join(' · '), country: r.o.country, base, kind, value,
      currency, conditions: base?.conditions ?? r.o.conditions, customized, needsApproval, problem };
  };
  const lines = [...picked].map(lineOf).filter((l): l is Line => !!l);
  const countries = useMemo(() => [...new Set(records.map((r) => r.o.country))].sort(), [records]);
  const shown = records.filter((r) => (!uniCountry || r.o.country === uniCountry) && matches(q, r.o.university, r.o.variant ?? '', r.o.study_level ?? '')
    && (!onlyChanged || (picked.has(r.o.record_id) && !!lineOf(r.o.record_id)?.customized)));
  const selectable = (r: (typeof records)[number]) => mode === 'custom' || !!r.rates[tier];
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setEdit = (id: string, patch: Partial<Edit>) => setEdits((m) => ({ ...m, [id]: { ...m[id], value: m[id]?.value ?? String(byId.get(id)?.rates[tier]?.commission_value ?? ''), ...patch } }));
  const reset = (id: string) => setEdits((m) => { const n = { ...m }; delete n[id]; return n; });
  const applyBulk = () => {
    const v = Number(bulk);
    if (!(v > 0 && v <= 100)) return toast.error('Enter a percentage from 0 to 100');
    const targets = lines.filter((l) => l.kind === 'percent' || (!l.base && !l.kind));
    setEdits((m) => { const n = { ...m }; for (const l of targets) n[l.id] = { ...n[l.id], value: String(v), kind: 'percent' }; return n; });
    toast.info(`${v}% applied to ${targets.length} selected percentage rows`, lines.length > targets.length ? 'Fixed-amount rows were left as they are.' : undefined);
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const approval = lines.some((l) => l.needsApproval) && !commissionManager;

  const validate = () => {
    const m: string[] = [];
    if (!f.company_name.trim()) m.push('Agency / company name');
    if (!f.recipient_name.trim()) m.push('Primary contact name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.recipient_email.trim())) m.push('Valid recipient email');
    if (!f.country.trim()) m.push('Country');
    if (!tier) m.push(mode === 'custom' ? 'Base tier' : 'Commission tier');
    if (lines.length === 0) m.push('At least one university');
    const bad = lines.filter((l) => l.problem);
    if (bad.length) m.push(`Fix ${bad.length} row${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 3).map((l) => `${l.university} (${l.problem})`).join(', ')}${bad.length > 3 ? '…' : ''}`);
    if (!terms) m.push('Approved proposal terms (an administrator must publish them)');
    setMissing(m);
    return m.length === 0;
  };
  const submit = async () => {
    setBusy(true);
    const p = mode === 'tier'
      ? { ...f, arrangement: 'tier', tier_id: tier, record_ids: lines.map((l) => l.id), terms_id: terms?.id }
      : { ...f, arrangement: 'custom', base_tier_id: tier, terms_id: terms?.id,
          items: lines.map((l) => ({ record_id: l.id, value: l.value, kind: l.kind, currency: l.currency })) };
    const r = await rpc<{ id: string; status: string }>('create_agency_proposal', { p_prospect: a.id, p_request: req, p });
    if (!r.ok) { setBusy(false); setStep('edit'); return toast.error('Proposal not created', r.error); }
    if (r.data.status === 'pending_approval') {
      setBusy(false);
      toast.info('Waiting for approval', 'Rows above their base rate (or without one) need a commission manager’s approval. You can send it once approved.');
      onDone(); return onClose();
    }
    const s = await sendProposal(r.data.id);
    setBusy(false);
    if (s.ok) toast.success('Proposal sent', s.message); else toast.error('Proposal saved but not sent', s.message);
    onDone(); onClose();
  };

  const footer = step === 'edit'
    ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Eye} disabled={options === null} onClick={() => validate() && setStep('review')}>Review proposal</Button></>
    : <><Button variant="ghost" disabled={busy} onClick={() => setStep('edit')}>Back to editing</Button>
        <Button icon={Send} disabled={busy} onClick={() => void submit()}>{busy ? 'Working…' : approval ? 'Submit for approval' : 'Confirm & send'}</Button></>;

  if (step === 'review') return (
    <Modal open onClose={onClose} size="wide" dirty title="Review proposal" subtitle="Exactly what the agency will see. Internal tiers and base rates are never included." footer={footer}>
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        {[['Agency', f.company_name], ['Contact', f.recipient_name], ['Email', f.recipient_email], ['Country', f.country]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-canvas p-3"><dt className="text-xs text-ink-mute">{k}</dt><dd className="truncate font-medium text-heading">{v}</dd></div>
        ))}
      </dl>
      {approval && <Alert tone="warning" className="mt-3">{lines.filter((l) => l.needsApproval).length} row(s) are above their base rate or have no base rate. The proposal is saved and sent to a commission manager for approval first.</Alert>}
      <h4 className="mt-4 text-sm font-semibold text-heading">Your Partnership Commission Details</h4>
      <div className="mt-2 max-h-[45vh] overflow-auto rounded-2xl border border-line">
        <Table className="hr-table" head={['University', 'Commission', 'Currency', 'Applicable conditions']}>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="min-w-[200px]">{l.university}<div className="text-xs text-ink-mute">{[l.sub, l.country].filter(Boolean).join(' · ')}</div></td>
              <td className="whitespace-nowrap font-semibold tabular-nums text-heading">{fmtCommission(l.kind as ValueKind, l.value, l.currency)}</td>
              <td>{l.kind === 'amount' ? l.currency : '—'}</td>
              <td className="max-w-[280px] text-xs text-ink-soft">{l.conditions ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </div>
      {f.message && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm">{f.message}</p>}
      <p className="mt-3 text-xs text-ink-mute">Subject: “SSI GLOBAL — Partnership Proposal for {f.company_name}”. Terms: {terms?.title}. The agency confirms on a secure page; opening the email does not accept anything.</p>
    </Modal>
  );

  return (
    <Modal open onClose={onClose} size="wide" dirty title="Send Proposal" subtitle={`${agencyName(a)} · emailed as “SSI GLOBAL — Partnership Proposal for ${f.company_name || '…'}”`} footer={footer}>
      {missing.length > 0 && <Alert tone="error" className="mb-4" title="Before reviewing">{missing.join(' · ')}</Alert>}
      {loadErr && <Alert tone="warning" className="mb-4">{loadErr}</Alert>}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Agency / company name" required><Input value={f.company_name} onChange={set('company_name')} maxLength={160} invalid={missing.includes('Agency / company name')} /></Field>
        <Field label="Primary contact" required><Input value={f.recipient_name} onChange={set('recipient_name')} maxLength={120} invalid={missing.includes('Primary contact name')} /></Field>
        <Field label="Recipient email" required><Input type="email" value={f.recipient_email} onChange={set('recipient_email')} maxLength={200} invalid={missing.includes('Valid recipient email')} /></Field>
        <Field label="Country" required><Input value={f.country} onChange={set('country')} maxLength={80} invalid={missing.includes('Country')} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Commission"><Segmented options={[{ value: 'tier', label: 'Standard tier' }, { value: 'custom', label: 'Custom commission' }]} value={mode} onChange={(v) => setMode(v as 'tier' | 'custom')} /></Field>
        <Field label={mode === 'custom' ? 'Base tier (starting values)' : 'Tier'}><Segmented options={tiers.map(([v, l]) => ({ value: v, label: l }))} value={tier} onChange={setTier} /></Field>
        {mode === 'custom' && (
          <div className="flex items-end gap-2">
            <Field label="Apply % to selected rows"><Input type="number" min={0} max={100} step="0.01" value={bulk} onChange={(e) => setBulk(e.target.value)} className="w-24" /></Field>
            <Button size="sm" variant="secondary" disabled={!bulk || !lines.length} onClick={applyBulk}>Apply</Button>
            <Button size="sm" variant="ghost" disabled={!Object.keys(edits).length} onClick={() => setEdits({})}>Reset all to base</Button>
          </div>
        )}
      </div>
      {mode === 'custom' && <p className="mt-2 text-xs text-ink-mute">Each selected row starts at its {tierLabel} rate and can be changed on its own. Rows above their base rate, or without one, need a commission manager's approval. Internal tiers never appear in the proposal.</p>}

      <div className="mt-4 rounded-2xl border border-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search university…" className="w-full sm:w-60" />
          <FilterSelect label="Country" value={uniCountry} onChange={setUniCountry} options={[{ value: '', label: 'All countries' }, ...countries]} />
          <Button size="sm" variant="secondary" onClick={() => setPicked((s) => new Set([...s, ...shown.filter(selectable).map((r) => r.o.record_id)]))}>Select all {shown.filter(selectable).length} shown</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          {mode === 'custom' && <Checkbox checked={onlyChanged} onCheckedChange={setOnlyChanged} label="Customised only" />}
          <span className="ml-auto text-sm text-ink-soft"><b className="text-heading">{picked.size}</b> selected{mode === 'custom' ? ` · ${lines.filter((l) => l.customized).length} customised` : ''}</span>
        </div>
        <div className="max-h-[42vh] overflow-auto">
          {options === null ? <p className="p-4 text-sm text-ink-soft">Loading commission options…</p> : shown.length === 0 ? <p className="p-4 text-sm text-ink-soft">No commission records match.</p> : (
            <Table className="hr-table" head={mode === 'tier' ? ['', 'University', 'Country', `${tierLabel} commission`, 'Conditions']
              : ['', 'University', 'Country', `Base (${tierLabel})`, 'Proposed', 'Type', 'Currency', 'Conditions', '', '']}>
              {shown.map((r) => {
                const id = r.o.record_id;
                const base = r.rates[tier];
                const ok = selectable(r);
                const on = picked.has(id) && ok;
                const l = on ? lineOf(id) : null;
                return (
                  <tr key={id} className={cn(!ok && 'opacity-50', l?.customized && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                    <td><Checkbox checked={on} disabled={!ok} onCheckedChange={() => toggle(id)} label={<span className="sr-only">Select {r.o.university}</span>} /></td>
                    <td className="min-w-[190px]">{r.o.university}<div className="text-xs text-ink-mute">{[r.o.study_level, r.o.variant, r.o.intake].filter(Boolean).join(' · ')}</div></td>
                    <td>{r.o.country}</td>
                    {mode === 'tier' ? (
                      <>
                        <td className="whitespace-nowrap font-semibold tabular-nums">{base ? fmtCommission(base.commission_kind, String(base.commission_value), base.currency) : <span className="font-normal text-ink-mute">No valid rate</span>}</td>
                        <td className="max-w-[240px] text-xs text-ink-soft">{base?.conditions ?? '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className="whitespace-nowrap tabular-nums text-ink-soft">{base ? fmtCommission(base.commission_kind, String(base.commission_value), base.currency) : <span className="text-amber-700 dark:text-amber-300">No base rate</span>}</td>
                        <td>{on ? <Input aria-label={`Proposed commission for ${r.o.university}`} type="number" min={0} step="0.01" value={l?.value ?? ''} invalid={!!l?.problem && l.problem !== 'Enter the currency' && l.problem !== 'Choose percent or amount'}
                          onChange={(e) => setEdit(id, { value: e.target.value })} className="w-24" /> : <span className="text-ink-mute">—</span>}</td>
                        <td className="whitespace-nowrap text-xs">{base ? (base.commission_kind === 'percent' ? '%' : 'Amount')
                          : on ? <Select value={edits[id]?.kind ?? ''} onChange={(e) => setEdit(id, { kind: e.target.value as 'percent' | 'amount' })}><option value="">Type…</option><option value="percent">%</option><option value="amount">Amount</option></Select> : '—'}</td>
                        <td className="text-xs">{base ? (base.currency ?? '—') : on && edits[id]?.kind === 'amount'
                          ? <Input aria-label="Currency" maxLength={3} value={edits[id]?.currency ?? ''} onChange={(e) => setEdit(id, { currency: e.target.value.toUpperCase() })} className="w-16" /> : '—'}</td>
                        <td className="max-w-[200px] text-xs text-ink-soft">{base?.conditions ?? r.o.conditions ?? '—'}</td>
                        <td className="whitespace-nowrap text-xs">{l?.problem ? <span className="text-red-600 dark:text-red-400">{l.problem}</span>
                          : l?.needsApproval ? <Badge tone="amber">Needs approval</Badge> : l?.customized ? <Badge tone="orange">Modified</Badge> : null}</td>
                        <td>{on && edits[id] && base && <Button size="sm" variant="ghost" onClick={() => reset(id)}>Reset</Button>}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
      </div>

      <Field label="Personal message (optional)" className="mt-4"><Textarea rows={2} value={f.message} onChange={set('message')} maxLength={2000} /></Field>
      <div className="mt-4 rounded-2xl bg-canvas p-4 text-sm">
        {terms === undefined ? 'Loading terms…' : terms ? (<><b className="text-heading">{terms.title}</b><p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-ink-soft">{terms.body}</p></>)
          : <span className="text-red-600 dark:text-red-400">No approved proposal terms are published. Ask an administrator to publish them in Agencies → Proposal terms & settings.</span>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ reconciliation (administrators)
function Reconcile({ a, manager, onSaved }: { a: Agency; manager: boolean; onSaved: () => void }) {
  const toast = useToast();
  const { db } = useStore();
  const [partner, setPartner] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (link: boolean) => {
    setBusy(true);
    const r = await rpc('reconcile_agency', { p_id: a.id, p_partner: link ? partner : null, p_note: note || null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(link ? 'Linked to the partner' : 'Kept as historically onboarded'); onSaved();
  };
  return (
    <Alert tone="warning" title="Needs reconciliation" className="mx-5 mb-5">
      <p className="text-xs">{(a.reconciliation_note ?? 'Marked onboarded in the spreadsheet, but no partner account is linked').replace(/\.?$/, '.')} It is not treated as an active partner until an administrator checks it.</p>
      {manager ? (
        <div className="mt-3 grid gap-2">
          <Select value={partner} onChange={(e) => setPartner(e.target.value)} searchable>
            <option value="">Choose the partner in Clients & Branches…</option>
            {db.partners.filter((p) => !p.archivedAt).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !partner} onClick={() => void save(true)}>Link to partner</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(false)}>Keep as historical</Button>
          </div>
        </div>
      ) : <p className="mt-2 text-xs">An administrator will review it.</p>}
    </Alert>
  );
}
