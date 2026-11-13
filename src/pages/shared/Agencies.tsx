// Agencies (Partnership Officer workspace): agency prospects being approached for a partnership.
// A prospect is not a partner: it has no login and no portal. It becomes linked to a partner in
// Clients & Branches only after SSI GLOBAL approves its registration and creates the account.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, FileSignature, Plus, Settings2 } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Segmented, Switch, Table, Textarea, usePaged } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { matches } from '../../lib/utils';
import {
  CONTACT, FILTERS, PROPOSAL, STAGE, agencyAccess, agencyManager, agencyName, fmtDate, latestProposal, matchesFilter, rpc, useAgencyData,
  type AgencyFilter, type ContactStatus, type Terms,
} from '../../lib/agencies';
import { supabase } from '../../auth/auth';

export default function Agencies() {
  const { session, db } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const allowed = agencyAccess(session);
  const manager = agencyManager(session);
  const { data, error } = useAgencyData(allowed);
  const [q, setQ] = useState('');
  const [officer, setOfficer] = useState('');
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [settings, setSettings] = useState(false);
  const filter = (params.get('f') as AgencyFilter) || 'all';
  const setFilter = (f: string) => setParams((p) => { const n = new URLSearchParams(p); if (f && f !== 'all') n.set('f', f); else n.delete('f'); n.delete('add'); return n; }, { replace: true });
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Officer') : '—');
  const regOf = (id: string | null) => (id ? data?.registrations.find((r) => r.id === id) : undefined);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.agencies.filter((a) => matchesFilter(a, filter, data) && (!officer || a.assigned_officer === officer)
      && matches(q, a.company_name ?? '', a.contact_name ?? '', a.phone ?? '', a.email ?? '', a.country ?? '', a.reference));
  }, [data, filter, officer, q]);
  const paged = usePaged(rows, 15, `${filter}|${q}|${officer}`);
  const officers = useMemo(() => [...new Set((data?.agencies ?? []).map((a) => a.assigned_officer).filter(Boolean) as string[])], [data]);

  if (!allowed) return <Card><EmptyState icon={Building2} title="Agencies are not available" description="Ask an administrator for the Agencies & proposals permission." /></Card>;
  return (
    <>
      <PageHeader title="Agencies" subtitle="Agencies you are approaching for a partnership — from first contact to onboarding."
        actions={<>
          {manager && <Button variant="secondary" icon={Settings2} onClick={() => setSettings(true)}>Proposal terms & settings</Button>}
          <Button icon={Plus} onClick={() => setAdding(true)}>Add Agency</Button>
        </>} />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, contact, phone, email…" className="w-full sm:w-72" />
          <FilterSelect label="Status" value={filter} onChange={setFilter} options={FILTERS} />
          {manager && officers.length > 1 && <FilterSelect label="Officer" value={officer} onChange={setOfficer} options={[{ value: '', label: 'All officers' }, ...officers.map((o) => ({ value: o, label: staffName(o) }))]} />}
          <span className="ml-auto text-xs text-ink-mute">{data ? `${rows.length} of ${data.agencies.length}` : ''}</span>
        </div>
        {!data ? <div className="p-6 text-sm text-ink-soft" role="status">Loading agencies…</div> : rows.length === 0 ? (
          <EmptyState icon={Building2} title={data.agencies.length ? 'No agencies match' : 'No agencies yet'}
            description={data.agencies.length ? undefined : 'Add an agency as soon as you have a name or a phone number — the rest can come later.'}
            action={!data.agencies.length ? <Button icon={Plus} onClick={() => setAdding(true)}>Add Agency</Button> : undefined} />
        ) : (
          <>
            <Table className="hr-table" head={['Agency', 'Contact', 'Status', 'Stage', 'Officer', 'Last contact', 'Next follow-up', 'Proposal', 'Registration', '']}>
              {paged.rows.map((a) => {
                const p = latestProposal(data.proposals, a.id);
                const reg = regOf(a.registration_id);
                const overdue = a.next_follow_up && a.next_follow_up < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={a.id} className="cursor-pointer" onClick={() => navigate(a.id)}>
                    <td className="min-w-[180px]"><div className="font-medium text-heading">{agencyName(a)}</div><div className="text-xs text-ink-mute">{a.reference}{a.country ? ` · ${a.country}` : ''}</div></td>
                    <td className="min-w-[160px] text-sm">{a.contact_name ?? '—'}<div className="text-xs text-ink-mute">{[a.phone, a.email].filter(Boolean).join(' · ') || '—'}</div></td>
                    <td><Badge tone={CONTACT[a.contact_status].tone} dot>{CONTACT[a.contact_status].label}</Badge></td>
                    <td><Badge tone={STAGE[a.stage].tone}>{STAGE[a.stage].label}</Badge></td>
                    <td className="text-sm">{staffName(a.assigned_officer)}</td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(a.last_contact_at)}</td>
                    <td className={`whitespace-nowrap text-sm ${overdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtDate(a.next_follow_up)}</td>
                    <td>{p ? <Badge tone={PROPOSAL[p.status].tone}>{PROPOSAL[p.status].label}</Badge> : <span className="text-xs text-ink-mute">—</span>}</td>
                    <td className="text-sm">{reg ? reg.reference : a.registration_id ? 'Issued' : '—'}</td>
                    <td><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(a.id); }}>Open</Button></td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="agencies" />
          </>
        )}
      </Card>
      <AddAgencyModal open={adding} onClose={() => { setAdding(false); if (params.get('add')) setFilter(filter); }} onCreated={(id) => navigate(id)} />
      {manager && <SettingsModal open={settings} onClose={() => setSettings(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ Add Agency
export function AddAgencyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const toast = useToast();
  const empty = { company_name: '', contact_name: '', phone: '', email: '', country: '', notes: '' };
  const [f, setF] = useState(empty);
  const [status, setStatus] = useState<ContactStatus>('not_connected');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req, setReq] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const identifiable = !!(f.company_name.trim() || f.contact_name.trim() || f.phone.trim());
  const emailBad = !!f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const dirty = Object.values(f).some((v) => v.trim());
  const close = () => { setF(empty); setStatus('not_connected'); setErr(''); setReq(crypto.randomUUID()); onClose(); };
  const save = async () => {
    if (!identifiable) return setErr('Enter at least the agency name, the contact person or a phone number.');
    if (emailBad) return setErr('Enter a valid email address, or leave it empty.');
    setBusy(true); setErr('');
    const r = await rpc<{ id: string; reference: string }>('create_agency_prospect', { p: { ...f, contact_status: status }, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(`Agency added · ${r.data.reference}`);
    close();
    onCreated?.(r.data.id);
  };
  return (
    <Modal open={open} onClose={close} dirty={dirty} title="Add Agency" subtitle="Save what you know now — a name, a contact or just a phone number. No login is created."
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Add Agency'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Agency / company name"><Input value={f.company_name} onChange={set('company_name')} maxLength={160} autoFocus /></Field>
        <Field label="Contact person"><Input value={f.contact_name} onChange={set('contact_name')} maxLength={120} /></Field>
        <Field label="Phone number"><Input value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" /></Field>
        <Field label="Email address" error={emailBad ? 'Enter a valid email, or leave it empty' : undefined}><Input type="email" value={f.email} onChange={set('email')} maxLength={200} invalid={emailBad} /></Field>
        <Field label="Country"><Input value={f.country} onChange={set('country')} maxLength={80} /></Field>
        <Field label="Initial contact status">
          <Segmented options={[{ value: 'not_connected', label: 'Not connected' }, { value: 'connected', label: 'Connected' }]} value={status} onChange={(v) => setStatus(v as ContactStatus)} />
        </Field>
        <Field label="Internal notes" className="sm:col-span-2" hint="Only SSI GLOBAL sees these."><Textarea rows={3} value={f.notes} onChange={set('notes')} maxLength={4000} /></Field>
      </div>
      {!identifiable && <p className="mt-3 text-xs text-ink-mute">At least one of agency name, contact person or phone number is needed so the agency can be found later.</p>}
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

// ------------------------------------------------------------------ terms & settings (administrators)
function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [terms, setTerms] = useState<Terms | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [auto, setAuto] = useState(true);
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!supabase) return;
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from('proposal_terms').select('*').eq('active', true).maybeSingle(),
      supabase.from('partnership_settings').select('auto_registration_link, proposal_valid_days').maybeSingle(),
    ]);
    setTerms((t as Terms | null) ?? null); setTitle((t as Terms | null)?.title ?? ''); setBody((t as Terms | null)?.body ?? '');
    if (s) { setAuto(!!s.auto_registration_link); setDays(String(s.proposal_valid_days)); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && terms === undefined) void load(); }, [open, terms]);
  const save = async () => {
    setBusy(true);
    if (title.trim() !== (terms?.title ?? '') || body.trim() !== (terms?.body ?? '')) {
      const r = await rpc('publish_proposal_terms', { p_title: title, p_body: body });
      if (!r.ok) { setBusy(false); return toast.error(r.error); }
    }
    const s = await rpc('update_partnership_settings', { p_auto: auto, p_days: Number(days) || 30 });
    setBusy(false);
    if (!s.ok) return toast.error(s.error);
    toast.success('Saved');
    setTerms(undefined); onClose();
  };
  return (
    <Modal open={open} onClose={() => { setTerms(undefined); onClose(); }} size="lg" title="Proposal terms & settings" subtitle="Only administrators can change these. Proposals copy the terms at the moment they are sent."
      footer={<><Button variant="ghost" onClick={() => { setTerms(undefined); onClose(); }}>Cancel</Button><Button icon={FileSignature} disabled={busy || title.trim().length < 2 || body.trim().length < 20} onClick={() => void save()}>Save</Button></>}>
      {terms === null && <Alert tone="warning" className="mb-3">No proposal terms are published yet. Officers cannot send proposals until you publish them.</Alert>}
      <Field label="Terms title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. SSI GLOBAL Partner Terms" /></Field>
      <Field label="Approved partnership terms" required hint="Shown in every proposal email and on the confirmation page. Publishing replaces the current version; sent proposals keep theirs." className="mt-3">
        <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
      </Field>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="After an agency confirms"><span className="flex items-center gap-2 text-sm"><Switch checked={auto} onCheckedChange={setAuto} label="Email the registration form automatically" />{auto ? 'Email the registration form automatically' : 'An administrator issues the registration link'}</span></Field>
        <Field label="Proposal valid for (days)"><Input type="number" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
