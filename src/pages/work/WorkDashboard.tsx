// Employee workspace home: attendance, today's daily report(s), leave and holidays, plus a
// performance summary from the employee's own submitted reports (and their team's, for managers).
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CheckCircle2, ClipboardList, FileClock, Palmtree, PartyPopper, TrendingUp, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState } from '../../components/ui';
import { KPI, PunchCard, reportTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { companyDate, fmtDay, hm } from '../../data/hr';
import { greeting } from '../../lib/utils';

export default function WorkDashboard() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const navigate = useNavigate();
  const base = session?.role === 'admin' ? '/admin' : '/staff';
  const me = session?.userId;
  const today = companyDate(now());
  const month = today.slice(0, 7);
  const mine = data.reports.filter((r) => r.employeeId === me);
  const myAttendance = data.attendance.filter((a) => a.employeeId === me && a.workDate.slice(0, 7) === month);
  const monthNet = myAttendance.reduce((s, a) => s + (a.netMinutes ?? 0), 0);
  const balances = data.balances.filter((b) => b.employeeId === me);
  const pendingMine = data.leaveRequests.filter((r) => r.employeeId === me && r.status === 'Pending').length
    + data.corrections.filter((r) => r.employeeId === me && r.status === 'Pending').length
    + data.earlyCheckouts.filter((r) => r.employeeId === me && r.status === 'Pending').length;
  const holidays = data.holidays.filter((h) => h.active && h.holidayDate >= today).slice(0, 4);
  const team = useMemo(() => {
    const ids = new Set<string>();
    const walk = (m: string) => data.employees.filter((e) => e.reportingManagerId === m && !ids.has(e.id)).forEach((e) => { ids.add(e.id); walk(e.id); });
    if (me) walk(me);
    return ids;
  }, [data.employees, me]);
  const teamToday = data.attendance.filter((a) => team.has(a.employeeId) && a.workDate === today);
  const teamReportsToday = data.reports.filter((r) => team.has(r.employeeId) && r.reportDate === today && r.status !== 'Draft');
  const awaiting = data.reports.filter((r) => team.has(r.employeeId) && (r.status === 'Submitted' || r.status === 'Reviewed')).length
    + data.leaveRequests.filter((r) => team.has(r.employeeId) && r.status === 'Pending').length
    + data.earlyCheckouts.filter((r) => team.has(r.employeeId) && r.status === 'Pending').length
    + data.corrections.filter((r) => team.has(r.employeeId) && r.status === 'Pending').length;

  // Month totals of my submitted figures, per template field (actual saved reports only).
  const totals = useMemo(() => {
    const out: { template: string; label: string; value: number }[] = [];
    for (const t of data.myTemplates) {
      const rs = mine.filter((r) => r.templateId === t.id && r.reportDate.slice(0, 7) === month && r.status !== 'Draft');
      const fields = t.sections.flatMap((s) => s.fields.filter((f) => f.type === 'count'));
      fields.slice(0, 6).forEach((f) => out.push({ template: t.designation, label: f.label, value: rs.reduce((s, r) => s + (r.metrics[f.key] ?? 0), 0) }));
    }
    return out;
  }, [data.myTemplates, mine, month]);

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-heading">{greeting()}, {session?.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-ink-soft">{session?.title} · {fmtDay(today)}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1"><PunchCard compact /></div>
        <Card className="xl:col-span-2">
          <CardHeader title="Today's daily report" subtitle="One report per designation and day" action={<Button size="sm" variant="secondary" onClick={() => navigate(`${base}/work/reports`)}>History</Button>} />
          {data.myTemplates.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No daily report for your designation" description="HR or Admin can assign a designation with a report template." />
          ) : (
            <ul className="divide-y divide-line">
              {data.myTemplates.map((t) => {
                const r = mine.find((x) => x.templateId === t.id && x.reportDate === today);
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="font-semibold text-heading">{t.designation}</div>
                      <div className="text-xs text-ink-soft">{t.sections.length} sections</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r ? <Badge tone={reportTone[r.status]} dot>{r.status}</Badge> : <Badge tone="slate">Not started</Badge>}
                      <Button size="sm" onClick={() => navigate(`${base}/work/report?template=${t.id}&date=${today}`)}>
                        {!r ? 'Start report' : r.status === 'Draft' || r.status === 'Correction Requested' ? 'Continue' : 'View'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI icon={TrendingUp} tone="navy" label="Net hours this month" value={hm(monthNet)} hint={`${myAttendance.length} day(s) attended`} onClick={() => navigate(`${base}/work/attendance`)} />
        {balances.map((b) => (
          <KPI key={b.leaveType} icon={Palmtree} tone="green" label={`${b.name} available`} value={b.available} hint={b.pending ? `${b.pending} pending` : `${b.used} used`} onClick={() => navigate(`${base}/work/leave`)} />
        ))}
        <KPI icon={FileClock} tone="amber" label="My requests pending" value={pendingMine} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="My performance this month" subtitle="Totals from your submitted daily reports" />
          {totals.length === 0 || totals.every((t) => t.value === 0) ? (
            <EmptyState icon={CheckCircle2} title="No submitted figures yet this month" />
          ) : (
            <div className="grid gap-3 p-5 pt-0 sm:grid-cols-2 lg:grid-cols-3">
              {totals.map((t) => (
                <div key={t.template + t.label} className="rounded-xl border border-line p-3">
                  <div className="font-display text-xl font-semibold text-heading">{t.value}</div>
                  <div className="text-xs text-ink-soft">{t.label}</div>
                  {data.myTemplates.length > 1 && <div className="text-[10px] text-ink-mute">{t.template}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming holidays" action={<Button size="sm" variant="secondary" onClick={() => navigate(`${base}/work/holidays`)}>Calendar</Button>} />
          {holidays.length === 0 ? <EmptyState icon={CalendarDays} title="No upcoming holidays" /> : (
            <ul className="divide-y divide-line">
              {holidays.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                  <PartyPopper className="h-4 w-4 text-rust" />
                  <div><div className="font-medium text-heading">{h.name}</div><div className="text-xs text-ink-soft">{fmtDay(h.holidayDate)} · {h.kind}</div></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {session?.hasTeam && (
        <Card className="mt-6">
          <CardHeader title="My team today" subtitle={`${team.size} people report to you`} action={<Button size="sm" onClick={() => navigate(`${base}/work/team`)}>Team & approvals{awaiting ? ` (${awaiting})` : ''}</Button>} />
          <div className="grid grid-cols-2 gap-3 p-5 pt-0 lg:grid-cols-4">
            <KPI icon={Users} label="Checked in" tone="green" value={teamToday.filter((a) => a.state === 'Checked In').length} />
            <KPI icon={Users} label="On break" tone="amber" value={teamToday.filter((a) => a.state === 'On Break').length} />
            <KPI icon={ClipboardList} label="Reports submitted today" tone="navy" value={teamReportsToday.length} />
            <KPI icon={FileClock} label="Waiting for you" tone="orange" value={awaiting} />
          </div>
          {teamToday.length > 0 && (
            <p className="px-5 pb-5 text-xs text-ink-soft">Late today: {teamToday.filter((a) => a.late).map((a) => lk.name(a.employeeId)).join(', ') || 'nobody'}</p>
          )}
        </Card>
      )}
    </>
  );
}
