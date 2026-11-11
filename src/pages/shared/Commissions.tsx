// Commission Management (Admin and Staff portals). What each person sees and may do follows their
// commission permissions, and the database enforces the same rules (0029):
// view → records and Tier 1/2/3 partner rates; tag → tag agencies (changes need approval);
// manage → agreements, custom commissions, approvals; internal → SSI GLOBAL's own commission and
// profit; edit → master records, setup and sheet imports.
import { useEffect, useState } from 'react';
import { AlertTriangle, BadgePercent, Building2, CheckCircle2, Eye, FileSpreadsheet, Globe2, History, Link2, Lock, Pencil, Plus, Tag, Upload, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DatePicker, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Segmented, Select, Table, Tabs, Textarea, usePaged } from '../../components/ui';
import { KPI } from '../../components/hr';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { MAX_IMPORT_BYTES, readWorkbook } from '../../lib/catalogueImport';
import { parseCommissionSheet, type CommissionParse } from '../../lib/commissionImport';
import {
  ROUTE_LABEL, commissionCaps, fmtCommission, useCommissionData,
  type CommissionRecord, type PartnerAssignment, type TierRate, type ValueKind,
} from '../../lib/commissions';
import { serverMessage } from '../../data/hr';
import { cn, matches } from '../../lib/utils';

const DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;
const statusTone = { active: 'green', pending_approval: 'amber', inactive: 'slate', rejected: 'red' } as const;
const statusLabel = { active: 'Active', pending_approval: 'Waiting for approval', inactive: 'Ended', rejected: 'Rejected' } as const;
const ACTION_LABEL: Record<string, string> = {
  assigned: 'Agency tagged', tag_requested: 'Change requested', custom_assigned: 'Custom commission set', active: 'Approved', pending_approval: 'Waiting for approval',
  inactive: 'Ended', rejected: 'Rejected', tier_changed: 'Tier changed', custom_changed: 'Custom value changed', edited: 'Edited',
};

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Not configured' };
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: serverMessage(error) } : { ok: true, data: data as T };
}

export default function Commissions() {
  const { session, db } = useStore();
  const caps = commissionCaps(session);
  const { data, loading, error, lk } = useCommissionData(caps.view, { internal: caps.internal, imports: caps.importSheets });
  const [tab, setTab] = useState<'catalogue' | 'agreements' | 'import' | 'setup' | 'history'>('catalogue');
  const partnerName = (id: string) => db.partners.find((p) => p.id === id)?.name ?? id;
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session.name : 'SSI GLOBAL staff') : '—');
  const activeAgreements = data.assignments.filter((a) => a.status === 'active');
  const pending = data.assignments.filter((a) => a.status === 'pending_approval');

  if (!caps.view) return <Card><EmptyState icon={Lock} title="No commission access" description="Ask a Super Admin for a commission permission." /></Card>;
  return (
    <>
      <PageHeader title="Commission Management" subtitle={`Country-wise commission records, Tier 1/2/3 partner rates and agency agreements.${caps.internal ? ' Internal values are confidential — never share them with partners.' : ''}`} />
      {error && <Alert tone="warning" className="mb-4">{error}</Alert>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KPI icon={BadgePercent} label="Commission records" value={data.records.filter((r) => r.status === 'active').length} onClick={() => setTab('catalogue')} />
        <KPI icon={Globe2} tone="navy" label="Countries" value={data.countries.filter((c) => c.active).length} />
        <KPI icon={Building2} tone="navy" label="Portal providers" value={data.providers.filter((p) => p.active).length} />
        <KPI icon={AlertTriangle} tone="amber" label="Records to review" value={data.records.filter((r) => r.needsReview && r.status === 'active').length} onClick={() => setTab('catalogue')} />
        <KPI icon={Link2} tone="green" label="Active agency agreements" value={activeAgreements.length} onClick={() => setTab('agreements')} />
        <KPI icon={History} tone="orange" label="Waiting for approval" value={pending.length} onClick={() => setTab('agreements')} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'catalogue', label: 'Commission records' },
        { value: 'agreements', label: 'Agency agreements', count: pending.length || undefined },
        ...(caps.importSheets ? [{ value: 'import' as const, label: 'Import sheet' }] : []),
        ...(caps.edit ? [{ value: 'setup' as const, label: 'Countries, portals & tiers' }] : []),
        { value: 'history', label: 'History' },
      ]} />
      {loading ? <Card className="p-6 text-sm text-ink-soft">Loading…</Card> : tab === 'catalogue' ? (
        <Catalogue data={data} lk={lk} caps={caps} partnerName={partnerName} staffName={staffName} />
      ) : tab === 'agreements' ? (
        <Agreements data={data} lk={lk} caps={caps} partnerName={partnerName} staffName={staffName} />
      ) : tab === 'import' ? (
        <ImportSheet data={data} staffName={staffName} />
      ) : tab === 'setup' ? (
        <Setup data={data} />
      ) : (
        <Card>
          {data.history.length === 0 ? <EmptyState icon={History} title="No changes yet" /> : (
            <Table className="hr-table" head={['When', 'What', 'Agency', 'Record', 'By']}>
              {data.history.map((h) => {
                const r = lk.record.get(h.recordId);
                return (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap">{new Date(h.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{ACTION_LABEL[h.action] ?? h.action}</td>
                    <td className="font-medium text-heading">{partnerName(h.partnerId)}</td>
                    <td>{r ? `${r.universityName}${r.providerLabel ? ` · ${r.providerLabel}` : ''}` : '—'}</td>
                    <td>{staffName(h.actor)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

type Data = ReturnType<typeof useCommissionData>['data'];
type Lk = ReturnType<typeof useCommissionData>['lk'];
type Caps = ReturnType<typeof commissionCaps>;

// ------------------------------------------------------------------ catalogue

function Catalogue({ data, lk, caps, partnerName, staffName }: { data: Data; lk: Lk; caps: Caps; partnerName: (id: string) => string; staffName: (id: string | null) => string }) {
  const { db } = useStore();
  const [country, setCountry] = useState('');
  const [q, setQ] = useState('');
  const [route, setRoute] = useState('');
  const [provider, setProvider] = useState('');
  const [tier, setTier] = useState('');
  const [partner, setPartner] = useState('');
  const [status, setStatus] = useState('active');
  const [review, setReview] = useState(false);
  const [details, setDetails] = useState<CommissionRecord | null>(null);
  const [tagging, setTagging] = useState<CommissionRecord | null>(null);
  const [custom, setCustom] = useState<{ record: CommissionRecord; partnerId?: string } | null>(null);
  const [editing, setEditing] = useState<Partial<CommissionRecord> | null>(null);
  const tiers = data.tiers.filter((t) => t.active && (!tier || t.id === tier));
  const rows = data.records.filter((r) => (!country || r.countryId === country)
    && matches(q, r.universityName, r.intake ?? '', r.variant ?? '', r.studyLevel ?? '', r.providerLabel ?? '')
    && (!route || r.route === route) && (!provider || r.providerId === provider)
    && (!status || r.status === status) && (!review || r.needsReview)
    && (!partner || data.assignments.some((a) => a.recordId === r.id && a.partnerId === partner && a.status === 'active')));
  const paged = usePaged(rows, 25, `${country}${q}${route}${provider}${tier}${partner}${status}${review}`);
  const agreementsOn = (id: string) => data.assignments.filter((a) => a.recordId === id && a.status === 'active');
  const clear = () => { setCountry(''); setQ(''); setRoute(''); setProvider(''); setTier(''); setPartner(''); setStatus('active'); setReview(false); };
  const filtered = country || q || route || provider || tier || partner || status !== 'active' || review;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...data.countries.map((c) => ({ value: c.id, label: c.name }))]} />
          <SearchInput value={q} onChange={setQ} placeholder="University, intake, campus or portal…" className="w-full sm:w-64" />
          <FilterSelect label="Route" value={route} onChange={setRoute} options={[{ value: '', label: 'Direct & portal' }, { value: 'direct', label: 'Direct' }, { value: 'portal', label: 'Through a portal' }]} />
          <FilterSelect label="Portal" value={provider} onChange={setProvider} options={[{ value: '', label: 'Any portal' }, ...data.providers.map((p) => ({ value: p.id, label: p.name }))]} />
          <FilterSelect label="Tier" value={tier} onChange={setTier} options={[{ value: '', label: 'All tiers' }, ...data.tiers.map((t) => ({ value: t.id, label: t.label }))]} />
          <FilterSelect label="Agency" value={partner} onChange={setPartner} options={[{ value: '', label: 'Any agency' }, ...db.partners.map((p) => ({ value: p.id, label: p.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: '', label: 'All' }]} />
          <Checkbox checked={review} onCheckedChange={setReview} label="Needs review" />
          {filtered && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
          {caps.edit && <Button size="sm" className="ml-auto" icon={Plus} onClick={() => setEditing({ route: 'portal', status: 'active', countryId: country || data.countries[0]?.id })}>New record</Button>}
        </div>
        {rows.length === 0 ? <EmptyState icon={BadgePercent} title={data.records.length ? 'No records match' : 'No commission records yet'} description={data.records.length ? undefined : caps.importSheets ? 'Import the commission sheet to start.' : 'An administrator imports the commission sheet.'} /> : (
          <>
            <Table className="hr-table" head={['University', 'Route / portal', ...tiers.map((t) => `${t.label} (partner)`), ...(caps.internal ? ['SSI receives', 'Profit'] : []), 'Agencies', '']}>
              {paged.rows.map((r) => {
                const internal = lk.internal.get(r.id);
                const ag = agreementsOn(r.id);
                return (
                  <tr key={r.id} className={cn(r.status === 'inactive' && 'opacity-60')}>
                    <td className="min-w-[220px]">
                      <div className="font-medium text-heading">{r.universityName}</div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-ink-mute">
                        {lk.country.get(r.countryId)?.name}{r.intake ? ` · ${r.intake}` : ''}
                        {r.studyLevel && <Badge tone="slate">{r.studyLevel}</Badge>}
                        {r.variant && <Badge tone="slate">{r.variant}</Badge>}
                        {r.needsReview && <Badge tone="amber">Review</Badge>}
                      </div>
                    </td>
                    <td>{r.route === 'direct' ? <Badge tone="navy">Direct</Badge> : <><div className="font-medium text-heading">{lk.provider.get(r.providerId ?? '')?.name ?? r.providerLabel ?? '—'}</div><div className="text-xs text-ink-mute">Portal</div></>}</td>
                    {tiers.map((t) => { const rate = lk.rate(r.id, t.id); return <td key={t.id} className={cn('whitespace-nowrap tabular-nums', rate?.needsReview && 'text-amber-600')}>{fmtCommission(rate?.valueKind, rate?.value, rate?.currency, rate?.rawValue)}</td>; })}
                    {caps.internal && <>
                      <td className="whitespace-nowrap tabular-nums">{fmtCommission(internal?.receivedKind, internal?.receivedValue, r.currency, internal?.receivedRaw)}</td>
                      <td className="whitespace-nowrap tabular-nums">{fmtCommission(internal?.marginKind, internal?.marginValue, r.currency, internal?.marginRaw)}</td>
                    </>}
                    <td>{ag.length ? <span className="text-xs text-ink-soft">{ag.slice(0, 2).map((a) => `${partnerName(a.partnerId)} (${lk.tier.get(a.tierId)?.label}${a.isCustom ? ', custom' : ''})`).join(', ')}{ag.length > 2 ? ` +${ag.length - 2}` : ''}</span> : <span className="text-ink-mute">—</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" icon={Eye} aria-label="Details" onClick={() => setDetails(r)} />
                      {caps.edit && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit record" onClick={() => setEditing(r)} />}
                      {caps.tag && r.status === 'active' && <Button size="sm" variant="secondary" icon={Tag} onClick={() => setTagging(r)}>Tag agency</Button>}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="records" />
          </>
        )}
      </Card>
      <RecordDetails record={details} data={data} lk={lk} caps={caps} partnerName={partnerName} staffName={staffName} onClose={() => setDetails(null)}
        onCustom={(partnerId) => details && setCustom({ record: details, partnerId })} />
      <TagModal record={tagging} data={data} lk={lk} caps={caps} onClose={() => setTagging(null)} onCustom={() => tagging && (setCustom({ record: tagging }), setTagging(null))} />
      <CustomModal value={custom} data={data} lk={lk} onClose={() => setCustom(null)} />
      {caps.edit && <RecordEditor value={editing} data={data} lk={lk} caps={caps} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecordDetails({ record, data, lk, caps, partnerName, staffName, onClose, onCustom }: {
  record: CommissionRecord | null; data: Data; lk: Lk; caps: Caps; partnerName: (id: string) => string; staffName: (id: string | null) => string; onClose: () => void; onCustom: (partnerId?: string) => void;
}) {
  if (!record) return null;
  const internal = lk.internal.get(record.id);
  const ag = data.assignments.filter((a) => a.recordId === record.id);
  const row = (k: string, v: React.ReactNode) => <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="mt-0.5 text-sm text-heading">{v || '—'}</dd></div>;
  return (
    <Modal open onClose={onClose} size="xl" title={record.universityName} subtitle={`${lk.country.get(record.countryId)?.name ?? ''}${record.intake ? ` · ${record.intake}` : ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{caps.manage && record.status === 'active' && <Button icon={BadgePercent} onClick={() => onCustom()}>Custom commission…</Button>}</>}>
      <div className="space-y-5">
        {record.needsReview && <Alert tone="warning" title="Check this record">{record.reviewNotes ?? 'Marked for review.'}</Alert>}
        <dl className="grid gap-4 sm:grid-cols-3">
          {row('Route', ROUTE_LABEL[record.route])}
          {row('Portal', record.route === 'portal' ? lk.provider.get(record.providerId ?? '')?.name ?? record.providerLabel : null)}
          {row('Currency', record.currency ?? 'Not stated')}
          {row('Level', record.studyLevel)}
          {row('Campus / programme', record.variant)}
          {row('Student market', record.studentMarket)}
          {row('Valid', record.effectiveFrom || record.effectiveTo ? `${record.effectiveFrom ?? '…'} – ${record.effectiveTo ?? '…'}` : 'Not stated')}
          {row('Source', record.sourceSheet ? `${record.sourceSheet}, row ${record.sourceRow}` : 'Entered manually')}
          {row('Partner conditions', record.conditions)}
        </dl>
        <Card>
          <CardHeader title="Partner tier rates" subtitle="What an agency on each tier is offered" />
          <Table className="hr-table" head={['Tier', 'Rate', 'As written in the sheet', 'Note']}>
            {data.tiers.map((t) => { const rate = lk.rate(record.id, t.id); return (
              <tr key={t.id}><td className="font-medium text-heading">{t.label}</td><td className="tabular-nums">{fmtCommission(rate?.valueKind, rate?.value, rate?.currency, rate?.rawValue)}</td><td className="text-ink-soft">{rate?.rawValue ?? '—'}</td><td className="text-ink-soft">{rate?.note ?? ''}</td></tr>
            ); })}
          </Table>
        </Card>
        {caps.internal && internal && (
          <Card className="border-brand-300">
            <CardHeader title={<span className="inline-flex items-center gap-1.5"><Lock className="h-4 w-4 text-rust" /> Internal — confidential</span>} subtitle="Never shown to partners" />
            <dl className="grid gap-4 px-5 pb-4 sm:grid-cols-3">
              {row('SSI GLOBAL receives', `${fmtCommission(internal.receivedKind, internal.receivedValue, record.currency, internal.receivedRaw)}${internal.receivedRaw ? ` · “${internal.receivedRaw}”` : ''}`)}
              {row('Profit', `${fmtCommission(internal.marginKind, internal.marginValue, record.currency, internal.marginRaw)}${internal.marginRaw ? ` · “${internal.marginRaw}”` : ''}`)}
              {row('Internal notes', internal.internalNotes)}
            </dl>
            {Object.keys(internal.sourceRow ?? {}).length > 0 && (
              <div className="px-5 pb-5">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Original sheet row</div>
                <Table className="hr-table" head={['Column', 'Value']}>
                  {Object.entries(internal.sourceRow).map(([k, v]) => <tr key={k}><td className="text-ink-soft">{k}</td><td className="whitespace-pre-wrap text-heading">{v}</td></tr>)}
                </Table>
              </div>
            )}
          </Card>
        )}
        <Card>
          <CardHeader title="Agency agreements on this record" />
          {ag.length === 0 ? <EmptyState icon={Link2} title="No agency tagged yet" /> : (
            <Table className="hr-table" head={['Agency', 'Tier', 'Partner commission', 'Status', 'By', '']}>
              {ag.map((a) => { const rate = lk.rate(a.recordId, a.tierId); return (
                <tr key={a.id}>
                  <td className="font-medium text-heading">{partnerName(a.partnerId)}</td>
                  <td>{lk.tier.get(a.tierId)?.label}{a.isCustom && <Badge tone="orange" className="ml-1">Custom</Badge>}</td>
                  <td className="tabular-nums">{a.isCustom ? fmtCommission(a.customKind, a.customValue, a.customCurrency) : fmtCommission(rate?.valueKind, rate?.value, rate?.currency, rate?.rawValue)}</td>
                  <td><Badge tone={statusTone[a.status]}>{statusLabel[a.status]}</Badge></td>
                  <td className="text-xs text-ink-soft">{staffName(a.assignedBy)} · {new Date(a.assignedAt).toLocaleDateString('en-GB')}</td>
                  <td className="text-right">{caps.manage && a.status === 'active' && <Button size="sm" variant="ghost" onClick={() => onCustom(a.partnerId)}>Custom…</Button>}</td>
                </tr>
              ); })}
            </Table>
          )}
        </Card>
      </div>
    </Modal>
  );
}

function TagModal({ record, data, lk, caps, onClose, onCustom }: { record: CommissionRecord | null; data: Data; lk: Lk; caps: Caps; onClose: () => void; onCustom: () => void }) {
  const { db } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ partner: '', tier: '', from: '', to: '', conditions: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (record) setF({ partner: '', tier: '', from: '', to: '', conditions: '', remarks: '' }); }, [record]);
  if (!record) return null;
  const current = data.assignments.find((a) => a.recordId === record.id && a.partnerId === f.partner && a.status === 'active');
  const pendingOne = data.assignments.find((a) => a.recordId === record.id && a.partnerId === f.partner && a.status === 'pending_approval');
  const rate = f.tier ? lk.rate(record.id, f.tier) : undefined;
  const needsApproval = !!current && !caps.manage;
  const ok = f.partner && f.tier && rate && !pendingOne && !(current && current.tierId === f.tier && !current.isCustom) && !(f.from && f.to && f.to < f.from);
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    const r = await rpc<{ status: string }>('tag_partner_commission', { p_partner: f.partner, p_record: record.id, p_tier: f.tier, p_valid_from: f.from || null, p_valid_to: f.to || null,
      p_partner_conditions: f.conditions || null, p_remarks: f.remarks || null });
    setBusy(false);
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success(r.data.status === 'active' ? 'Agency tagged' : 'Sent for approval', r.data.status === 'active' ? 'The agency sees this rate in their Commission page.' : 'A commission manager approves the change before it applies.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Tag an agency" subtitle={`${record.universityName}${record.route === 'portal' ? ` · ${lk.provider.get(record.providerId ?? '')?.name ?? record.providerLabel}` : ' · Direct'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !ok} icon={Tag} onClick={save}>{busy ? 'Saving…' : needsApproval ? 'Request change' : 'Tag agency'}</Button></>}>
      <div className="space-y-4">
        <Field label="Partner agency" required>
          <Select value={f.partner} searchable onChange={(e) => setF({ ...f, partner: e.target.value })}>
            <option value="">Choose agency</option>
            {db.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {current && <Alert tone={needsApproval ? 'warning' : 'info'}>This agency already has {lk.tier.get(current.tierId)?.label}{current.isCustom ? ' (custom)' : ''} on this record. {needsApproval ? 'Your change waits for a commission manager to approve; the current agreement stays until then.' : 'Saving replaces it; the earlier agreement is kept in the history.'}</Alert>}
        {pendingOne && <Alert tone="warning">A change for this agency is already waiting for approval.</Alert>}
        <Field label="Commission tier" required hint={rate ? `Partner rate: ${fmtCommission(rate.valueKind, rate.value, rate.currency, rate.rawValue)}` : undefined}>
          <Segmented value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={data.tiers.filter((t) => t.active).map((t) => ({ value: t.id, label: t.label }))} />
        </Field>
        {rate?.valueKind === 'unclear' && <Alert tone="warning">This tier value could not be read from the sheet (“{rate.rawValue}”). Fix the record before tagging, or ask a manager for a custom commission.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid from"><DatePicker value={f.from} onChange={(v) => setF({ ...f, from: v ?? '' })} /></Field>
          <Field label="Valid until" error={f.from && f.to && f.to < f.from ? 'Before the start date' : undefined}><DatePicker value={f.to} min={f.from || undefined} onChange={(v) => setF({ ...f, to: v ?? '' })} /></Field>
        </div>
        <Field label="Conditions shown to the agency" hint="Optional"><Textarea rows={2} maxLength={1000} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
        <Field label="Internal remark" hint="Never shown to the agency"><Textarea rows={2} maxLength={1000} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        {caps.manage && <button type="button" className="text-sm font-semibold text-rust hover:underline" onClick={onCustom}>Set a custom commission instead…</button>}
      </div>
    </Modal>
  );
}

function CustomModal({ value, data, lk, onClose }: { value: { record: CommissionRecord; partnerId?: string } | null; data: Data; lk: Lk; onClose: () => void }) {
  const { db } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ partner: '', tier: 'tier_1', kind: 'percent' as 'percent' | 'amount', value: '', currency: '', from: '', to: '', conditions: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!value) return;
    const cur = data.assignments.find((a) => a.recordId === value.record.id && a.partnerId === value.partnerId && a.status === 'active');
    setF({ partner: value.partnerId ?? '', tier: cur?.tierId ?? 'tier_1', kind: cur?.customKind ?? 'percent', value: cur?.customValue ?? '', currency: cur?.customCurrency ?? value.record.currency ?? '',
      from: cur?.validFrom ?? '', to: cur?.validTo ?? '', conditions: cur?.partnerConditions ?? '', remarks: '' });
  }, [value, data.assignments]);
  if (!value) return null;
  const r = value.record;
  const valueOk = DECIMAL.test(f.value) && (f.kind === 'amount' || Number(f.value) <= 100);
  const ok = f.partner && valueOk && (f.kind === 'percent' || /^[A-Z]{3}$/.test(f.currency)) && f.remarks.trim().length >= 3 && !(f.from && f.to && f.to < f.from);
  const standard = lk.rate(r.id, f.tier);
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    const res = await rpc('set_custom_partner_commission', { p_partner: f.partner, p_record: r.id, p_tier: f.tier, p_kind: f.kind, p_value: f.value, p_currency: f.kind === 'amount' ? f.currency : null,
      p_valid_from: f.from || null, p_valid_to: f.to || null, p_partner_conditions: f.conditions || null, p_remarks: f.remarks });
    setBusy(false);
    if (!res.ok) return toast.error('Not saved', res.error);
    toast.success('Custom commission saved', 'Only this agency\'s agreement changed; the master rates are unchanged.');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Custom commission" subtitle={`${r.universityName}${r.route === 'portal' ? ` · ${lk.provider.get(r.providerId ?? '')?.name ?? r.providerLabel}` : ' · Direct'}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !ok} onClick={save}>{busy ? 'Saving…' : 'Save custom commission'}</Button></>}>
      <div className="space-y-4">
        <Alert tone="info">A custom commission applies to this agency only. It replaces their current agreement on this record and never changes the master tier rates.</Alert>
        <Field label="Partner agency" required>
          <Select value={f.partner} searchable onChange={(e) => setF({ ...f, partner: e.target.value })}>
            <option value="">Choose agency</option>
            {db.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Tier label" hint={standard ? `Standard ${lk.tier.get(f.tier)?.label} rate: ${fmtCommission(standard.valueKind, standard.value, standard.currency, standard.rawValue)}` : undefined}>
          <Segmented value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={data.tiers.filter((t) => t.active).map((t) => ({ value: t.id, label: t.label }))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type"><Segmented value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'percent', label: 'Percentage' }, { value: 'amount', label: 'Fixed amount' }]} /></Field>
          <Field label={f.kind === 'percent' ? 'Percent' : 'Amount'} required error={f.value && !valueOk ? (f.kind === 'percent' ? '0–100, up to 4 decimals' : 'Up to 4 decimals') : undefined}>
            <Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.trim() })} placeholder={f.kind === 'percent' ? 'e.g. 17.5' : 'e.g. 3500'} />
          </Field>
          {f.kind === 'amount' && <Field label="Currency" required error={f.currency && !/^[A-Z]{3}$/.test(f.currency) ? '3-letter code' : undefined}><Input value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder="GBP" /></Field>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid from"><DatePicker value={f.from} onChange={(v) => setF({ ...f, from: v ?? '' })} /></Field>
          <Field label="Valid until"><DatePicker value={f.to} min={f.from || undefined} onChange={(v) => setF({ ...f, to: v ?? '' })} /></Field>
        </div>
        <Field label="Conditions shown to the agency" hint="Optional"><Textarea rows={2} maxLength={1000} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
        <Field label="Internal remark" required hint="Why this agency has a custom agreement — never shown to them"><Textarea rows={2} maxLength={1000} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RecordEditor({ value, data, lk, caps, onClose }: { value: Partial<CommissionRecord> | null; data: Data; lk: Lk; caps: Caps; onClose: () => void }) {
  const toast = useToast();
  const [r, setR] = useState<Partial<CommissionRecord>>({});
  const [tiers, setTiers] = useState<Record<string, { raw: string; kind: ValueKind; value: string; currency: string; note: string }>>({});
  const [internal, setInternal] = useState({ receivedRaw: '', receivedKind: 'percent' as ValueKind, receivedValue: '', marginRaw: '', marginKind: 'percent' as ValueKind, marginValue: '', notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!value) return;
    setR(value);
    const t: typeof tiers = {};
    for (const tier of data.tiers) {
      const rate: TierRate | undefined = value.id ? lk.rate(value.id, tier.id) : undefined;
      t[tier.id] = { raw: rate?.rawValue ?? '', kind: rate?.valueKind ?? 'percent', value: rate?.value ?? '', currency: rate?.currency ?? '', note: rate?.note ?? '' };
    }
    setTiers(t);
    const i = value.id ? lk.internal.get(value.id) : undefined;
    setInternal({ receivedRaw: i?.receivedRaw ?? '', receivedKind: i?.receivedKind ?? 'percent', receivedValue: i?.receivedValue ?? '', marginRaw: i?.marginRaw ?? '', marginKind: i?.marginKind ?? 'percent', marginValue: i?.marginValue ?? '', notes: i?.internalNotes ?? '' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const tierErr = Object.values(tiers).some((t) => t.kind !== 'unclear' && t.value !== '' && !DECIMAL.test(t.value));
  const ok = r.countryId && (r.universityName ?? '').trim().length >= 2 && (r.route === 'direct' || r.providerId || (r.providerLabel ?? '').trim()) && !tierErr;
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    const res = await rpc<string>('save_commission_record', {
      p_id: r.id ?? null,
      p_record: { country_id: r.countryId, university_name: r.universityName, university_id: r.universityId ?? null, intake: r.intake ?? '', study_level: r.studyLevel ?? '',
        variant: r.variant ?? '', student_market: r.studentMarket ?? '', route: r.route ?? 'portal', provider_id: r.providerId ?? '', provider_label: r.providerLabel ?? '',
        currency: r.currency ?? '', conditions: r.conditions ?? '', effective_from: r.effectiveFrom ?? '', effective_to: r.effectiveTo ?? '', status: r.status ?? 'active',
        needs_review: !!r.needsReview, review_notes: r.reviewNotes ?? '' },
      p_tiers: Object.entries(tiers).filter(([, t]) => t.raw || t.value).map(([id, t]) => ({ tier_id: id, raw_value: t.raw || t.value, value_kind: t.value ? t.kind : 'unclear', value: t.value || null,
        currency: t.kind === 'amount' ? t.currency || r.currency || null : null, note: t.note || null, needs_review: !t.value })),
      p_internal: caps.internal ? { received_raw: internal.receivedRaw, received_kind: internal.receivedValue ? internal.receivedKind : 'unclear', received_value: internal.receivedValue || null,
        margin_raw: internal.marginRaw, margin_kind: internal.marginValue ? internal.marginKind : 'unclear', margin_value: internal.marginValue || null, internal_notes: internal.notes } : null,
    });
    setBusy(false);
    if (!res.ok) return toast.error('Not saved', res.error);
    toast.success(r.id ? 'Record saved' : 'Record created', r.id ? 'The previous version is kept.' : undefined);
    onClose();
  };
  const kindSel = (v: ValueKind, on: (k: ValueKind) => void) => (
    <Select value={v} onChange={(e) => on(e.target.value as ValueKind)}><option value="percent">%</option><option value="amount">Amount</option><option value="unclear">Unclear</option></Select>
  );
  return (
    <Modal open onClose={onClose} size="xl" title={r.id ? 'Edit commission record' : 'New commission record'} subtitle="Partner agreements on standard tiers follow these rates. Custom agreements are not changed."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !ok} onClick={save}>{busy ? 'Saving…' : 'Save record'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Country" required><Select value={r.countryId ?? ''} onChange={(e) => setR({ ...r, countryId: e.target.value })}><option value="">Choose</option>{data.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="University" required className="sm:col-span-2"><Input value={r.universityName ?? ''} maxLength={200} onChange={(e) => setR({ ...r, universityName: e.target.value })} /></Field>
          <Field label="Intake"><Input value={r.intake ?? ''} maxLength={200} onChange={(e) => setR({ ...r, intake: e.target.value })} /></Field>
          <Field label="Level"><Input value={r.studyLevel ?? ''} maxLength={40} onChange={(e) => setR({ ...r, studyLevel: e.target.value })} placeholder="UG / PG" /></Field>
          <Field label="Campus / programme"><Input value={r.variant ?? ''} maxLength={120} onChange={(e) => setR({ ...r, variant: e.target.value })} /></Field>
          <Field label="Route"><Segmented value={r.route ?? 'portal'} onChange={(v) => setR({ ...r, route: v })} options={[{ value: 'direct', label: 'Direct' }, { value: 'portal', label: 'Portal' }]} /></Field>
          {r.route !== 'direct' && <Field label="Portal provider" required><Select value={r.providerId ?? ''} onChange={(e) => setR({ ...r, providerId: e.target.value || null, providerLabel: data.providers.find((p) => p.id === e.target.value)?.name ?? r.providerLabel })}><option value="">Choose</option>{data.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
          <Field label="Currency" error={r.currency && !/^[A-Z]{3}$/.test(r.currency) ? '3-letter code' : undefined}><Input value={r.currency ?? ''} maxLength={3} onChange={(e) => setR({ ...r, currency: e.target.value.toUpperCase() || null })} placeholder="GBP" /></Field>
          <Field label="Valid from"><DatePicker value={r.effectiveFrom ?? ''} onChange={(v) => setR({ ...r, effectiveFrom: v })} /></Field>
          <Field label="Valid until"><DatePicker value={r.effectiveTo ?? ''} onChange={(v) => setR({ ...r, effectiveTo: v })} /></Field>
          <Field label="Status"><Segmented value={r.status ?? 'active'} onChange={(v) => setR({ ...r, status: v })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} /></Field>
        </div>
        <Field label="Conditions shown to agencies" hint="Optional — never put SSI GLOBAL's own terms here"><Textarea rows={2} maxLength={1000} value={r.conditions ?? ''} onChange={(e) => setR({ ...r, conditions: e.target.value })} /></Field>
        <Card>
          <CardHeader title="Partner tier rates" subtitle="Percent as a number (17.5 = 17.5%). Exact decimals, up to 4 places." />
          <div className="space-y-3 px-5 pb-5">
            {data.tiers.map((t) => { const v = tiers[t.id] ?? { raw: '', kind: 'percent' as ValueKind, value: '', currency: '', note: '' }; const set = (p: Partial<typeof v>) => setTiers({ ...tiers, [t.id]: { ...v, ...p } }); return (
              <div key={t.id} className="grid items-end gap-3 sm:grid-cols-[90px_110px_1fr_90px_1fr]">
                <div className="pb-2.5 text-sm font-semibold text-heading">{t.label}</div>
                <Field label="Type">{kindSel(v.kind, (k) => set({ kind: k }))}</Field>
                <Field label="Value" error={v.value && !DECIMAL.test(v.value) ? 'Number' : undefined}><Input inputMode="decimal" value={v.value} onChange={(e) => set({ value: e.target.value.trim() })} /></Field>
                <Field label="Currency"><Input value={v.currency} maxLength={3} disabled={v.kind !== 'amount'} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></Field>
                <Field label="Note (partner can see)"><Input value={v.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} /></Field>
              </div>
            ); })}
          </div>
        </Card>
        {caps.internal && (
          <Card className="border-brand-300">
            <CardHeader title={<span className="inline-flex items-center gap-1.5"><Lock className="h-4 w-4 text-rust" /> Internal — confidential</span>} />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
              <Field label="SSI GLOBAL receives — as written"><Input value={internal.receivedRaw} onChange={(e) => setInternal({ ...internal, receivedRaw: e.target.value })} /></Field>
              <Field label="Type">{kindSel(internal.receivedKind, (k) => setInternal({ ...internal, receivedKind: k }))}</Field>
              <Field label="Value" error={internal.receivedValue && !DECIMAL.test(internal.receivedValue) ? 'Number' : undefined}><Input inputMode="decimal" value={internal.receivedValue} onChange={(e) => setInternal({ ...internal, receivedValue: e.target.value.trim() })} /></Field>
              <Field label="Profit — as written"><Input value={internal.marginRaw} onChange={(e) => setInternal({ ...internal, marginRaw: e.target.value })} /></Field>
              <Field label="Type">{kindSel(internal.marginKind, (k) => setInternal({ ...internal, marginKind: k }))}</Field>
              <Field label="Value" error={internal.marginValue && !DECIMAL.test(internal.marginValue) ? 'Number' : undefined}><Input inputMode="decimal" value={internal.marginValue} onChange={(e) => setInternal({ ...internal, marginValue: e.target.value.trim() })} /></Field>
              <Field label="Internal notes" className="sm:col-span-3"><Textarea rows={2} maxLength={2000} value={internal.notes} onChange={(e) => setInternal({ ...internal, notes: e.target.value })} /></Field>
            </div>
          </Card>
        )}
        <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
          <Checkbox checked={!!r.needsReview} onCheckedChange={(v) => setR({ ...r, needsReview: v })} label="Needs review" />
          <Input value={r.reviewNotes ?? ''} maxLength={1000} onChange={(e) => setR({ ...r, reviewNotes: e.target.value })} placeholder="What to check" />
        </div>
        {tierErr && <p className="text-xs text-red-600">Fix the highlighted tier values.</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ agreements

function Agreements({ data, lk, caps, partnerName, staffName }: { data: Data; lk: Lk; caps: Caps; partnerName: (id: string) => string; staffName: (id: string | null) => string }) {
  const { db, session } = useStore();
  const me = session?.userId;
  const toast = useToast();
  const [partner, setPartner] = useState('');
  const [status, setStatus] = useState('active');
  const [tier, setTier] = useState('');
  const [country, setCountry] = useState('');
  const [type, setType] = useState('');
  const [decide, setDecide] = useState<{ a: PartnerAssignment; approve: boolean; note: string } | null>(null);
  const [ending, setEnding] = useState<{ a: PartnerAssignment; note: string } | null>(null);
  const [custom, setCustom] = useState<{ record: CommissionRecord; partnerId?: string } | null>(null);
  const rows = data.assignments.filter((a) => (!partner || a.partnerId === partner) && (!status || (status === 'open' ? a.status === 'active' || a.status === 'pending_approval' : a.status === status))
    && (!tier || a.tierId === tier) && (!country || lk.record.get(a.recordId)?.countryId === country) && (!type || (type === 'custom' ? a.isCustom : !a.isCustom)));
  const paged = usePaged(rows, 25, `${partner}${status}${tier}${country}${type}`);
  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const r = await rpc(fn, args);
    if (!r.ok) { toast.error('Not saved', r.error); return false; }
    toast.success(ok);
    return true;
  };
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <FilterSelect label="Agency" value={partner} onChange={setPartner} options={[{ value: '', label: 'All agencies' }, ...db.partners.map((p) => ({ value: p.id, label: p.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'pending_approval', label: 'Waiting for approval' }, { value: 'open', label: 'Active + waiting' }, { value: 'inactive', label: 'Ended' }, { value: 'rejected', label: 'Rejected' }, { value: '', label: 'All' }]} />
          <FilterSelect label="Tier" value={tier} onChange={setTier} options={[{ value: '', label: 'All tiers' }, ...data.tiers.map((t) => ({ value: t.id, label: t.label }))]} />
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: '', label: 'Standard & custom' }, { value: 'standard', label: 'Standard tier' }, { value: 'custom', label: 'Custom' }]} />
          <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...data.countries.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        {rows.length === 0 ? <EmptyState icon={Link2} title="No agreements" description={caps.tag ? 'Tag an agency from Commission records.' : undefined} /> : (
          <>
            <Table className="hr-table" head={['Agency', 'University / route', 'Tier', 'Partner commission', 'Valid', 'Status', 'Tagged by', '']}>
              {paged.rows.map((a) => {
                const r = lk.record.get(a.recordId);
                const rate = lk.rate(a.recordId, a.tierId);
                return (
                  <tr key={a.id}>
                    <td className="font-medium text-heading">{partnerName(a.partnerId)}</td>
                    <td className="min-w-[200px]">{r?.universityName ?? '—'}<div className="text-xs text-ink-mute">{r ? (r.route === 'direct' ? 'Direct' : lk.provider.get(r.providerId ?? '')?.name ?? r.providerLabel) : ''}{r?.variant ? ` · ${r.variant}` : ''}{r?.studyLevel ? ` · ${r.studyLevel}` : ''}</div></td>
                    <td>{lk.tier.get(a.tierId)?.label}{a.isCustom && <Badge tone="orange" className="ml-1">Custom</Badge>}</td>
                    <td className="whitespace-nowrap tabular-nums">{a.isCustom ? fmtCommission(a.customKind, a.customValue, a.customCurrency) : fmtCommission(rate?.valueKind, rate?.value, rate?.currency, rate?.rawValue)}</td>
                    <td className="whitespace-nowrap text-xs">{a.validFrom || a.validTo ? `${a.validFrom ?? '…'} – ${a.validTo ?? '…'}` : 'Open-ended'}</td>
                    <td><Badge tone={statusTone[a.status]}>{statusLabel[a.status]}</Badge>{a.decisionNote && <div className="mt-0.5 max-w-[160px] truncate text-xs text-ink-mute">{a.decisionNote}</div>}</td>
                    <td className="whitespace-nowrap text-xs text-ink-soft">{staffName(a.assignedBy)}<div>{new Date(a.assignedAt).toLocaleDateString('en-GB')}</div></td>
                    <td className="whitespace-nowrap text-right">
                      {a.status === 'pending_approval' && caps.manage && <>
                        <Button size="sm" variant="ghost" icon={XCircle} aria-label="Reject" onClick={() => setDecide({ a, approve: false, note: '' })} />
                        <Button size="sm" icon={CheckCircle2} onClick={() => setDecide({ a, approve: true, note: '' })}>Approve</Button>
                      </>}
                      {a.status === 'active' && caps.manage && r && <Button size="sm" variant="ghost" onClick={() => setCustom({ record: r, partnerId: a.partnerId })}>Custom…</Button>}
                      {(a.status === 'active' && caps.manage) || (a.status === 'pending_approval' && (caps.manage || a.assignedBy === me)) ? <Button size="sm" variant="ghost" onClick={() => setEnding({ a, note: '' })}>{a.status === 'active' ? 'End' : 'Withdraw'}</Button> : null}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="agreements" />
          </>
        )}
      </Card>
      <Modal open={!!decide} onClose={() => setDecide(null)} size="sm" title={decide?.approve ? 'Approve change' : 'Reject change'} subtitle={decide ? partnerName(decide.a.partnerId) : undefined}
        footer={<><Button variant="secondary" onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.approve ? 'primary' : 'danger'} disabled={!decide?.approve && (decide?.note.trim().length ?? 0) < 3}
          onClick={async () => { if (decide && await run('decide_partner_commission', { p_id: decide.a.id, p_approve: decide.approve, p_note: decide.note || null }, decide.approve ? 'Change approved' : 'Change rejected')) setDecide(null); }}>{decide?.approve ? 'Approve' : 'Reject'}</Button></>}>
        {decide?.approve && <p className="mb-3 text-sm text-ink-soft">The agency's current agreement on this record ends and {lk.tier.get(decide.a.tierId)?.label} applies straight away.</p>}
        <Field label="Note" required={!decide?.approve}><Input maxLength={300} value={decide?.note ?? ''} onChange={(e) => setDecide((x) => (x ? { ...x, note: e.target.value } : x))} /></Field>
      </Modal>
      <Modal open={!!ending} onClose={() => setEnding(null)} size="sm" title={ending?.a.status === 'active' ? 'End agreement' : 'Withdraw request'} subtitle={ending ? partnerName(ending.a.partnerId) : undefined}
        footer={<><Button variant="secondary" onClick={() => setEnding(null)}>Cancel</Button><Button variant="danger" disabled={(ending?.note.trim().length ?? 0) < 3}
          onClick={async () => { if (ending && await run('deactivate_partner_commission', { p_id: ending.a.id, p_reason: ending.note }, 'Agreement ended')) setEnding(null); }}>Confirm</Button></>}>
        <p className="mb-3 text-sm text-ink-soft">The agency no longer sees this rate. The agreement stays in the history.</p>
        <Field label="Reason" required><Input maxLength={300} value={ending?.note ?? ''} onChange={(e) => setEnding((x) => (x ? { ...x, note: e.target.value } : x))} /></Field>
      </Modal>
      <CustomModal value={custom} data={data} lk={lk} onClose={() => setCustom(null)} />
    </>
  );
}

// ------------------------------------------------------------------ import

function ImportSheet({ data, staffName }: { data: Data; staffName: (id: string | null) => string }) {
  const toast = useToast();
  const [country, setCountry] = useState(data.countries[0]?.name ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [parse, setParse] = useState<CommissionParse | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setParse(null); setPreview(null); setConfirm(false); setErr(null); };
  const read = async (f: File) => {
    reset();
    setFile(f);
    if (f.size > MAX_IMPORT_BYTES) return setErr('The file is larger than 5 MB.');
    try {
      const p = parseCommissionSheet(readWorkbook(new Uint8Array(await f.arrayBuffer())), country || 'Country');
      setParse(p);
      if (p.errors.length) setErr(p.errors.join(' '));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The file could not be read.');
    }
  };
  const runPreview = async () => {
    if (!file || country.trim().length < 2) return;
    setBusy(true);
    const p = parseCommissionSheet(readWorkbook(new Uint8Array(await file.arrayBuffer())), country.trim());
    setParse(p);
    const r = await rpc<Record<string, unknown>>('preview_commission_import', { p_country_name: country.trim(), p_rows: p.rows });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setPreview(r.data);
  };
  const apply = async () => {
    if (!parse || !file) return;
    setBusy(true);
    const r = await rpc<{ new: number; changed: number }>('apply_commission_import', { p_country_name: country.trim(), p_file_name: file.name, p_sheet_name: parse.sheet, p_rows: parse.rows, p_confirm_partner_changes: confirm });
    setBusy(false);
    if (!r.ok) return setErr(r.error.replace(/^CONFIRM_PARTNER_CHANGES:\s*/, ''));
    toast.success('Commission sheet imported', `${r.data.new} new and ${r.data.changed} changed record(s). Previous versions are kept.`);
    reset();
    setFile(null);
  };
  const counts = (preview?.counts ?? {}) as Record<string, number>;
  const changed = ((preview?.rows ?? []) as { source_row: number; university: string; provider?: string; status: string; changes?: { field: string; from: string | null; to: string | null; internal?: boolean; tier?: boolean }[]; standard_assignments?: number; custom_assignments?: number }[]);
  const affected = Number(preview?.affected_standard_assignments ?? 0);
  const notInSheet = (preview?.not_in_sheet ?? []) as { id: string; university: string; provider: string | null }[];
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h3 className="mb-1 font-display text-[15px] font-semibold text-heading">Import a commission sheet</h3>
        <p className="mb-4 text-sm text-ink-soft">Upload the commission workbook (.xlsx — in Google Sheets: File → Download → Microsoft Excel). Every column is kept with its original header. Nothing changes until you confirm, partner custom agreements are never changed, and previous versions are kept.</p>
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Field label="Destination country" required hint="The sheet does not say which country its universities are in.">
            <Input value={country} list="commission-countries" maxLength={80} onChange={(e) => { setCountry(e.target.value); setPreview(null); }} placeholder="e.g. United Kingdom" />
            <datalist id="commission-countries">{data.countries.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Workbook" required>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 text-sm text-ink-soft transition hover:border-brand-300 focus-within:ring-2 focus-within:ring-brand-300">
              <FileSpreadsheet className="h-5 w-5 text-rust" />
              <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choose an .xlsx file…'}</span>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
            </label>
          </Field>
        </div>
        {err && <Alert tone="error" className="mt-4">{err}</Alert>}
        {parse && !parse.errors.length && (
          <div className="mt-4 space-y-3">
            <div className="text-sm text-ink-soft">Sheet <b className="text-heading">{parse.sheet}</b> · {parse.rows.length} commission rows · {parse.rows.filter((r) => r.needs_review).length} to review</div>
            <div className="flex flex-wrap gap-1.5">{parse.headers.map((h) => <Badge key={h.column} tone={h.role === 'other' ? 'slate' : h.role === 'received' || h.role === 'margin' ? 'orange' : 'navy'}>{h.column}: {h.header} → {roleLabel(h.role)}</Badge>)}</div>
            <Button icon={Eye} disabled={busy || country.trim().length < 2} onClick={() => void runPreview()}>{busy && !preview ? 'Checking…' : 'Preview changes'}</Button>
          </div>
        )}
      </Card>

      {preview && (
        <Card className="p-5">
          <h3 className="mb-3 font-display text-[15px] font-semibold text-heading">Preview</h3>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KPI icon={Plus} tone="green" label="New records" value={counts.new ?? 0} />
            <KPI icon={Pencil} tone="amber" label="Changed records" value={counts.changed ?? 0} />
            <KPI icon={CheckCircle2} label="Unchanged" value={counts.unchanged ?? 0} />
            <KPI icon={AlertTriangle} tone="red" label="Standard agreements affected" value={affected} />
          </div>
          {(preview.country as { new: boolean; name: string })?.new && <Alert tone="info" className="mb-3">New country: <b>{(preview.country as { name: string }).name}</b> will be added.</Alert>}
          {((preview.new_providers as string[]) ?? []).length > 0 && <Alert tone="info" className="mb-3">New portals: {(preview.new_providers as string[]).map((p) => p.toUpperCase()).join(', ')}</Alert>}
          {((preview.new_universities as string[]) ?? []).length > 0 && <Alert tone="info" className="mb-3">New universities: {(preview.new_universities as string[]).join(', ')}</Alert>}
          {parse && parse.rows.some((r) => r.needs_review) && (
            <Alert tone="warning" className="mb-3" title={`${parse.rows.filter((r) => r.needs_review).length} row(s) will be marked “Needs review”`}>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{parse.rows.filter((r) => r.needs_review).map((r) => <li key={r.source_row_number}>Row {r.source_row_number} · {r.university_name}: {r.review_notes}</li>)}</ul>
            </Alert>
          )}
          {notInSheet.length > 0 && <Alert tone="warning" className="mb-3">{notInSheet.length} active record(s) of this country are not in the new sheet. They are kept as they are — deactivate them in Commission records if they no longer apply.</Alert>}
          {changed.filter((r) => r.status === 'changed').length > 0 && (
            <Table className="hr-table" head={['Row', 'University', 'Changes', 'Agreements']}>
              {changed.filter((r) => r.status === 'changed').map((r) => (
                <tr key={r.source_row}>
                  <td>{r.source_row}</td>
                  <td className="font-medium text-heading">{r.university}<div className="text-xs text-ink-mute">{r.provider}</div></td>
                  <td>{(r.changes ?? []).map((c, i) => <div key={i} className="text-xs"><b className={cn(c.internal && 'text-rust')}>{c.field}{c.internal ? ' (internal)' : ''}:</b> {c.from ?? '—'} → {c.to ?? '—'}</div>)}</td>
                  <td className="text-xs">{r.standard_assignments ?? 0} standard · {r.custom_assignments ?? 0} custom (unchanged)</td>
                </tr>
              ))}
            </Table>
          )}
          {changed.some((r) => r.status === 'duplicate_in_sheet') && <Alert tone="warning" className="mt-3">Some rows appear twice in the sheet; only the first is imported.</Alert>}
          {affected > 0 && <div className="mt-4"><Checkbox checked={confirm} onCheckedChange={setConfirm} label={`I confirm the new tier rates for ${affected} agency agreement(s) on standard tiers`} description="Their partner rates change as soon as the import is applied. Custom agreements are not changed." /></div>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>Cancel</Button>
            <Button icon={Upload} disabled={busy || (affected > 0 && !confirm) || ((counts.new ?? 0) + (counts.changed ?? 0) === 0)} onClick={() => void apply()}>{busy ? 'Importing…' : 'Confirm import'}</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Import history" />
        {data.imports.length === 0 ? <EmptyState icon={History} title="No imports yet" /> : (
          <Table className="hr-table" head={['When', 'File', 'Country', 'Rows', 'Result', 'By']}>
            {data.imports.map((i) => {
              const c = (i.summary?.counts ?? {}) as Record<string, number>;
              return (
                <tr key={i.id}>
                  <td className="whitespace-nowrap">{new Date(i.importedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="font-medium text-heading">{i.fileName}<div className="text-xs text-ink-mute">{i.sheetName}</div></td>
                  <td>{data.countries.find((x) => x.id === i.countryId)?.name ?? i.countryId}</td>
                  <td>{i.rowCount}</td>
                  <td className="text-xs">{c.new ?? 0} new · {c.changed ?? 0} changed · {c.unchanged ?? 0} unchanged</td>
                  <td>{staffName(i.importedBy)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
const roleLabel = (r: string) => ({ university: 'University / intake', market: 'Student market', received: 'SSI receives (internal)', portal: 'Portal', tier_1: 'Tier 1', margin: 'Profit (internal)', tier_2: 'Tier 2', tier_3: 'Tier 3', other: 'Kept as source data' } as Record<string, string>)[r] ?? r;

// ------------------------------------------------------------------ setup

function Setup({ data }: { data: Data }) {
  const toast = useToast();
  const [prov, setProv] = useState('');
  const [ctry, setCtry] = useState('');
  const write = async (table: string, op: 'insert' | 'update', row: Record<string, unknown>, id?: string, ok?: string) => {
    if (!supabase) return false;
    const q = supabase.from(table);
    const res = op === 'insert' ? await q.insert(row).select() : await q.update(row).eq('id', id ?? '').select();
    if (res.error || !(res.data ?? []).length) { toast.error('Not saved', res.error ? serverMessage(res.error) : 'You do not have permission to change this.'); return false; }
    if (ok) toast.success(ok);
    return true;
  };
  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card>
        <CardHeader title="Countries" subtitle="A country appears in filters once it has records or is added here" />
        <div className="flex gap-2 px-5 pb-3">
          <Input value={ctry} maxLength={80} onChange={(e) => setCtry(e.target.value)} placeholder="e.g. Canada" />
          <Button icon={Plus} disabled={ctry.trim().length < 2 || data.countries.some((c) => c.id === slug(ctry))} onClick={async () => { if (await write('commission_countries', 'insert', { id: slug(ctry), name: ctry.trim() }, undefined, 'Country added')) setCtry(''); }}>Add</Button>
        </div>
        <ul className="divide-y divide-line">{data.countries.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-5 py-2.5 text-sm"><span className="font-medium text-heading">{c.name}</span>
            <Checkbox checked={c.active} onCheckedChange={(v) => void write('commission_countries', 'update', { active: v }, c.id)} label="Active" /></li>
        ))}</ul>
      </Card>
      <Card>
        <CardHeader title="Portal providers" subtitle="Names as they appear in the sheet" />
        <div className="flex gap-2 px-5 pb-3">
          <Input value={prov} maxLength={120} onChange={(e) => setProv(e.target.value)} placeholder="Provider name" />
          <Button icon={Plus} disabled={!prov.trim() || data.providers.some((p) => p.name.toLowerCase() === prov.trim().toLowerCase())} onClick={async () => { if (await write('commission_providers', 'insert', { name: prov.trim() }, undefined, 'Portal added')) setProv(''); }}>Add</Button>
        </div>
        <ul className="divide-y divide-line">{data.providers.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-sm"><span className="font-medium text-heading">{p.name}</span>
            <Checkbox checked={p.active} onCheckedChange={(v) => void write('commission_providers', 'update', { active: v }, p.id)} label="Active" /></li>
        ))}</ul>
      </Card>
      <Card>
        <CardHeader title="Commission tiers" subtitle="Partner payout levels (not employee grades)" />
        <ul className="divide-y divide-line">{data.tiers.map((t) => <TierRow key={t.id} id={t.id} label={t.label} description={t.description} onSave={(row) => write('commission_tiers', 'update', row, t.id, 'Tier saved')} />)}</ul>
      </Card>
    </div>
  );
}
function TierRow({ id, label, description, onSave }: { id: string; label: string; description: string | null; onSave: (row: Record<string, unknown>) => Promise<boolean> }) {
  const [l, setL] = useState(label);
  const [d, setD] = useState(description ?? '');
  const dirty = l !== label || d !== (description ?? '');
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex gap-2"><Input value={l} maxLength={40} aria-label={`${id} label`} onChange={(e) => setL(e.target.value)} />{dirty && <Button size="sm" disabled={l.trim().length < 2} onClick={() => void onSave({ label: l.trim(), description: d.trim() || null })}>Save</Button>}</div>
      <Input value={d} maxLength={300} onChange={(e) => setD(e.target.value)} placeholder="What this tier means (optional)" />
    </li>
  );
}
