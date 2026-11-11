// Partner Portal → Commission (Partner Admin only). Read-only list of the commission agreements
// SSI GLOBAL has assigned to this organisation: the one rate that applies (the assigned tier, or a
// custom agreement). The server returns nothing else — no other tiers, no SSI GLOBAL values, no
// other agencies. A configured rate is not an earned or paid commission.
import { useMemo, useState } from 'react';
import { BadgePercent, Info } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, FilterSelect, PageHeader, SearchInput, Table } from '../../components/ui';
import { useStore } from '../../store/store';
import { ROUTE_LABEL, fmtCommission, useMyCommissions } from '../../lib/commissions';
import { matches } from '../../lib/utils';

export default function MyCommission() {
  const { session } = useStore();
  const allowed = session?.role === 'client' && session.userRole === 'partner_admin' && !!session.commission;
  const { rows, error } = useMyCommissions(allowed);
  const [country, setCountry] = useState('');
  const [route, setRoute] = useState('');
  const [q, setQ] = useState('');
  const countries = useMemo(() => [...new Set((rows ?? []).map((r) => r.country))].sort(), [rows]);
  const shown = (rows ?? []).filter((r) => (!country || r.country === country) && (!route || r.route === route) && matches(q, r.university, r.provider ?? '', r.intake ?? '', r.variant ?? ''));

  if (!allowed) return <Card><EmptyState icon={BadgePercent} title="Commission is not available" description="Only your organisation's Partner Admin can see commission agreements." /></Card>;
  return (
    <>
      <PageHeader title="Commission" subtitle="Commission agreements SSI GLOBAL has set up for your organisation." />
      <Alert tone="info" className="mb-4"><span className="inline-flex items-start gap-1.5"><Info className="mt-0.5 h-4 w-4 shrink-0" />These are agreed rates, not earnings. Commission is earned and paid per enrolled student, as shown in Finance.</span></Alert>
      {error && <Alert tone="warning" className="mb-4">Commission agreements could not be loaded right now.</Alert>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search university or portal…" className="w-full sm:w-64" />
          <FilterSelect label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries.map((c) => ({ value: c, label: c }))]} />
          <FilterSelect label="Route" value={route} onChange={setRoute} options={[{ value: '', label: 'Direct & portal' }, { value: 'direct', label: 'Direct' }, { value: 'portal', label: 'Through a portal' }]} />
        </div>
        {rows === null ? <div className="p-6 text-sm text-ink-soft">Loading…</div> : shown.length === 0 ? (
          <EmptyState icon={BadgePercent} title={rows.length ? 'Nothing matches' : 'No commission agreements yet'} description={rows.length ? undefined : 'Your SSI GLOBAL Partnership Officer will set these up.'} />
        ) : (
          <Table className="hr-table" head={['University', 'Route', 'Your tier', 'Your commission', 'Conditions', 'Valid']}>
            {shown.map((r) => (
              <tr key={r.assignmentId}>
                <td className="min-w-[200px]">
                  <div className="font-medium text-heading">{r.university}</div>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-ink-mute">{r.country}{r.intake ? ` · ${r.intake}` : ''}{r.studyLevel && <Badge tone="slate">{r.studyLevel}</Badge>}{r.variant && <Badge tone="slate">{r.variant}</Badge>}</div>
                </td>
                <td>{r.route === 'direct' ? ROUTE_LABEL.direct : <>{r.provider ?? 'Portal'}<div className="text-xs text-ink-mute">Portal</div></>}</td>
                <td>{r.tier}{r.isCustom && <Badge tone="orange" className="ml-1">Custom agreement</Badge>}</td>
                <td className="whitespace-nowrap font-semibold tabular-nums text-heading">{fmtCommission(r.commissionKind, r.commissionValue, r.currency, r.rawValue)}</td>
                <td className="max-w-[260px] whitespace-pre-wrap text-xs text-ink-soft">{r.conditions || '—'}</td>
                <td className="whitespace-nowrap text-xs">{r.validFrom || r.validTo ? `${r.validFrom ?? '…'} – ${r.validTo ?? '…'}` : 'Until changed'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
