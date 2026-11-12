// Partner Portal → Commission (Partner Admin only). Read-only list of the commission agreements
// SSI GLOBAL has assigned to this organisation: for each university, the assigned tier and that
// tier's partner commission (or a custom agreement). The server returns nothing else — no other
// tiers, no processing route or portal, no SSI GLOBAL values, no other agencies (0031).
// A configured rate is not an earned or paid commission.
import { useMemo, useState } from 'react';
import { BadgePercent, Info } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, FilterSelect, PageHeader, SearchInput, Table } from '../../components/ui';
import { useStore } from '../../store/store';
import { fmtCommission, useMyCommissions } from '../../lib/commissions';
import { matches } from '../../lib/utils';

export default function MyCommission() {
  const { session } = useStore();
  const allowed = session?.role === 'client' && session.userRole === 'partner_admin' && !!session.commission;
  const { rows, error } = useMyCommissions(allowed);
  const [country, setCountry] = useState('');
  const [tier, setTier] = useState('');
  const [q, setQ] = useState('');
  const countries = useMemo(() => [...new Set((rows ?? []).map((r) => r.country))].sort(), [rows]);
  const tiers = useMemo(() => [...new Set((rows ?? []).map((r) => r.tier))].sort(), [rows]);
  const shown = (rows ?? []).filter((r) => (!country || r.country === country) && (!tier || r.tier === tier) && matches(q, r.university, r.variant ?? '', r.studyLevel ?? ''));

  if (!allowed) return <Card><EmptyState icon={BadgePercent} title="Commission is not available" description="Only your organisation's Partner Admin can see commission agreements." /></Card>;
  return (
    <>
      <PageHeader title="Commission" subtitle="The commission SSI GLOBAL has agreed with your organisation, university by university." />
      <Alert tone="info" className="mb-4"><span className="inline-flex items-start gap-1.5"><Info className="mt-0.5 h-4 w-4 shrink-0" />These are agreed rates, not earnings. Commission is earned and paid per enrolled student, as shown in Finance.</span></Alert>
      {error && <Alert tone="warning" className="mb-4">Commission agreements could not be loaded right now.</Alert>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search university…" className="w-full sm:w-64" />
          <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries.map((c) => ({ value: c, label: c }))]} />
          <FilterSelect label="Tier" value={tier} onChange={setTier} options={[{ value: '', label: 'All tiers' }, ...tiers.map((t) => ({ value: t, label: t }))]} />
          {rows && rows.length > 0 && <span className="ml-auto self-center text-xs text-ink-mute">{shown.length} of {rows.length} universities</span>}
        </div>
        {rows === null ? <div className="p-6 text-sm text-ink-soft">Loading…</div> : shown.length === 0 ? (
          <EmptyState icon={BadgePercent} title={rows.length ? 'Nothing matches' : 'No commission agreements yet'} description={rows.length ? undefined : 'Your SSI GLOBAL Partnership Officer will set these up.'} />
        ) : (
          <Table className="hr-table" head={['University', 'Country', 'My commission tier', 'My commission', 'Currency', 'Applicable conditions']}>
            {shown.map((r) => (
              <tr key={r.assignmentId}>
                <td className="min-w-[220px]">
                  <div className="font-medium text-heading">{r.university}</div>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-ink-mute">
                    {r.studyLevel && <Badge tone="slate">{r.studyLevel}</Badge>}{r.variant && <Badge tone="slate">{r.variant}</Badge>}
                    {r.intake && <span>{r.intake}</span>}
                    {(r.validFrom || r.validTo) && <span>· valid {r.validFrom ?? '…'} – {r.validTo ?? '…'}</span>}
                  </div>
                </td>
                <td>{r.country}</td>
                <td>{r.tier}{r.isCustom && <Badge tone="orange" className="ml-1">Custom agreement</Badge>}</td>
                <td className="whitespace-nowrap font-semibold tabular-nums text-heading">{fmtCommission(r.commissionKind, r.commissionValue, r.currency)}</td>
                <td>{r.commissionKind === 'amount' ? r.currency ?? 'Not stated' : '—'}</td>
                <td className="max-w-[280px] whitespace-pre-wrap text-xs text-ink-soft">{r.conditions || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
