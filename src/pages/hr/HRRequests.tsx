// HR queues for early checkouts and attendance corrections: pending approvals and history.
import { Badge, Card, EmptyState, PageHeader, Table } from '../../components/ui';
import { ApprovalsPanel, ExportButtons, requestTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { CORRECTION_LABEL, companyTime, fmtDay } from '../../data/hr';
import { FilePen, LogOut } from 'lucide-react';

export function HREarlyCheckout() {
  const { data, setting } = useHR();
  const lk = useHRLookup();
  const limit = Number(setting<number>('early_checkout_monthly_limit', 2));
  return (
    <>
      <PageHeader title="Early Checkout" subtitle={`Emergencies only · reason and manager approval required · ${limit} per employee per month; exceptions need an HR override and are audited.`}
        actions={<ExportButtons filename="ssi-early-checkouts" rows={() => data.earlyCheckouts.map((r) => ({ Employee: lk.name(r.employeeId), Date: r.workDate, 'Requested time': companyTime(r.requestedTime), Reason: r.reason, Status: r.status, 'Decided by': r.decidedBy ? lk.name(r.decidedBy) : '', Exception: r.override ? r.overrideReason : '', 'Actual checkout': companyTime(r.actualCheckoutAt) }))} />} />
      <ApprovalsPanel kinds={['early']} />
      <Card className="mt-6">
        {data.earlyCheckouts.length === 0 ? <EmptyState icon={LogOut} title="No early checkout requests" /> : (
          <Table className="hr-table" head={['Employee', 'Date', 'Leave at', 'Reason', 'Status', 'Approved by', 'Actual checkout', 'Month usage']}>
            {data.earlyCheckouts.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-heading">{lk.name(r.employeeId)}</td>
                <td>{fmtDay(r.workDate)}</td>
                <td>{companyTime(r.requestedTime)}</td>
                <td className="max-w-[240px] truncate text-ink-soft">{r.reason}</td>
                <td><Badge tone={requestTone[r.status]}>{r.status}</Badge>{r.override && <Badge tone="violet" className="ml-1" >Exception</Badge>}</td>
                <td>{r.decidedBy ? lk.name(r.decidedBy) : '—'}</td>
                <td>{companyTime(r.actualCheckoutAt)}</td>
                <td>{data.earlyCheckouts.filter((x) => x.employeeId === r.employeeId && x.status === 'Approved' && x.workDate.slice(0, 7) === r.workDate.slice(0, 7)).length} / {limit}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export function HRCorrections() {
  const { data } = useHR();
  const lk = useHRLookup();
  const orig = (v: unknown) => companyTime((v as string | null) ?? null);
  return (
    <>
      <PageHeader title="Attendance Corrections" subtitle="Original punch times are never overwritten; approved times are stored next to them and used for totals."
        actions={<ExportButtons filename="ssi-attendance-corrections" rows={() => data.corrections.map((c) => ({ Employee: lk.name(c.employeeId), Date: c.workDate, Type: CORRECTION_LABEL[c.correctionType], 'Requested in': companyTime(c.requestedInAt), 'Requested out': companyTime(c.requestedOutAt), 'Requested break (min)': c.requestedBreakMinutes ?? '', Reason: c.reason, Status: c.status, 'Decided by': c.decidedBy ? lk.name(c.decidedBy) : '', 'Decided at': c.decidedAt ?? '' }))} />} />
      <ApprovalsPanel kinds={['corrections']} />
      <Card className="mt-6">
        {data.corrections.length === 0 ? <EmptyState icon={FilePen} title="No correction requests" /> : (
          <Table className="hr-table" head={['Employee', 'Date', 'Type', 'Original (in / out)', 'Corrected (in / out / break)', 'Reason', 'Status', 'Decided by']}>
            {data.corrections.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-heading">{lk.name(c.employeeId)}</td>
                <td className="whitespace-nowrap">{fmtDay(c.workDate)}</td>
                <td>{CORRECTION_LABEL[c.correctionType]}</td>
                <td className="text-ink-soft">{c.original ? `${orig(c.original.punch_in_at)} / ${orig(c.original.punch_out_at)}` : 'No record'}</td>
                <td>{c.applied ? `${orig(c.applied.corrected_in_at)} / ${orig(c.applied.corrected_out_at)} / ${c.applied.corrected_break_minutes ?? '—'}` : `${companyTime(c.requestedInAt)} / ${companyTime(c.requestedOutAt)} / ${c.requestedBreakMinutes ?? '—'}`}</td>
                <td className="max-w-[220px] truncate text-ink-soft">{c.reason}</td>
                <td><Badge tone={requestTone[c.status]}>{c.status}</Badge></td>
                <td>{c.decidedBy ? `${lk.name(c.decidedBy)} · ${new Date(c.decidedAt!).toLocaleDateString('en-GB')}` : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
