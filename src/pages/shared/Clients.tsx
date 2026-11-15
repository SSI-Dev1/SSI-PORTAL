// Partner Success workspace (0047). Agency List: every onboarded client, read-only. My Clients:
// clients where I am the Sub Officer (decided by the server), with applications attributed to me.
// Client details: contact details and Log Activity only for my own clients.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Award, Briefcase, Building2, CalendarClock, ClipboardList, FileStack, Hourglass, NotebookPen, Plus, Send, Users } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, FilterSelect, Modal, PageHeader, Pagination, SearchInput, Segmented, Select, Table, Textarea, usePaged } from '../../components/ui';
import { KPI } from '../../components/hr';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { greeting, matches } from '../../lib/utils';
import { AGENCY_TYPE, fmtDate, fmtWhen, rpc, today, typeKey } from '../../lib/agencies';
import {
  CLIENT_ACTIVITY, OUTCOME, useClientActivities, useClientDirectory, useMyClients, usePortfolio, type ClientActivityKind, type DirectoryClient,
} from '../../lib/clients';

const STATUS = { verified: { label: 'Onboarded', tone: 'green' as const }, historical: { label: 'Onboarded (historical)', tone: 'slate' as const } };
const enc = (k: string) => encodeURIComponent(k);

// ------------------------------------------------------------------ Agency List (all onboarded clients)
export function ClientDirectory() {
  const { data, error } = useClientDirectory();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [type, setType] = useState('');
  const [sub, setSub] = useState('');
  const rows = useMemo(() => (data ?? []).filter((c) => (!country || c.country === country) && (!type || typeKey(c.agency_type) === type)
    && (!sub || (sub === 'mine' ? c.mine : sub === 'none' ? !c.sub_officer_id : c.sub_officer_id === sub)) && matches(q, c.name, c.city ?? '', c.main_officer ?? '', c.sub_officer ?? '')), [data, q, country, type, sub]);
  const paged = usePaged(rows, 20, `${q}|${country}|${type}|${sub}`);
  const countries = useMemo(() => [...new Set((data ?? []).map((c) => c.country).filter(Boolean) as string[])].sort(), [data]);
  const subs = useMemo(() => [...new Map((data ?? []).filter((c) => c.sub_officer_id).map((c) => [c.sub_officer_id!, c.sub_officer ?? 'Officer'])).entries()], [data]);
  return (
    <>
      <PageHeader title="Agency List" subtitle="Every onboarded client. Your own clients are under My Clients — others are read-only." />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search agency, city, officer…" className="w-full sm:w-72" />
          <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries]} />
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: '', label: 'Domestic & international' }, { value: 'domestic', label: 'Domestic' }, { value: 'international', label: 'International' }, { value: 'unclassified', label: 'Not classified' }]} />
          <FilterSelect label="Sub Officer" value={sub} onChange={setSub} options={[{ value: '', label: 'All Sub Officers' }, { value: 'mine', label: 'Mine' }, { value: 'none', label: 'Unassigned' }, ...subs.map(([v, l]) => ({ value: v, label: l }))]} />
          <span className="ml-auto text-xs text-ink-mute">{data ? `${rows.length} of ${data.length}` : ''}</span>
        </div>
        {!data ? <p className="p-6 text-sm text-ink-soft" role="status">Loading clients…</p> : rows.length === 0 ? <EmptyState icon={Building2} title={data.length ? 'Nothing matches' : 'No onboarded clients yet'} /> : (
          <>
            <Table className="hr-table" head={['Agency', 'Country', 'Type', 'Main Officer', 'Sub Officer', 'Status', '']}>
              {paged.rows.map((c) => (
                <tr key={c.key} className="cursor-pointer" onClick={() => navigate(enc(c.key))}>
                  <td className="min-w-[180px] font-medium text-heading">{c.name}{c.mine && <Badge tone="orange" className="ml-2">My client</Badge>}<div className="text-xs font-normal text-ink-mute">{c.city ?? ''}</div></td>
                  <td>{c.country ?? '—'}</td>
                  <td><Badge tone={AGENCY_TYPE[typeKey(c.agency_type)].tone}>{AGENCY_TYPE[typeKey(c.agency_type)].label}</Badge></td>
                  <td className="text-sm">{c.main_officer ?? <span className="text-ink-mute">Unassigned</span>}</td>
                  <td className="text-sm">{c.sub_officer ?? <span className="text-ink-mute">Unassigned</span>}</td>
                  <td><Badge tone={STATUS[c.business_status].tone}>{STATUS[c.business_status].label}</Badge></td>
                  <td><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(enc(c.key)); }}>View</Button></td>
                </tr>
              ))}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="clients" />
          </>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ My Clients
export function MyClientsPage() {
  const { data, error, reload } = useMyClients();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [log, setLog] = useState<{ key: string; name: string } | null>(null);
  const rows = (data ?? []).filter((c) => matches(q, c.name, c.city ?? '', c.contact_name ?? ''));
  return (
    <>
      <PageHeader title="My Clients" subtitle="Clients where you are the Sub Officer. Applications are counted from when they were created through your clients." />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search my clients…" className="w-full sm:w-72" />
          <span className="ml-auto text-xs text-ink-mute">{data ? `${data.length} client${data.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {!data ? <p className="p-6 text-sm text-ink-soft" role="status">Loading…</p> : rows.length === 0 ? (
          <EmptyState icon={Users} title={data.length ? 'Nothing matches' : 'No clients assigned to you yet'} description={data.length ? undefined : 'Your Main Officer or an administrator assigns clients to you as Sub Officer.'} />
        ) : (
          <Table className="hr-table" head={['Client', 'Contact', 'Applications', 'Pending', 'Offers', 'Last activity', 'Next follow-up', '']}>
            {rows.map((c) => (
              <tr key={c.key} className="cursor-pointer" onClick={() => navigate(`../${enc(c.key)}`, { relative: 'path' })}>
                <td className="min-w-[180px] font-medium text-heading">{c.name}<div className="text-xs font-normal text-ink-mute">{[c.city, c.country].filter(Boolean).join(', ')} · Main Officer {c.main_officer ?? '—'}</div></td>
                <td className="text-sm">{c.contact_name ?? '—'}<div className="text-xs text-ink-mute">{[c.phone, c.email].filter(Boolean).join(' · ')}</div></td>
                <td className="tabular-nums font-semibold text-heading">{c.applications}</td>
                <td className="tabular-nums">{c.pending}</td>
                <td className="tabular-nums">{c.offers}</td>
                <td className="whitespace-nowrap text-sm">{fmtDate(c.last_activity)}</td>
                <td className={`whitespace-nowrap text-sm ${c.next_follow_up && c.next_follow_up <= today() ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>{fmtDate(c.next_follow_up)}</td>
                <td><Button size="sm" variant="secondary" icon={NotebookPen} onClick={(e) => { e.stopPropagation(); setLog({ key: c.key, name: c.name }); }}>Log activity</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {log && <LogClientActivity clientKey={log.key} name={log.name} onClose={() => setLog(null)} onSaved={reload} />}
    </>
  );
}

// ------------------------------------------------------------------ client details
export function ClientDetail() {
  const { key: raw = '' } = useParams();
  const key = decodeURIComponent(raw);
  const dir = useClientDirectory();
  const mine = useMyClients();
  const acts = useClientActivities(key);
  const { db, session } = useStore();
  const [log, setLog] = useState(false);
  const c = dir.data?.find((x) => x.key === key);
  const m = mine.data?.find((x) => x.key === key);
  const name = (id: string) => db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee');
  if (!dir.data) return <p className="p-6 text-sm text-ink-soft" role="status">Loading…</p>;
  if (!c) return <Card><EmptyState icon={Building2} title="Client not found" /></Card>;
  return (
    <>
      <Link to=".." relative="path" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-heading"><ArrowLeft className="h-4 w-4" />Back</Link>
      <PageHeader title={c.name} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS[c.business_status].tone}>{STATUS[c.business_status].label}</Badge>{c.mine ? <Badge tone="orange">My client</Badge> : <Badge tone="slate">Read-only</Badge>}</span>}
        actions={c.mine ? <Button icon={NotebookPen} onClick={() => setLog(true)}>Log activity</Button> : undefined} />
      {!c.mine && <Alert tone="info" className="mb-4">This client is not assigned to you. You can see its basic details; contact details, applications and activity logging are for its Sub Officer.</Alert>}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Client details" />
          <dl className="grid gap-3 px-5 pb-5 text-sm">
            {([['Country', c.country], ['City', c.city], ['Type', AGENCY_TYPE[typeKey(c.agency_type)].label], ['Onboarded', fmtDate(c.onboarded_on)], ['Main Officer', c.main_officer ?? 'Unassigned'],
               ['Sub Officer', c.sub_officer ?? 'Unassigned'], ...(c.mine ? [['Contact', c.contact_name], ['Phone', c.phone], ['Email', c.email]] : [])] as [string, string | null][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-ink-mute">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-heading">{v || '—'}</dd></div>
            ))}
          </dl>
        </Card>
        <div className="grid min-w-0 gap-4 lg:col-span-2 [&>*]:min-w-0">
          {c.mine && m && (
            <div className="grid gap-3 sm:grid-cols-4">
              <KPI label="Applications" value={m.applications} icon={FileStack} tone="navy" />
              <KPI label="Pending" value={m.pending} icon={Hourglass} tone="amber" />
              <KPI label="Submitted" value={m.submitted} icon={Send} tone="orange" />
              <KPI label="Offers" value={m.offers} icon={Award} tone="green" />
            </div>
          )}
          {c.mine && (
            <Card>
              <CardHeader title="Activity history" subtitle="Relationship work logged on this client." />
              <ActivityList rows={acts.data} name={name} />
            </Card>
          )}
        </div>
      </div>
      {log && <LogClientActivity clientKey={c.key} name={c.name} onClose={() => setLog(false)} onSaved={() => { void acts.reload(); void mine.reload(); }} />}
    </>
  );
}

function ActivityList({ rows, name, clients }: { rows: ReturnType<typeof useClientActivities>['data']; name: (id: string) => string; clients?: Map<string, string> }) {
  if (!rows) return <p className="px-5 pb-5 text-sm text-ink-soft">Loading…</p>;
  if (!rows.length) return <p className="px-5 pb-5 text-sm text-ink-soft">No activities yet.</p>;
  return (
    <ol className="px-5 pb-5">
      {rows.map((h) => (
        <li key={h.id} className="border-l-2 border-line py-2 pl-4">
          <div className="text-sm font-medium text-heading">{CLIENT_ACTIVITY[h.kind].label}{clients ? ` · ${clients.get(h.client_key) ?? ''}` : ''}{h.outcome && <Badge tone="slate" className="ml-2">{OUTCOME[h.outcome]}</Badge>}</div>
          {h.note && <div className="whitespace-pre-wrap text-sm text-ink-soft">{h.note}</div>}
          <div className="text-xs text-ink-mute">{fmtWhen(h.at)} · {name(h.employee_id)}{h.next_follow_up ? ` · follow-up ${fmtDate(h.next_follow_up)}` : ''}</div>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ log activity (own clients; the server checks)
export function LogClientActivity({ clientKey, name, onClose, onSaved }: { clientKey: string; name: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<ClientActivityKind>('query');
  const [outcome, setOutcome] = useState<string>('completed');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [req] = useState(() => crypto.randomUUID());
  const save = async () => {
    if (kind === 'note' && !note.trim()) return toast.error('Write the note');
    setBusy(true);
    const r = await rpc('log_client_activity', { p_key: clientKey, p_kind: kind, p_outcome: kind === 'note' ? null : outcome || null, p_note: note || null, p_next: next || null, p_request: req });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(`${CLIENT_ACTIVITY[kind].label} — saved`); onSaved(); onClose();
  };
  return (
    <Modal open onClose={onClose} title="Log activity" subtitle={name} dirty={!!note.trim()} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Activity"><Select value={kind} onChange={(e) => setKind(e.target.value as ClientActivityKind)}>{(Object.keys(CLIENT_ACTIVITY) as ClientActivityKind[]).map((k) => <option key={k} value={k}>{CLIENT_ACTIVITY[k].label}</option>)}</Select></Field>
        {kind !== 'note' && <Field label="Outcome"><Segmented options={Object.entries(OUTCOME).map(([v, l]) => ({ value: v, label: l }))} value={outcome} onChange={setOutcome} /></Field>}
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus /></Field>
        <Field label="Next follow-up (optional)"><DatePicker value={next} onChange={setNext} min={today()} /></Field>
      </div>
      {CLIENT_ACTIVITY[kind].report && <p className="mt-3 text-xs text-ink-mute">Counts in your Daily Work Report ({CLIENT_ACTIVITY[kind].report}).</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ Activity Log (my own entries)
export function ClientActivityLog() {
  const { session } = useStore();
  const acts = useClientActivities();
  const dir = useClientDirectory();
  const names = useMemo(() => new Map((dir.data ?? []).map((c: DirectoryClient) => [c.key, c.name])), [dir.data]);
  const mineOnly = (acts.data ?? []).filter((a) => a.employee_id === session?.userId);
  const paged = usePaged(mineOnly, 30);
  return (
    <>
      <PageHeader title="Activity Log" subtitle="Relationship work you logged on your clients. Application counts are separate — see My Clients." />
      {acts.error && <Alert tone="warning" className="mb-4">{acts.error}</Alert>}
      <Card>
        {!acts.data ? <p className="p-6 text-sm text-ink-soft">Loading…</p> : mineOnly.length === 0 ? <EmptyState icon={ClipboardList} title="Nothing logged yet" description="Open a client in My Clients and choose Log activity." /> : (
          <>
            <div className="pt-4"><ActivityList rows={paged.rows} name={() => session?.name ?? 'You'} clients={names} /></div>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={mineOnly.length} label="activities" />
          </>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ dashboard
export function PartnerSuccessDashboard() {
  const { session } = useStore();
  const navigate = useNavigate();
  const p = usePortfolio();
  const mine = useMyClients();
  const n = (o: Record<string, unknown> | undefined, k: string) => (o ? Number(o[k] ?? 0) : '…');
  const followUps = (mine.data ?? []).filter((c) => c.next_follow_up).sort((a, b) => (a.next_follow_up ?? '').localeCompare(b.next_follow_up ?? '')).slice(0, 6);
  const team = p.data?.team;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">{greeting()}, {session?.name?.split(' ')[0]}</p>
          <h1 className="font-display text-2xl font-semibold text-heading">My clients</h1>
          <p className="text-sm text-ink-soft">Applications and offers through the clients assigned to you as Sub Officer.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Building2} onClick={() => navigate('../clients', { relative: 'path' })}>Agency List</Button>
          <Button icon={Users} onClick={() => navigate('../clients/mine', { relative: 'path' })}>My Clients</Button>
        </div>
      </div>
      {p.error && <Alert tone="warning" className="mb-4">{p.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPI label="My assigned clients" value={mine.data ? mine.data.length : '…'} icon={Briefcase} tone="navy" onClick={() => navigate('../clients/mine', { relative: 'path' })} />
        <KPI label="Applications through my clients" value={n(p.data?.mine, 'applications')} hint="All time, as attributed when created" icon={FileStack} tone="orange" />
        <KPI label="Pending" value={n(p.data?.mine, 'pending')} hint="Draft, assessment or submitted" icon={Hourglass} tone="amber" />
        <KPI label="Offers received" value={n(p.data?.mine, 'offers')} hint="Conditional, unconditional or visa stage" icon={Award} tone="green" />
        <KPI label="Today: applications" value={p.data ? p.data.today?.applications ?? 0 : '…'} hint="Created today through my clients" icon={Plus} tone="orange" />
        <KPI label="Today: offers" value={p.data ? p.data.today?.offers ?? 0 : '…'} hint="First offer today" icon={Award} tone="green" />
      </div>
      {team && Number(team.agencies ?? 0) > 0 && (
        <Card className="mt-6">
          <CardHeader title="My team (as Main Officer)" subtitle={`${n(team, 'applications')} applications in total — each counted once`} />
          <Table className="hr-table" head={['Sub Officer', 'Clients', 'Applications', 'Offers']}>
            {(team.by_sub ?? []).map((r) => <tr key={r.name}><td>{r.name}</td><td className="tabular-nums">{r.agencies}</td><td className="tabular-nums">{r.applications}</td><td className="tabular-nums">{r.offers}</td></tr>)}
          </Table>
        </Card>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming follow-ups" />
          {followUps.length === 0 ? <p className="px-5 pb-5 text-sm text-ink-soft">None scheduled.</p> : (
            <ul className="px-2 pb-3">{followUps.map((c) => (
              <li key={c.key}><button type="button" onClick={() => navigate(`../clients/${enc(c.key)}`, { relative: 'path' })} className="flex w-full justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-canvas">
                <span className="font-medium text-heading">{c.name}</span><span className="flex items-center gap-1 text-ink-soft"><CalendarClock className="h-4 w-4" />{fmtDate(c.next_follow_up)}</span></button></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Applications by client" />
          {!mine.data?.length ? <p className="px-5 pb-5 text-sm text-ink-soft">No clients yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead><tr className="border-y border-line bg-canvas/70 text-[11.5px] uppercase tracking-wider text-ink-mute"><th className="px-5 py-2">Client</th><th className="px-3 py-2 text-right">Applications</th><th className="px-5 py-2 text-right">Offers</th></tr></thead>
              <tbody>{[...mine.data].sort((a, b) => b.applications - a.applications).slice(0, 8).map((c) => (
                <tr key={c.key} className="border-b border-line last:border-0"><td className="px-5 py-2">{c.name}</td><td className="px-3 py-2 text-right tabular-nums">{c.applications}</td><td className="px-5 py-2 text-right tabular-nums">{c.offers}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
