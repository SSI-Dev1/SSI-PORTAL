// My attendance: punch card, monthly hours, corrections and early checkout requests.
import { useMemo, useState } from 'react';
import { Clock, FilePen, LogOut, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Tabs } from '../../components/ui';
import { AttendanceTable, CorrectionRequestModal, EarlyCheckoutModal, KPI, PunchCard, requestTone } from '../../components/hr';
import { useHR } from '../../store/hr';
import { useStore } from '../../store/store';
import { CORRECTION_LABEL, MONTHS_SHORT, companyDate, companyTime, fmtDay, hm } from '../../data/hr';

export default function MyAttendance() {
  const { data, call, now } = useHR();
  const { session } = useStore();
  const me = session?.userId;
  const today = companyDate(now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [tab, setTab] = useState<'days' | 'corrections' | 'early'>('days');
  const [corrOpen, setCorrOpen] = useState(false);
  const [earlyOpen, setEarlyOpen] = useState(false);
  const rows = data.attendance.filter((a) => a.employeeId === me && a.workDate.slice(0, 7) === month);
  const net = rows.reduce((s, a) => s + (a.netMinutes ?? 0), 0);
  const req = rows.filter((a) => a.state === 'Checked Out').reduce((s, a) => s + a.requiredMinutes, 0);
  const done = rows.filter((a) => a.state === 'Checked Out').reduce((s, a) => s + (a.netMinutes ?? 0), 0);
  const months = useMemo(() => {
    const set = new Set([today.slice(0, 7), ...data.attendance.filter((a) => a.employeeId === me).map((a) => a.workDate.slice(0, 7))]);
    return [...set].sort().reverse();
  }, [data.attendance, me, today]);
  const corr = data.corrections.filter((c) => c.employeeId === me);
  const early = data.earlyCheckouts.filter((c) => c.employeeId === me);
  const limit = Number((data.settings.find((s) => s.key === 'early_checkout_monthly_limit')?.value as number | undefined) ?? 2);
  const usedEarly = early.filter((e) => e.status === 'Approved' && e.workDate.slice(0, 7) === today.slice(0, 7)).length;
  const label = (m: string) => `${MONTHS_SHORT[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

  return (
    <>
      <PageHeader title="My Attendance" subtitle="Punch in and out, breaks and working hours. Times are recorded by the server."
        actions={<>
          <Button variant="secondary" icon={LogOut} onClick={() => setEarlyOpen(true)}>Request early checkout</Button>
          <Button variant="secondary" icon={FilePen} onClick={() => setCorrOpen(true)}>Request correction</Button>
        </>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <PunchCard />
        <div className="grid grid-cols-2 gap-3 xl:col-span-2">
          <KPI icon={Clock} label={`Net hours · ${label(month)}`} value={hm(net)} hint={`${rows.length} day(s)`} />
          <KPI icon={done >= req ? TrendingUp : TrendingDown} tone={done >= req ? 'green' : 'red'} label="Against required (completed days)" value={req ? `${done >= req ? '+' : '−'}${hm(Math.abs(done - req))}` : '—'} />
          <KPI icon={Timer} tone="amber" label="Late arrivals" value={rows.filter((a) => a.late).length} />
          <KPI icon={LogOut} tone="orange" label="Early checkouts approved this month" value={`${usedEarly} / ${limit}`} />
        </div>
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-3">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'days', label: 'Daily attendance' },
            { value: 'corrections', label: 'Corrections', count: corr.filter((c) => c.status === 'Pending').length },
            { value: 'early', label: 'Early checkouts', count: early.filter((c) => c.status === 'Pending').length },
          ]} />
          {tab === 'days' && (
            <div className="flex flex-wrap gap-1 pb-2">
              {months.slice(0, 6).map((m) => (
                <Button key={m} size="sm" variant={m === month ? 'primary' : 'secondary'} onClick={() => setMonth(m)}>{label(m)}</Button>
              ))}
            </div>
          )}
        </div>
        <div className="p-5">
          {tab === 'days' && <AttendanceTable rows={rows} />}
          {tab === 'corrections' && (corr.length === 0 ? <EmptyState icon={FilePen} title="No correction requests" /> : (
            <Table className="hr-table" head={['Date', 'Type', 'Requested', 'Reason', 'Status', '']}>
              {corr.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDay(c.workDate)}</td>
                  <td>{CORRECTION_LABEL[c.correctionType]}</td>
                  <td className="text-ink-soft">{[c.requestedInAt && `In ${companyTime(c.requestedInAt)}`, c.requestedOutAt && `Out ${companyTime(c.requestedOutAt)}`, c.requestedBreakMinutes != null && `Break ${c.requestedBreakMinutes}m`].filter(Boolean).join(' · ')}</td>
                  <td className="max-w-[260px] truncate text-ink-soft">{c.reason}</td>
                  <td><Badge tone={requestTone[c.status]}>{c.status}</Badge>{c.decisionComment && <div className="text-[11px] text-ink-mute">{c.decisionComment}</div>}</td>
                  <td className="text-right">{c.status === 'Pending' && <Button size="sm" variant="secondary" onClick={() => call('cancel_attendance_correction', { p_id: c.id }, { refresh: ['corrections'], success: 'Request cancelled' })}>Cancel</Button>}</td>
                </tr>
              ))}
            </Table>
          ))}
          {tab === 'early' && (early.length === 0 ? <EmptyState icon={LogOut} title="No early checkout requests" /> : (
            <Table className="hr-table" head={['Date', 'Leave at', 'Reason', 'Status', 'Actual checkout', '']}>
              {early.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDay(c.workDate)}</td>
                  <td>{companyTime(c.requestedTime)}</td>
                  <td className="max-w-[260px] truncate text-ink-soft">{c.reason}</td>
                  <td><Badge tone={requestTone[c.status]}>{c.status}</Badge>{c.override && <Badge tone="violet" className="ml-1">Exception</Badge>}</td>
                  <td>{companyTime(c.actualCheckoutAt)}</td>
                  <td className="text-right">{c.status === 'Pending' && <Button size="sm" variant="secondary" onClick={() => call('cancel_early_checkout', { p_id: c.id }, { refresh: ['earlyCheckouts'], success: 'Request cancelled' })}>Cancel</Button>}</td>
                </tr>
              ))}
            </Table>
          ))}
        </div>
      </Card>
      <CorrectionRequestModal open={corrOpen} onClose={() => setCorrOpen(false)} />
      <EarlyCheckoutModal open={earlyOpen} onClose={() => setEarlyOpen(false)} />
    </>
  );
}
