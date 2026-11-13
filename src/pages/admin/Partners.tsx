import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Eye, Globe, Globe2, History, KeyRound, Link2, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, SearchInput, Segmented, Select, Table, Tabs } from '../../components/ui';
import { LogoMark } from '../../components/brand';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { useAuth } from '../../auth/AuthProvider';
import { canManageRegistrations } from '../../auth/roles';
import { TYPE_FILTERS, agencyAccess, matchesType, partnershipFocused, rpc, type AgencyType, type AgencyTypeFilter } from '../../lib/agencies';
import { AgencyTypeBadge, BUSINESS, LinkPartnerModal, PORTAL, useOfficerCandidates, useOnboardedDirectory, usePartnerStatus, type BusinessStatus, type OnboardedAgency, type PortalStatus } from '../shared/AgencyBulk';
import { PartnerUserDialog } from './UserManagement';
import { CredentialsOnce, PartnerDialog, createdAccount, type CreatedAccount } from './UserManagement';
import type { Partner, PartnerStatus, PartnerTier } from '../../data/types';
import { avatarColor, countryFlag, initials, matches, type Tone } from '../../lib/utils';

export const partnerStatusTone: Record<PartnerStatus, Tone> = { Active: 'green', Onboarding: 'amber', Inactive: 'slate' };
export const tierTone: Record<PartnerTier, Tone> = { Platinum: 'navy', Gold: 'orange', Silver: 'slate' };

type DirTab = 'onboarded' | 'mine' | 'active' | 'not_activated' | 'review' | 'suspended' | 'provisioning' | 'all';
const TABS: DirTab[] = ['onboarded', 'mine', 'active', 'not_activated', 'review', 'suspended', 'provisioning', 'all'];
/** Fallback before migration 0042 (server status unavailable). */
export const accountState = (p: Partner): { key: 'active' | 'provisioning' | 'suspended'; label: string; tone: Tone } =>
  p.status === 'Active' && p.portalEnabled !== false ? { key: 'active', label: 'Active · portal on', tone: 'green' }
    : p.status === 'Onboarding' ? { key: 'provisioning', label: 'Provisioning · portal off', tone: 'amber' }
      : { key: 'suspended', label: p.status === 'Inactive' ? 'Suspended' : 'Portal off', tone: 'red' };

export default function Partners() {
  const { db, actions, session } = useStore();
  // Partnership Officers: Clients & Branches is the directory of active, onboarded partners only.
  const activeOnly = partnershipFocused(session);
  const { realSession } = useAuth();
  const superAdmin = realSession?.userRole === 'super_admin';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [accountOpen, setAccountOpen] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  // Partners are created only here, by a Super Admin, together with their login account.
  const openAdd = () => {
    setEditing(undefined);
    if (superAdmin) setAccountOpen(true);
  };
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [tab, setTabState] = useState<DirTab>(() => (TABS as string[]).includes(params.get('tab') ?? '') ? params.get('tab') as DirTab : 'onboarded');
  const setTab = (t: DirTab) => { setTabState(t); setParams((x) => { const n = new URLSearchParams(x); n.set('tab', t); return n; }, { replace: true }); };
  useEffect(() => { const t = params.get('tab'); if (t && (TABS as string[]).includes(t)) setTabState(t as DirTab); }, [params]);
  const statusMap = usePartnerStatus(true);
  const [activating, setActivating] = useState<Partner | null>(null);
  const [country, setCountry] = useState('');
  const [officerF, setOfficerF] = useState('');
  // Agency Type (0043): ?t=domestic | international | unclassified, the same rule as the Agency List and dashboard.
  const typeF = (['domestic', 'international', 'unclassified'].includes(params.get('t') ?? '') ? params.get('t') : '') as AgencyTypeFilter;
  const setTypeF = (t: string) => setParams((x) => { const n = new URLSearchParams(x); if (t) n.set('t', t); else n.delete('t'); return n; }, { replace: true });
  const [classifying, setClassifying] = useState<Partner | null>(null);
  const canClassify = superAdmin || agencyAccess(session);
  const [linking, setLinking] = useState<OnboardedAgency | null>(null);
  const canVerify = canManageRegistrations(realSession);
  const { rows: onboarded } = useOnboardedDirectory(true);
  const candidates = useOfficerCandidates(true);
  const officerName = (id: string | null | undefined) => (id ? candidates.find((c) => c.id === id)?.full_name ?? db.staff.find((x) => x.id === id)?.fullName ?? '—' : '—');
  const agencyOf = useMemo(() => new Map((onboarded ?? []).filter((a) => a.partner_id).map((a) => [a.partner_id as string, a])), [onboarded]);
  const pending = useMemo(() => (onboarded ?? []).filter((a) => a.verification === 'pending')
    .filter((a) => matches(q, a.company_name ?? '', a.contact_name ?? '', a.email ?? '', a.phone ?? '', a.reference))
    .filter((a) => !country || (a.country ?? '') === country)
    .filter((a) => !officerF || a.assigned_officer === officerF)
    .filter((a) => matchesType(a.agency_type, typeF)), [onboarded, q, country, officerF, typeF]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Partner>();

  useEffect(() => {
    if (params.get('new') === '1') {
      openAdd();
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const live = db.partners.filter((p) => !p.archivedAt);
  // Business onboarding and portal access come from the server (partner_directory_status, 0042).
  const business = (p: Partner): BusinessStatus => statusMap?.get(p.id)?.business_status ?? (accountState(p).key === 'provisioning' ? 'not_onboarded' : 'verified');
  const portal = (p: Partner): PortalStatus => statusMap?.get(p.id)?.portal_status ?? (accountState(p).key === 'active' ? 'active' : accountState(p).key === 'suspended' ? 'suspended' : 'no_account');
  const onboardedBiz = (p: Partner) => business(p) !== 'not_onboarded';
  const ptype = (p: Partner) => statusMap?.get(p.id)?.agency_type ?? null;
  const inTab = (p: Partner, t: DirTab) => {
    switch (t) {
      case 'onboarded': return onboardedBiz(p);
      case 'mine': return onboardedBiz(p) && p.partnershipOfficerId === session?.userId;
      case 'active': return portal(p) === 'active';
      case 'not_activated': return onboardedBiz(p) && (portal(p) === 'no_account' || portal(p) === 'pending');
      case 'suspended': return portal(p) === 'suspended';
      case 'provisioning': return !onboardedBiz(p);
      case 'all': return !activeOnly || onboardedBiz(p);   // Partnership Officers never see partners still being provisioned
      default: return false;
    }
  };
  const reviewAll = (onboarded ?? []).filter((a) => a.verification === 'pending' && matchesType(a.agency_type, typeF));
  const reviewMine = reviewAll.filter((a) => a.assigned_officer === session?.userId);
  // Onboarded = onboarded organisations + onboarded agencies still to be linked: the dashboard KPI.
  const count = (k: DirTab) => (k === 'review' ? reviewAll.length : live.filter((p) => inTab(p, k) && matchesType(ptype(p), typeF)).length + (k === 'onboarded' ? reviewAll.length : k === 'mine' ? reviewMine.length : 0));
  const rows = useMemo(
    () =>
      live
        .filter((p) => inTab(p, tab))
        .filter((p) => matches(q, p.name, p.code, p.city, p.contactName, p.email))
        .filter((p) => !status || p.status === status)
        .filter((p) => !tier || p.tier === tier)
        .filter((p) => !country || p.country === country)
        .filter((p) => !officerF || p.partnershipOfficerId === officerF)
        .filter((p) => matchesType(ptype(p), typeF)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.partners, q, status, tier, activeOnly, tab, country, officerF, typeF, statusMap, session?.userId],
  );
  const countries = [...new Set([...live.map((p) => p.country), ...(onboarded ?? []).map((a) => a.country ?? '')].filter(Boolean))].sort();
  const officers = [...new Set([...live.map((p) => p.partnershipOfficerId), ...(onboarded ?? []).map((a) => a.assigned_officer)].filter(Boolean) as string[])];

  const stats = (id: string) => ({
    students: db.students.filter((s) => s.partnerId === id).length,
    apps: db.applications.filter((a) => a.partnerId === id).length,
    visas: db.applications.filter((a) => a.partnerId === id && a.status === 'Visa Granted').length,
  });

  const menu = (p: Partner) => [
    { label: 'Open workspace', icon: Eye, onClick: () => navigate(p.id) },
    ...(superAdmin && portal(p) === 'no_account' && onboardedBiz(p) ? [{ label: 'Create / activate partner account', icon: KeyRound, onClick: () => setActivating(p) }] : []),
    ...(canClassify && onboardedBiz(p) ? [{ label: 'Set agency type', icon: Globe2, onClick: () => setClassifying(p) }] : []),
    { label: 'Edit partner', icon: Pencil, onClick: () => { setEditing(p); setFormOpen(true); } },
    ...(superAdmin ? [{ label: 'Access, accounts & archive', icon: SlidersHorizontal, onClick: () => navigate('/admin/users') }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Clients & Branches"
        subtitle="Every onboarded client — historically onboarded or verified — with its portal access shown separately. Prospects and earlier stages stay in the Agency List."
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: 'grid', label: 'Cards' }, { value: 'table', label: 'Table' }]} />
            {canManageRegistrations(realSession) && (
              <Button variant="secondary" icon={Link2} onClick={() => navigate('registrations')}>
                Partner Registrations
              </Button>
            )}
            {superAdmin && (
              <Button icon={Plus} onClick={openAdd}>
                Add Partner
              </Button>
            )}
          </>
        }
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'onboarded', label: 'Onboarded clients', count: count('onboarded') },
        { value: 'mine', label: 'My clients', count: count('mine') },
        { value: 'active', label: 'Portal active', count: count('active') },
        { value: 'not_activated', label: 'Portal not activated', count: count('not_activated') },
        { value: 'review', label: 'Needs review', count: count('review') },
        { value: 'suspended', label: 'Suspended', count: count('suspended') },
        ...(activeOnly ? [] : [{ value: 'provisioning' as const, label: 'Provisioning', count: count('provisioning') }]),
        { value: 'all', label: 'All', count: count('all') },
      ]} />
      <Card className="mb-6">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search partner, city, contact…" className="lg:w-96" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            <FilterSelect label="Agency type" value={typeF} onChange={setTypeF} options={TYPE_FILTERS} />
            <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries.map((c) => ({ value: c, label: c }))]} />
            <FilterSelect label="Officer" value={officerF} onChange={setOfficerF} options={[{ value: '', label: 'Any officer' }, ...officers.map((o) => ({ value: o, label: officerName(o) }))]} />
            {tab !== 'review' && <FilterSelect label="All tiers" value={tier} onChange={setTier} options={['Platinum', 'Gold', 'Silver']} />}
            {tab === 'all' && <FilterSelect label="All statuses" value={status} onChange={setStatus} options={['Active', 'Onboarding', 'Inactive']} />}
          </div>
        </div>
      </Card>

      {tab === 'review' ? (
        <PendingVerification rows={pending} loading={!onboarded} canVerify={canVerify} officerName={officerName} onLink={setLinking}
          onOpen={(a) => navigate(`../agencies/${a.agency_id}`, { relative: 'path' })} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No partners found" description="Try another search or add a new consultancy partner." action={superAdmin ? <Button icon={Plus} onClick={openAdd}>Add Partner</Button> : undefined} />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p, i) => {
            const s = stats(p.id);
            return (
              <Card key={p.id} hover className="group relative animate-fade-up cursor-pointer overflow-hidden" >
                <div style={{ animationDelay: `${i * 40}ms` }} onClick={() => navigate(p.id)} className="p-5">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rust to-brand opacity-0 transition group-hover:opacity-100" />
                  <div className="relative flex items-start gap-3.5">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-display text-base font-semibold text-white shadow-card" style={{ background: avatarColor(p.name) }}>
                      {initials(p.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[15px] font-semibold text-heading group-hover:text-rust">{p.name}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-mute">
                        <MapPin className="h-3 w-3" />
                        {p.city}, {countryFlag[p.country]} {p.country}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu trigger={() => <button type="button" aria-label="Partner actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-heading"><MoreHorizontal className="h-4 w-4" /></button>} items={menu(p)} />
                    </div>
                  </div>
                  <div className="relative mt-4 flex flex-wrap gap-1.5">
                    <Badge tone={BUSINESS[business(p)].tone} dot>{BUSINESS[business(p)].label}</Badge>
                    <Badge tone={PORTAL[portal(p)].tone}>{PORTAL[portal(p)].label}</Badge>
                    <AgencyTypeBadge type={ptype(p)} />
                    {agencyOf.get(p.id) && <Badge tone="slate">{statusMap?.get(p.id)?.onboarding_source === 'historical' ? 'Historical import' : 'Agency List'} · {agencyOf.get(p.id)!.reference}</Badge>}
                    <Badge tone={tierTone[p.tier]}>{p.tier}</Badge>
                    <Badge tone="slate">{p.branches.length} branch{p.branches.length > 1 ? 'es' : ''}</Badge>
                  </div>
                  <div className="relative mt-5 grid grid-cols-3 divide-x divide-line rounded-xl bg-canvas py-3 text-center">
                    {[['Students', s.students], ['Applications', s.apps], ['Visas', s.visas]].map(([l, v]) => (
                      <div key={l}>
                        <div className="font-display text-lg font-semibold text-heading">{v}</div>
                        <div className="text-[11px] font-medium text-ink-mute">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="relative mt-4 flex items-center justify-between text-xs text-ink-soft">
                    <span className="truncate">{p.contactName} · {p.email}{p.partnershipOfficerId ? ` · Officer: ${officerName(p.partnershipOfficerId)}` : ''}</span>
                    <span className="shrink-0 font-semibold text-rust opacity-0 transition group-hover:opacity-100">Open →</span>
                  </div>
                </div>
              </Card>
            );
          })}
          <button
            type="button"
            onClick={() => { setEditing(undefined); setFormOpen(true); }}
            className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line text-ink-soft transition hover:border-brand hover:bg-brand-50/40 hover:text-rust"
          >
            <LogoMark size={44} className="mb-3 opacity-80" />
            <span className="font-semibold">Onboard a new partner</span>
            <span className="text-xs text-ink-mute">Creates a separate workspace</span>
          </button>
        </div>
      ) : (
        <Card>
          <Table head={['Company / agency', 'Point of contact', 'Email', 'Country', 'Partnership Officer', 'Business onboarding', 'Portal access', 'Source', '']}>
            {rows.map((p) => {
              const ag = agencyOf.get(p.id);
              return (
                <tr key={p.id} className="cursor-pointer hover:bg-brand-50/30" onClick={() => navigate(p.id)}>
                  <td className="px-5 py-3.5"><div className="flex flex-wrap items-center gap-1.5 font-semibold text-heading">{p.name}<AgencyTypeBadge type={ptype(p)} /></div><div className="text-xs text-ink-mute">{p.code}{p.city ? ` · ${p.city}` : ''}</div></td>
                  <td className="px-5 py-3.5"><div className="text-heading">{p.contactName}</div><div className="text-xs text-ink-mute">{p.phone || '—'}</div></td>
                  <td className="px-5 py-3.5 text-ink-soft">{p.email || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{p.country || '—'}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{officerName(p.partnershipOfficerId)}</td>
                  <td className="px-5 py-3.5"><Badge tone={BUSINESS[business(p)].tone} dot>{BUSINESS[business(p)].label}</Badge></td>
                  <td className="px-5 py-3.5"><Badge tone={PORTAL[portal(p)].tone}>{PORTAL[portal(p)].label.replace('Portal: ', '')}</Badge></td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-xs text-ink-soft">{statusMap?.get(p.id)?.onboarding_source === 'historical' ? 'Historical import' : ag ? 'Agency List' : 'Added in the CRM'}{ag ? <div className="text-ink-mute">{ag.reference}</div> : null}</td>
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <Menu trigger={() => <button type="button" aria-label="Partner actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas"><MoreHorizontal className="h-4 w-4" /></button>} items={menu(p)} />
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {(tab === 'onboarded' || tab === 'mine') && (tab === 'mine' ? pending.filter((x) => x.assigned_officer === session?.userId) : pending).length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 font-display text-[15px] font-semibold text-heading">Onboarded — needs review</h3>
          <PendingVerification rows={tab === 'mine' ? pending.filter((x) => x.assigned_officer === session?.userId) : pending} loading={false} canVerify={canVerify} officerName={officerName} onLink={setLinking}
            onOpen={(x) => navigate(`../agencies/${x.agency_id}`, { relative: 'path' })} />
        </div>
      )}
      {classifying && <ClassifyClient partner={classifying} current={ptype(classifying)} onClose={() => setClassifying(null)} />}
      <PartnerForm open={formOpen} onClose={() => setFormOpen(false)} partner={editing} onCreated={(id) => navigate(id)} />
      <PartnerDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onCreated={async (email, password, delivery) => {
          setAccountOpen(false);
          setCreated(createdAccount('Partner and login account created', email, password, delivery));
          await actions.reload();
        }}
      />
      <CredentialsOnce data={created} onClose={() => setCreated(null)} />
      <PartnerUserDialog open={!!activating} activation partnerId={activating?.id} partners={activating ? [activating] : []} onClose={() => setActivating(null)}
        initial={activating ? { fullName: activating.contactName, email: activating.email || undefined, role: 'partner_admin' } : undefined}
        onCreated={async (email, password, delivery) => {
          setActivating(null);
          setCreated(createdAccount('Partner account created for an existing client', email, password, delivery));
          await actions.reload();
        }} />
      {linking && <LinkPartnerModal agency={linking} onClose={() => setLinking(null)}
        partners={live.filter((p) => !agencyOf.has(p.id)).map((p) => ({ id: p.id, name: p.name, status: p.status, portalEnabled: p.portalEnabled }))} />}
    </>
  );
}

// Historically onboarded agencies without a verified partner account: listed, never given portal access.
function PendingVerification({ rows, loading, canVerify, officerName, onLink, onOpen }: {
  rows: OnboardedAgency[]; loading: boolean; canVerify: boolean; officerName: (id: string | null) => string;
  onLink: (a: OnboardedAgency) => void; onOpen: (a: OnboardedAgency) => void;
}) {
  if (loading) return <Card><div className="p-6 text-sm text-ink-soft" role="status">Loading onboarded agencies…</div></Card>;
  if (rows.length === 0) return <Card><EmptyState icon={History} title="Nothing waiting for verification" description="Onboarded agencies without a verified partner account appear here." /></Card>;
  return (
    <Card>
      <p className="border-b border-line px-5 py-3 text-xs text-ink-soft">Onboarded before the CRM (or without a linked account). They have <b className="text-heading">no portal access</b> until an administrator links them to an existing partner or completes their registration and activation.</p>
      <Table head={['Agency', 'Contact', 'Country', 'Partnership Officer', 'Verification', 'Suggested match', '']}>
        {rows.map((a) => (
          <tr key={a.agency_id}>
            <td className="px-5 py-3.5"><div className="flex flex-wrap items-center gap-1.5 font-semibold text-heading">{a.company_name ?? a.reference}<AgencyTypeBadge type={a.agency_type} /></div><div className="text-xs text-ink-mute">{a.reference}{a.source_status ? ` · sheet: “${a.source_status}”` : ''}</div></td>
            <td className="px-5 py-3.5"><div className="text-heading">{a.contact_name ?? '—'}</div><div className="text-xs text-ink-mute">{[a.phone, a.email].filter(Boolean).join(' · ') || '—'}</div></td>
            <td className="px-5 py-3.5 text-ink-soft">{a.country ?? '—'}</td>
            <td className="px-5 py-3.5 text-ink-soft">{a.officer_name ?? officerName(a.assigned_officer)}</td>
            <td className="px-5 py-3.5">
              <Badge tone="amber" dot>Historically onboarded · pending verification</Badge>
              {a.needs_reconciliation && <div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">Needs reconciliation</div>}
              {a.registration_status && <div className="mt-1 text-[11px] text-ink-mute">Registration: {a.registration_status.replace(/_/g, ' ')}</div>}
            </td>
            <td className="px-5 py-3.5 text-sm">{a.suggested_partner_name ? <span className="text-heading">{a.suggested_partner_name}</span> : <span className="text-ink-mute">—</span>}</td>
            <td className="whitespace-nowrap px-5 py-3.5 text-right">
              {canVerify && <Button size="sm" className="mr-1.5" onClick={() => onLink(a)}>Verify…</Button>}
              <Button size="sm" variant="secondary" onClick={() => onOpen(a)}>Open agency</Button>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

type Draft = Omit<Partner, 'id' | 'joinedAt'>;
const empty: Draft = { name: '', code: '', contactName: '', email: '', phone: '', city: '', country: 'India', website: '', status: 'Onboarding', tier: 'Silver', branches: [], commissionRate: 10 };

export function PartnerForm({ open, onClose, partner, onCreated }: { open: boolean; onClose: () => void; partner?: Partner; onCreated?: (id: string) => void }) {
  const { db, actions } = useStore();
  const { realSession } = useAuth();
  const superAdmin = realSession?.userRole === 'super_admin';
  const toast = useToast();
  const [d, setD] = useState<Draft>(empty);
  const [branches, setBranches] = useState('');
  const initial = useRef('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const base = partner ? { ...partner } : { ...empty };
    setD(base);
    setBranches(base.branches.join(', '));
    initial.current = JSON.stringify([base, base.branches.join(', ')]);
    setErrors({});
  }, [open, partner]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = () => {
    const e: Record<string, string> = {};
    if (d.name.trim().length < 3) e.name = 'Partner name is required.';
    if (!/^[A-Z]{2,5}$/.test(d.code)) e.code = '2–5 uppercase letters.';
    else if (db.partners.some((p) => p.code === d.code && p.id !== partner?.id)) e.code = 'Code already in use.';
    if (!d.contactName.trim()) e.contactName = 'Contact person is required.';
    if (!/^\S+@\S+\.\S+$/.test(d.email)) e.email = 'Valid email required.';
    if (d.phone.replace(/\D/g, '').length < 8) e.phone = 'Valid phone required.';
    if (!d.city.trim()) e.city = 'City is required.';
    setErrors(e);
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields');
    const payload = { ...d, branches: branches.split(',').map((b) => b.trim()).filter(Boolean) };
    if (!payload.branches.length) payload.branches = [d.city];
    if (partner) {
      actions.updatePartner(partner.id, payload);
      toast.success('Partner updated', d.name);
    } else {
      const id = actions.addPartner(payload);
      toast.success('Partner created', `${d.name} now has its own workspace.`);
      onCreated?.(id);
    }
    onClose();
  };

  return (
    <Modal
      dirty={JSON.stringify([d, branches]) !== initial.current}
      open={open}
      onClose={onClose}
      size="lg"
      title={partner ? 'Edit partner' : 'Add consultancy partner'}
      subtitle="Each partner gets a separate, private workspace."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{partner ? 'Save changes' : 'Create partner'}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Partner name" required error={errors.name} className="sm:col-span-2">
          <Input icon={Building2} value={d.name} invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sunrise Overseas Education" autoFocus />
        </Field>
        <Field label="Partner code" required error={errors.code} hint="Short unique code">
          <Input value={d.code} invalid={!!errors.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))} placeholder="SOE" />
        </Field>
        <Field label="Contact person" required error={errors.contactName}>
          <Input value={d.contactName} invalid={!!errors.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Email" required error={errors.email}>
          <Input icon={Mail} type="email" value={d.email} invalid={!!errors.email} onChange={(e) => set('email', e.target.value)} placeholder="contact@partner.com" />
        </Field>
        <Field label="Phone" required error={errors.phone}>
          <Input icon={Phone} value={d.phone} invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />
        </Field>
        <Field label="City" required error={errors.city}>
          <Input icon={MapPin} value={d.city} invalid={!!errors.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Country">
          <Select value={d.country} onChange={(e) => set('country', e.target.value)}>
            {['India', 'UAE', 'Sri Lanka', 'Nepal', 'Bangladesh', 'Nigeria', 'Vietnam'].map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Website">
          <Input icon={Globe} value={d.website} onChange={(e) => set('website', e.target.value)} placeholder="partner.com" />
        </Field>
        <Field label="Branches" hint="Comma separated, e.g. Kochi, Calicut">
          <Input value={branches} onChange={(e) => setBranches(e.target.value)} />
        </Field>
        <Field label="Tier">
          <Select value={d.tier} onChange={(e) => set('tier', e.target.value as PartnerTier)}>
            {['Platinum', 'Gold', 'Silver'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        {superAdmin && (
          <Field label="Status">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as PartnerStatus)}>
              {['Active', 'Onboarding', 'Inactive'].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Commission rate (%)">
          <Input type="number" min={0} max={40} value={d.commissionRate ?? ''} onChange={(e) => set('commissionRate', Number(e.target.value))} />
        </Field>
        <Field label="Partnership Officer" hint="Takes part in this partner's application chats">
          <Select value={d.partnershipOfficerId ?? ''} onChange={(e) => set('partnershipOfficerId', e.target.value || null)} aria-label="Partnership Officer">
            <option value="">Not assigned</option>
            {db.staff.map((m) => <option key={m.id} value={m.id}>{m.fullName}{m.department ? ` · ${m.department}` : ''}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}


/** Clients & Branches → Set agency type (the linked agency takes the same type). */
function ClassifyClient({ partner, current, onClose }: { partner: Partner; current: AgencyType | null; onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<AgencyType | ''>(current ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!type) return;
    setBusy(true);
    const r = await rpc('set_partner_agency_type', { p_partner: partner.id, p_type: type });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(`${partner.name} · ${type === 'domestic' ? 'Domestic' : 'International'}`, 'Saved to the client and its Agency List record.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Agency type" subtitle={partner.name}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !type || type === current} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <Field label="Classify this client as"><Segmented options={[{ value: 'domestic', label: 'Domestic' }, { value: 'international', label: 'International' }]} value={type} onChange={(v) => setType(v as AgencyType)} /></Field>
      {!current && <p className="mt-3 text-xs text-ink-mute">Currently Not Classified. Nothing is inferred from the country, phone or email.</p>}
    </Modal>
  );
}
