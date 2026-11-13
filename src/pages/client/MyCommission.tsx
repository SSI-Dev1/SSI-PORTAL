// Partner Portal → Commission (Partner Admin only). Read-only list of the commission agreements
// SSI GLOBAL has agreed with this organisation: for each university, the commission the partner
// receives, currency, conditions and validity. The server returns nothing else — not SSI GLOBAL's
// internal tier classification, no other rates, routes or portals, no SSI GLOBAL values (0037).
// A configured rate is not an earned or paid commission.
import { useMemo, useState } from 'react';
import { BadgePercent, Eye, Info, Lock, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, FilterSelect, PageHeader, SearchInput, Table } from '../../components/ui';
import { useScoped, useStore } from '../../store/store';
import { canSeePartnerCommission } from '../../auth/roles';
import { fmtCommission, useMyCommissions } from '../../lib/commissions';
import { matches } from '../../lib/utils';

export default function MyCommission() {
  const { session } = useStore();
  const scoped = useScoped();
  const allowed = canSeePartnerCommission(session);
  // Staff previewing a partner's portal see exactly that partner's view (same restricted columns).
  const previewPartner = session?.previewOf ? session.partnerId : undefined;
  const { rows, error, reload } = useMyCommissions(allowed, previewPartner);
  const [country, setCountry] = useState('');
  const [q, setQ] = useState('');
  const countries = useMemo(() => [...new Set((rows ?? []).map((r) => r.country))].sort(), [rows]);
  const shown = (rows ?? []).filter((r) => (!country || r.country === country) && matches(q, r.university, r.variant ?? '', r.studyLevel ?? ''));

  if (!allowed) return <Card><EmptyState icon={Lock} title="Commission is not available" description="Only your organisation's Partner Admin can see commission agreements." /></Card>;
  return (
    <>
      <PageHeader title="Commission" subtitle="The commission SSI GLOBAL has agreed with your organisation, university by university." />
      <Alert tone="info" className="mb-4"><span className="inline-flex items-start gap-1.5"><Info className="mt-0.5 h-4 w-4 shrink-0" />These are agreed rates, not earnings. Commission is earned and paid per enrolled student, as shown in Finance.</span></Alert>
      {previewPartner && (
        <Alert tone="warning" className="mb-4"><span className="inline-flex items-start gap-1.5"><Eye className="mt-0.5 h-4 w-4 shrink-0" />
          Preview: this is exactly what {scoped.partner?.name ?? 'this partner'}'s Partner Admin sees.
          {scoped.partner?.commissionVisible === false && ' Commission is currently hidden from this partner, so their Partner Admin sees no Commission tab.'}</span></Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4"><span className="flex flex-wrap items-center gap-2">Commission details could not be loaded. Please try again in a moment.
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void reload()}>Try again</Button></span></Alert>
      )}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search university…" className="w-full sm:w-64" />
          <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries.map((c) => ({ value: c, label: c }))]} />
          {rows && rows.length > 0 && <span className="ml-auto self-center text-xs text-ink-mute">{shown.length} of {rows.length} universities</span>}
        </div>
        {rows === null ? <div className="p-6 text-sm text-ink-soft" role="status">Loading commission details…</div> : error ? (
          <EmptyState icon={BadgePercent} title="Commission details are unavailable" description="Nothing is shown until they load correctly." />
        ) : shown.length === 0 ? (
          <EmptyState icon={BadgePercent} title={rows.length ? 'Nothing matches your filters' : 'No commission details have been assigned to your organization yet.'} description={rows.length ? undefined : 'Your SSI GLOBAL Partnership Officer will set these up. They appear here as soon as they are assigned.'} />
        ) : (
          <Table className="hr-table" head={['University', 'Country', 'My commission', 'Currency', 'Applicable conditions', 'Valid']}>
            {shown.map((r) => (
              <tr key={r.assignmentId}>
                <td className="min-w-[220px]">
                  <div className="font-medium text-heading">{r.university}</div>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-ink-mute">
                    {r.studyLevel && <Badge tone="slate">{r.studyLevel}</Badge>}{r.variant && <Badge tone="slate">{r.variant}</Badge>}
                    {r.intake && <span>{r.intake}</span>}
                  </div>
                </td>
                <td>{r.country}</td>
                <td className="whitespace-nowrap font-semibold tabular-nums text-heading">{fmtCommission(r.commissionKind, r.commissionValue, r.currency)}</td>
                <td>{r.commissionKind === 'amount' ? r.currency ?? 'Not stated' : '—'}</td>
                <td className="max-w-[280px] whitespace-pre-wrap text-xs text-ink-soft">{r.conditions || '—'}</td>
                <td className="whitespace-nowrap text-xs text-ink-soft">{r.validFrom || r.validTo ? `${r.validFrom ?? '…'} – ${r.validTo ?? '…'}` : 'Open-ended'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
