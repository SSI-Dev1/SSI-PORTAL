// Employee workspace home. Attendance actions live in the top navigation; this page shows the
// day's report, the work actually recorded today (CRM actions + Quick Log), current workload,
// the month's recorded work, leave, holidays and recent activity — all from saved records.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CalendarDays, CheckCircle2, ClipboardList, FileStack, ListTodo, Palmtree, PartyPopper, PenLine, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState } from '../../components/ui';
import { KPI, QuickLogModal, reportTone } from '../../components/hr';
import { useHR } from '../../store/hr';
import { useStore } from '../../store/store';
import { companyDate, companyTime, fmtDay } from '../../data/hr';
import { greeting } from '../../lib/utils';

const OPEN = ['Draft', 'Pending Assessment', 'Submitted', 'Offer Pending', 'Conditional Offer', 'Unconditional Offer', 'Visa Lodged'];
const STAGES: [string, string[]][] = [
  ['Preparing', ['Draft', 'Pending Assessment']],
  ['Awaiting decision', ['Submitted', 'Offer Pending']],
  ['Offer', ['Conditional Offer', 'Unconditional Offer']],
  ['Visa', ['Visa Lodged']],
];
// Assignment and the generic status record are context, not completed work of their own.
const NOT_COMPLETED_WORK = ['application_received', 'application_status'];

export default function WorkDashboard() {
  const { data, now } = useHR();
  const { session, db } = useStore();
  const navigate = useNavigate();
  const [logOpen, setLogOpen] = useState(false);
  const base = session?.role === 'admin' ? '/admin' : '/staff';
  const me = session?.userId;
  const today = companyDate(now());
  const month = today.slice(0, 7);
  const mine = useMemo(() => data.activities.filter((a) => a.employeeId === me && !a.voidedAt), [data.activities, me]);
  const todayWork = mine.filter((a) => a.reportDate === today);
  const completedToday = todayWork.filter((a) => !NOT_COMPLETED_WORK.includes(a.activityType)).reduce((s, a) => s + a.quantity, 0);
  const appsProcessed = new Set(todayWork.filter((a) => a.activityType === 'application_status').map((a) => a.applicationId)).size;
  const myTasks = db.tasks.filter((t) => t.assignedTo === me && !t.done);
  const myApps = db.applications.filter((a) => a.assignedTo === me && OPEN.includes(a.status));
  const reports = data.reports.filter((r) => r.employeeId === me);
  const balances = data.balances.filter((b) => b.employeeId === me);
  const holidays = data.holidays.filter((h) => h.active && h.holidayDate >= today).slice(0, 4);
  const typeLabel = (t: string) => data.activityTypes.find((x) => x.id === t)?.label ?? t;
  const monthTotals = useMemo(() => {
    const m = new Map<string, number>();
    mine.filter((a) => a.reportDate.slice(0, 7) === month && !NOT_COMPLETED_WORK.includes(a.activityType)).forEach((a) => m.set(a.activityType, (m.get(a.activityType) ?? 0) + a.quantity));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [mine, month]);
  const maxMonth = Math.max(1, ...monthTotals.map(([, v]) => v));
  const team = useMemo(() => {
    const ids = new Set<string>();
    const walk = (m: string) => data.employees.filter((e) => e.reportingManagerId === m && !ids.has(e.id)).forEach((e) => { ids.add(e.id); walk(e.id); });
    if (me) walk(me);
    return ids;
  }, [data.employees, me]);
  const awaiting = data.reports.filter((r) => team.has(r.employeeId) && (r.status === 'Submitted' || r.status === 'Reviewed')).length
    + data.leaveRequests.filter((r) => team.has(r.employeeId) && r.status === 'Pending').length
    + data.earlyCheckouts.filter((r) => team.has(r.employeeId) && r.status === 'Pending').length
    + data.corrections.filter((r) => team.has(r.employeeId) && r.status === 'Pending').length;
  const loggable = [...new Set(data.metricSources.filter((x) => data.myTemplates.some((t) => t.id === x.templateId)).flatMap((x) => x.activityTypes))]
    .filter((t) => data.activityTypes.find((a) => a.id === t)?.source === 'logged');

  return (
    <>
      {/* TOP: greeting + today's report */}
      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col justify-center">
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-heading">{greeting()}, {session?.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-ink-soft">{session?.title} · {fmtDay(today)}</p>
          {loggable.length > 0 && (
            <div className="mt-4"><Button variant="secondary" icon={PenLine} onClick={() => setLogOpen(true)}>Log work done outside the CRM</Button></div>
          )}
        </div>
        <Card>
          <CardHeader title="Today's daily report" subtitle="Figures fill in from your recorded work" action={<Button size="sm" variant="secondary" onClick={() => navigate(`${base}/work/reports`)}>History</Button>} />
          {data.myTemplates.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No daily report for your designation" description="HR or Admin can assign a designation with a report template." />
          ) : (
            <ul className="divide-y divide-line">
              {data.myTemplates.map((t) => {
                const r = reports.find((x) => x.templateId === t.id && x.reportDate === today);
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <div className="font-semibold text-heading">{t.designation}</div>
                      <div className="text-xs text-ink-soft">{r?.submittedAt ? `Submitted ${companyTime(r.submittedAt)}` : `${todayWork.length} recorded item(s) today`}</div>
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

      {/* SECOND: today's work and current workload */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI icon={CheckCircle2} tone="orange" label="Completed activities today" value={completedToday} hint="CRM actions + logged work" onClick={() => navigate(`${base}/work/report`)} />
        <KPI icon={FileStack} tone="navy" label="Applications processed today" value={appsProcessed} hint="status changes you made" onClick={() => navigate(`${base}/applications`)} />
        <KPI icon={ListTodo} tone="amber" label="Pending assigned tasks" value={myTasks.length} onClick={() => navigate(`${base}/tasks`)} />
        <KPI icon={Activity} tone="green" label="Open applications assigned to you" value={myApps.length}
          hint={STAGES.map(([l, st]) => `${myApps.filter((a) => st.includes(a.status)).length} ${l.toLowerCase()}`).join(' · ')} onClick={() => navigate(`${base}/applications`)} />
      </div>

      {/* THIRD: month, leave, holidays, recent activity */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="My work this month" subtitle="Recorded activities (CRM + logged)" />
          {monthTotals.length === 0 ? <EmptyState icon={Activity} title="No recorded work this month yet" /> : (
            <ul className="space-y-2.5 px-5 pb-5">
              {monthTotals.map(([t, v]) => (
                <li key={t}>
                  <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-soft">{typeLabel(t)}</span><b className="tabular-nums text-heading">{v}</b></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-600" style={{ width: `${(v / maxMonth) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Leave balance" action={<Button size="sm" variant="secondary" onClick={() => navigate(`${base}/work/leave`)}>My leave</Button>} />
            {balances.length === 0 ? <EmptyState icon={Palmtree} title="No balances yet" /> : (
              <ul className="divide-y divide-line">
                {balances.map((b) => (
                  <li key={b.leaveType} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="text-ink-soft">{b.name}</span>
                    <span><b className="font-display text-lg text-heading">{b.available}</b> <span className="text-xs text-ink-mute">available{b.pending ? ` · ${b.pending} pending` : ''}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Upcoming holidays" action={<Button size="sm" variant="secondary" onClick={() => navigate(`${base}/work/holidays`)}>Calendar</Button>} />
            {holidays.length === 0 ? <EmptyState icon={CalendarDays} title="No upcoming holidays" /> : (
              <ul className="divide-y divide-line">
                {holidays.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                    <PartyPopper className="h-4 w-4 text-brand-600" />
                    <div><div className="font-medium text-heading">{h.name}</div><div className="text-xs text-ink-soft">{fmtDay(h.holidayDate)} · {h.kind}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent activity" subtitle="Your latest recorded work" />
        {mine.length === 0 ? <EmptyState icon={Activity} title="Nothing recorded yet" description="Actions you take in the CRM and work you log appear here." /> : (
          <ul className="divide-y divide-line">
            {mine.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-heading">{typeLabel(a.activityType)}{a.quantity > 1 ? ` × ${a.quantity}` : ''}</span>
                  <span className="text-ink-soft">{a.applicationId ? ` · ${db.applications.find((x) => x.id === a.applicationId)?.ref ?? ''}` : ''}{a.note ? ` · ${a.note}` : ''}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-mute">{a.reportDate === today ? companyTime(a.occurredAt) : fmtDay(a.reportDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {session?.hasTeam && (
        <Card className="mt-6">
          <CardHeader title="My team" subtitle={`${team.size} people report to you`} action={<Button size="sm" onClick={() => navigate(`${base}/work/team`)}>Team & approvals{awaiting ? ` (${awaiting})` : ''}</Button>} />
          <div className="grid grid-cols-2 gap-3 p-5 pt-0 lg:grid-cols-3">
            <KPI icon={Users} label="Checked in now" tone="green" value={data.attendance.filter((a) => team.has(a.employeeId) && a.workDate === today && a.state === 'Checked In').length} />
            <KPI icon={ClipboardList} label="Reports submitted today" tone="navy" value={data.reports.filter((r) => team.has(r.employeeId) && r.reportDate === today && r.status !== 'Draft').length} />
            <KPI icon={ClipboardList} label="Waiting for you" tone="orange" value={awaiting} />
          </div>
          <p className="px-5 pb-5 text-xs text-ink-soft">Team members' activities: {data.activities.filter((a) => team.has(a.employeeId) && a.reportDate === today && !a.voidedAt).length} recorded today.</p>
        </Card>
      )}
      <QuickLogModal open={logOpen} onClose={() => setLogOpen(false)} types={loggable} />
    </>
  );
}
