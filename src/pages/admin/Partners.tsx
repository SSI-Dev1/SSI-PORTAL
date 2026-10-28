import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Eye, Globe, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, SearchInput, Segmented, Select, Table } from '../../components/ui';
import { LogoMark } from '../../components/brand';
import { useConfirm, useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import type { Partner, PartnerStatus, PartnerTier } from '../../data/types';
import { avatarColor, countryFlag, formatDate, initials, matches, type Tone } from '../../lib/utils';

export const partnerStatusTone: Record<PartnerStatus, Tone> = { Active: 'green', Onboarding: 'amber', Inactive: 'slate' };
export const tierTone: Record<PartnerTier, Tone> = { Platinum: 'navy', Gold: 'orange', Silver: 'slate' };

export default function Partners() {
  const { db, actions } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Partner>();

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(undefined);
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const rows = useMemo(
    () =>
      db.partners
        .filter((p) => matches(q, p.name, p.code, p.city, p.contactName, p.email))
        .filter((p) => !status || p.status === status)
        .filter((p) => !tier || p.tier === tier),
    [db.partners, q, status, tier],
  );

  const stats = (id: string) => ({
    students: db.students.filter((s) => s.partnerId === id).length,
    apps: db.applications.filter((a) => a.partnerId === id).length,
    visas: db.applications.filter((a) => a.partnerId === id && a.status === 'Visa Granted').length,
  });

  const remove = async (p: Partner) => {
    const ok = await confirm({
      title: `Remove ${p.name}?`,
      message: 'This permanently deletes the partner workspace including its students, applications, documents and invoices.',
      confirmLabel: 'Remove partner',
      danger: true,
    });
    if (ok) {
      actions.removePartner(p.id);
      toast.success('Partner removed', p.name);
    }
  };

  const menu = (p: Partner) => [
    { label: 'Open workspace', icon: Eye, onClick: () => navigate(`/admin/partners/${p.id}`) },
    { label: 'Edit partner', icon: Pencil, onClick: () => { setEditing(p); setFormOpen(true); } },
    { label: 'Remove', icon: Trash2, onClick: () => remove(p), danger: true },
  ];

  return (
    <>
      <PageHeader
        title="Clients & Branches"
        subtitle="Consultancy partners and their branch workspaces."
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: 'grid', label: 'Cards' }, { value: 'table', label: 'Table' }]} />
            <Button icon={Plus} onClick={() => { setEditing(undefined); setFormOpen(true); }}>
              Add Partner
            </Button>
          </>
        }
      />
      <Card className="mb-6">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search partner, city, contact…" className="lg:w-96" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            <FilterSelect label="All tiers" value={tier} onChange={setTier} options={['Platinum', 'Gold', 'Silver']} />
            <FilterSelect label="All statuses" value={status} onChange={setStatus} options={['Active', 'Onboarding', 'Inactive']} />
          </div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No partners found" description="Try another search or add a new consultancy partner." action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Add Partner</Button>} />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p, i) => {
            const s = stats(p.id);
            return (
              <Card key={p.id} hover className="group relative animate-fade-up cursor-pointer overflow-hidden" >
                <div style={{ animationDelay: `${i * 40}ms` }} onClick={() => navigate(`/admin/partners/${p.id}`)} className="p-5">
                  <div className="absolute -right-10 -top-10 h-28 w-28 rotate-45 rounded-3xl bg-brand-50 transition group-hover:bg-brand-100" />
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
                    <Badge tone={partnerStatusTone[p.status]} dot>{p.status}</Badge>
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
                    <span className="truncate">{p.contactName} · {p.email}</span>
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
          <Table head={['Partner', 'Contact', 'Location', 'Tier', 'Students', 'Applications', 'Status', 'Joined', '']}>
            {rows.map((p) => {
              const s = stats(p.id);
              return (
                <tr key={p.id} className="cursor-pointer hover:bg-brand-50/30" onClick={() => navigate(`/admin/partners/${p.id}`)}>
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-heading">{p.name}</div>
                    <div className="text-xs text-ink-mute">{p.code}</div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="text-heading">{p.contactName}</div>
                    <div className="text-xs text-ink-mute">{p.email}</div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{p.city}, {p.country}</td>
                  <td className="px-5 py-3.5"><Badge tone={tierTone[p.tier]}>{p.tier}</Badge></td>
                  <td className="px-5 py-3.5 font-semibold text-heading">{s.students}</td>
                  <td className="px-5 py-3.5 font-semibold text-heading">{s.apps}</td>
                  <td className="px-5 py-3.5"><Badge tone={partnerStatusTone[p.status]} dot>{p.status}</Badge></td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{formatDate(p.joinedAt)}</td>
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <Menu trigger={() => <button type="button" aria-label="Partner actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas"><MoreHorizontal className="h-4 w-4" /></button>} items={menu(p)} />
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      <PartnerForm open={formOpen} onClose={() => setFormOpen(false)} partner={editing} onCreated={(id) => navigate(`/admin/partners/${id}`)} />
    </>
  );
}

type Draft = Omit<Partner, 'id' | 'joinedAt'>;
const empty: Draft = { name: '', code: '', contactName: '', email: '', phone: '', city: '', country: 'India', website: '', status: 'Onboarding', tier: 'Silver', branches: [], commissionRate: 10 };

export function PartnerForm({ open, onClose, partner, onCreated }: { open: boolean; onClose: () => void; partner?: Partner; onCreated?: (id: string) => void }) {
  const { db, actions } = useStore();
  const toast = useToast();
  const [d, setD] = useState<Draft>(empty);
  const [branches, setBranches] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const base = partner ? { ...partner } : { ...empty };
    setD(base);
    setBranches(base.branches.join(', '));
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
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set('status', e.target.value as PartnerStatus)}>
            {['Active', 'Onboarding', 'Inactive'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Commission rate (%)">
          <Input type="number" min={0} max={40} value={d.commissionRate} onChange={(e) => set('commissionRate', Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  );
}

