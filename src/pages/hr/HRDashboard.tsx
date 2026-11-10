// HR dashboard: overview cards, quick actions, pending leave, birthdays and anniversaries, today's
// workforce by group, monthly figures, trends and reminders.
// Every figure is computed from records the database returned for this user.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Briefcase, Laptop, Upload, Building2, Cake, CalendarClock, ClipboardCheck, ClipboardList, Clock, Coffee, Download, FilePen, LogOut, Palmtree, PartyPopper, Timer, UserCheck, UserMinus, UserPlus, Users, UserX } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, FilterSelect, Table } from '../../components/ui';
import { ApprovalsPanel, KPI, stateTone } from '../../components/hr';
import { useStore } from '../../store/store';
import { cn, greeting } from '../../lib/utils';
import { EmployeeProfileModal, useMonthSummaries } from '../../components/hrProfile';
import { useHR, useHRLookup } from '../../store/hr';
import { supabase } from '../../auth/auth';
import { addDays, companyDate, fmtDay, fmtDays, hm, type Reminder } from '../../data/hr';

type WorkforceGroup = 'in' | 'break' | 'out' | 'leave' | 'absent' | 'late' | 'early';
const chip = 'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-brand-300 hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300';
const chipOn = 'border-brand-300 bg-brand-50 text-heading dark:bg-brand-500/10';
const reminderIcon = { birthday: Cake, anniversary: PartyPopper, probation: CalendarClock, leave: Palmtree, holiday: PartyPopper };

export default function HRDashboard() {
  const { data, now, call } = useHR();
  const lk = useHRLookup();
  const navigate = useNavigate();
  const [date, setDate] = useState(companyDate(now()));
  const [dept, setDept] = useState('');
  const [desig, setDesig] = useState('');
  const [mgr, setMgr] = useState('');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [group, setGroup] = useState<WorkforceGroup | null>(null);
  const { session } = useStore();
  const canAccounts = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('hr_accounts');
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    // Today's reminder notifications are created once per day (idempotent on the server).
    void call('send_hr_reminders', {}, { quiet: true });
    void supabase.rpc('hr_reminders', { p_days: 30 }).then(({ data: r }) => {
      if (alive) setReminders(((r ?? []) as Record<string, string>[]).map((x) => ({ kind: x.kind, onDate: x.on_date, employeeId: x.employee_id, title: x.title, detail: x.detail }) as Reminder));
    });
    return () => {
      alive = false;
    };
  }, [call, data.employees.length, data.holidays.length]);

  const staff = useMemo(() => data.directory.filter((e) =>
    (!dept || e.departmentId === dept) && (!desig || e.designationId === desig) && (!mgr || e.reportingManagerId === mgr)), [data.directory, dept, desig, mgr]);
  const ids = new Set(staff.map((s) => s.id));
  const current = staff.filter((s) => s.employmentStatus !== 'Resigned' && s.accountStatus === 'active');
  const att = data.attendance.filter((a) => a.workDate === date && ids.has(a.employeeId));
  const onLeave = new Set(data.leaveRequests.filter((r) => r.status === 'Approved' && date >= r.startDate && date <= r.endDate).map((r) => r.employeeId));
  const absent = current.filter((s) => !att.some((a) => a.employeeId === s.id) && !onLeave.has(s.id));
  const month = date.slice(0, 7);
  const monthMinutes = data.attendance.filter((a) => a.workDate.slice(0, 7) === month && ids.has(a.employeeId)).reduce((s, a) => s + (a.netMinutes ?? 0), 0);
  const expectedReporters = current.filter((s) => lk.designation.get(s.designationId)?.reportTemplate);
  const reportsToday = data.reports.filter((r) => r.reportDate === date && ids.has(r.employeeId) && r.status !== 'Draft');
  const pendingLeave = data.leaveRequests.filter((r) => r.status === 'Pending' && ids.has(r.employeeId)).length;
  const pendingCorr = data.corrections.filter((r) => r.status === 'Pending' && ids.has(r.employeeId)).length;
  const pendingEarly = data.earlyCheckouts.filter((r) => r.status === 'Pending' && ids.has(r.employeeId)).length;

  // Last 14 days: present vs reports submitted (real records only).
  const trend = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = addDays(date, i - 13);
    return {
      day: d.slice(8),
      Present: data.attendance.filter((a) => a.workDate === d && ids.has(a.employeeId)).length,
      Reports: data.reports.filter((r) => r.reportDate === d && ids.has(r.employeeId) && r.status !== 'Draft').length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data.attendance, data.reports, date, staff]);
  const byDept = data.departments.map((d) => ({
    name: d.name,
    Present: att.filter((a) => lk.employee.get(a.employeeId)?.departmentId === d.id).length,
    Employees: current.filter((s) => s.departmentId === d.id).length,
  })).filter((x) => x.Employees > 0);
  const go = (p: string) => navigate(p);
  const balances = data.balances.filter((b) => ids.has(b.employeeId));
  const paidTypes = data.leaveTypes.filter((t) => t.active && t.paid !== false);
  const summaries = useMonthSummaries(month);
  const monthPresent = current.reduce((s, e) => s + (summaries.get(e.id)?.presentDays ?? 0), 0);
  const monthLop = current.reduce((s, e) => s + (summaries.get(e.id)?.lopDays ?? 0), 0);
  // Today's status per person: attendance state, Morning / Afternoon / full-day leave, or absent.
  const leaveToday = (id: string) => data.leaveRequests.filter((r) => r.status === 'Approved' && r.employeeId === id && date >= r.startDate && date <= r.endDate);
  const statusOf = (id: string) => {
    const a = att.find((x) => x.employeeId === id);
    const lv = leaveToday(id);
    const half = lv.find((r) => r.halfDaySession);
    const leaveLabel = lv.length ? (half && lv.length === 1 ? (half.halfDaySession === 'morning' ? 'Morning Leave' : 'Afternoon Leave') : 'On leave') : null;
    if (a) return { label: leaveLabel ? `${a.state} · ${leaveLabel}` : a.state, tone: stateTone[a.state] };
    if (leaveLabel) return { label: leaveLabel, tone: 'blue' as const };
    return { label: date === companyDate(now()) ? 'Not checked in' : 'Absent', tone: 'red' as const };
  };

  // Today's workforce groups (clicking a group filters the list below).
  const groups: { id: WorkforceGroup; label: string; icon: typeof Users; tone: 'navy' | 'green' | 'amber' | 'red' | 'orange'; ids: Set<string> }[] = [
    { id: 'in', label: 'Checked in', icon: UserCheck, tone: 'green', ids: new Set(att.filter((a) => a.state === 'Checked In').map((a) => a.employeeId)) },
    { id: 'break', label: 'On break', icon: Coffee, tone: 'amber', ids: new Set(att.filter((a) => a.state === 'On Break').map((a) => a.employeeId)) },
    { id: 'out', label: 'Checked out', icon: LogOut, tone: 'navy', ids: new Set(att.filter((a) => a.state !== 'Checked In' && a.state !== 'On Break').map((a) => a.employeeId)) },
    { id: 'leave', label: 'On leave', icon: Palmtree, tone: 'navy', ids: new Set(current.filter((s) => onLeave.has(s.id)).map((s) => s.id)) },
    { id: 'absent', label: date === companyDate(now()) ? 'Not checked in' : 'Absent', icon: UserX, tone: 'red', ids: new Set(absent.map((s) => s.id)) },
    { id: 'late', label: 'Late arrivals', icon: Timer, tone: 'orange', ids: new Set(att.filter((a) => a.late).map((a) => a.employeeId)) },
    { id: 'early', label: 'Early checkouts', icon: LogOut, tone: 'orange', ids: new Set(att.filter((a) => a.earlyCheckout).map((a) => a.employeeId)) },
  ];
  const shown = group ? current.filter((s) => groups.find((g) => g.id === group)!.ids.has(s.id)) : current;
  const newThisMonth = current.filter((s) => (lk.employee.get(s.id)?.joiningDate ?? '').startsWith(month));
  const pendingReview = data.attendance.filter((a) => a.reviewStatus === 'pending_review' && ids.has(a.employeeId)).length;
  const exceptions = pendingCorr + pendingEarly + pendingReview;
  const celebrations = reminders.filter((r) => r.kind === 'birthday' || r.kind === 'anniversary');
  const daysUntil = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${companyDate(now())}T00:00:00Z`)) / 86_400_000);
  const firstName = (session?.name ?? '').split(' ')[0];

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-navy-600 to-navy p-6 text-white shadow-card sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#FBA51E]">{greeting()}{firstName ? `, ${firstName}` : ''}</p>
            <h1 className="mt-1 font-display text-[28px] font-semibold tracking-tight">HR Management</h1>
            <p className="mt-1 text-sm text-white/70">SSI GLOBAL workforce · {fmtDay(date)}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1.5">{current.length} current employees</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">{data.departments.filter((d) => d.active).length} departments</span>
            <span className="rounded-full bg-brand px-3 py-1.5 font-semibold text-navy">{att.length} present</span>
          </div>
        </div>
      </div>

      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <Field label="Date"><DatePicker value={date} clearable={false} onChange={(v) => v && setDate(v)} /></Field>
        <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Designation" value={desig} onChange={setDesig} options={[{ value: '', label: 'All designations' }, ...data.designations.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Reporting manager" value={mgr} onChange={setMgr} options={[{ value: '', label: 'Any manager' }, ...data.directory.filter((d) => data.directory.some((x) => x.reportingManagerId === d.id)).map((d) => ({ value: d.id, label: d.fullName }))]} />
      </Card>

      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">HR overview</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPI icon={Users} label="Total employees" value={current.length} hint={`${staff.length - current.length} inactive or resigned not counted`} onClick={() => go(`../hr/employees${dept ? `?dept=${dept}` : ''}`)} />
        <KPI icon={UserCheck} tone="green" label="Present today" value={att.length} hint="Clocked in at least once" onClick={() => go('../hr/attendance')} />
        <KPI icon={Palmtree} tone="amber" label="On leave" value={current.filter((s) => onLeave.has(s.id)).length} hint={`${current.filter((s) => leaveToday(s.id).some((r) => r.halfDaySession)).length} on a half day`} onClick={() => go('../hr/leave-calendar')} />
        <KPI icon={UserPlus} tone="navy" label="New employees" value={newThisMonth.length} hint="Joined this month" onClick={() => go('../hr/employees?joined=month')} />
        <KPI icon={CalendarClock} tone="orange" label="Pending leave requests" value={pendingLeave} hint="Requires approval" onClick={() => go('../hr/leave')} />
        <KPI icon={AlertTriangle} tone="red" label="Attendance exceptions" value={exceptions} hint={`${pendingCorr} corrections · ${pendingEarly} early · ${pendingReview} auto clock-out`} onClick={() => go('../hr/exceptions')} />
      </div>

      <h2 className="mb-3 mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">Quick actions</h2>
      <div className="flex flex-wrap gap-2.5">
        {canAccounts && <Button icon={UserPlus} onClick={() => go('../hr/employees?add=1')}>Add employee</Button>}
        <Button variant="secondary" icon={Palmtree} onClick={() => go('../hr/leave?record=1')}>Add leave</Button>
        <Button variant="secondary" icon={ClipboardCheck} onClick={() => go('../hr/attendance')}>Mark attendance</Button>
        <Button variant="secondary" icon={FilePen} onClick={() => go('../hr/exceptions')}>Review exceptions</Button>
        <Button variant="secondary" icon={Briefcase} onClick={() => go('../hr/work')}>Assign work</Button>
        <Button variant="secondary" icon={Laptop} onClick={() => go('../hr/assets?add=1')}>Add asset</Button>
        <Button variant="secondary" icon={Upload} onClick={() => go('../hr/documents?upload=1')}>Upload employee document</Button>
        <Button variant="secondary" icon={CalendarClock} onClick={() => go('../hr/workforce-calendar')}>Workforce calendar</Button>
        {canAccounts && <Button variant="secondary" icon={Building2} onClick={() => go('../hr/departments')}>Departments</Button>}
        <Button variant="secondary" icon={Download} onClick={() => go('../hr/reports')}>HR reports</Button>
      </div>

      <div className="mt-7 grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">Pending leave requests</h2>
          <ApprovalsPanel kinds={['leave']} />
        </div>
        <div className="xl:col-span-2">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">Upcoming birthdays &amp; anniversaries</h2>
          <Card>
            {celebrations.length === 0 ? <EmptyState icon={Cake} title="Nothing in the next 30 days" description="Birthdays need a date of birth on the employee record." /> : (
              <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                {celebrations.slice(0, 10).map((r, i) => {
                  const n = daysUntil(r.onDate);
                  const Icon = reminderIcon[r.kind];
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => r.employeeId && setProfile(r.employeeId)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-canvas focus:outline-none focus-visible:bg-canvas">
                        <Avatar name={r.employeeId ? lk.name(r.employeeId) : r.title} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-heading">{r.employeeId ? lk.name(r.employeeId) : r.title}</span>
                          <span className="flex items-center gap-1 truncate text-xs text-ink-soft"><Icon className="h-3.5 w-3.5 text-rust" />{r.kind === 'birthday' ? 'Birthday' : 'Work anniversary'} · {fmtDay(r.onDate)}{r.detail ? ` · ${r.detail}` : ''}</span>
                        </span>
                        <Badge tone={n <= 0 ? 'orange' : 'slate'}>{n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-7">
        <CardHeader title="Today's workforce" subtitle={`${fmtDay(date)} · choose a group to filter, click a person for their profile`}
          action={<Button size="sm" variant="secondary" onClick={() => go('../hr/employees')}>View all employees</Button>} />
        <div className="flex flex-wrap gap-2 px-5 pb-4">
          <button type="button" onClick={() => setGroup(null)} className={cn(chip, !group && chipOn)}>All <b>{current.length}</b></button>
          {groups.map((g) => (
            <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(group === g.id ? null : g.id)} className={cn(chip, group === g.id && chipOn)}>
              <g.icon className="h-3.5 w-3.5" /> {g.label} <b>{g.ids.size}</b>
            </button>
          ))}
        </div>
        {shown.length === 0 ? <EmptyState icon={Users} title={group ? 'Nobody in this group' : 'No employees'} /> : (
          <ul className="grid gap-2 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => {
              const st = statusOf(s.id);
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setProfile(s.id)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-brand-300 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                    <Avatar name={s.fullName} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-heading">{s.fullName}</span>
                      <span className="block truncate text-xs text-ink-mute">{lk.designation.get(s.designationId)?.name ?? ''}</span>
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <h2 className="mb-3 mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute">This month</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPI icon={Clock} label={`Net hours · ${month}`} value={hm(monthMinutes)} />
        <KPI icon={UserCheck} tone="green" label={`Present days · ${month}`} value={fmtDays(monthPresent)} hint={`LOP ${fmtDays(monthLop)} day(s) · half days count 0.5`} />
        <KPI icon={Timer} tone="amber" label="On probation" value={staff.filter((s) => s.employmentStatus === 'Probation').length} onClick={() => go('../hr/employees?status=Probation')} />
        <KPI icon={ClipboardCheck} tone="green" label="Daily reports submitted" value={reportsToday.length} onClick={() => go('../hr/work-reports')} />
        <KPI icon={ClipboardList} tone="red" label="Daily reports pending" value={Math.max(0, expectedReporters.filter((s) => !onLeave.has(s.id)).length - new Set(reportsToday.map((r) => r.employeeId)).size)} />
        <KPI icon={UserMinus} label="Resigned" value={staff.filter((s) => s.employmentStatus === 'Resigned').length} onClick={() => go('../hr/employees?status=Resigned')} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2 p-5">
          <h3 className="mb-3 font-display text-[15px] font-semibold text-heading">Attendance and reports · last 14 days</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'rgb(var(--ink-soft))' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'rgb(var(--ink-soft))' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="Present" fill="#06242F" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Reports" fill="#FBA51E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Reminders" subtitle="Next 30 days" action={<button type="button" className="text-xs font-semibold text-rust hover:underline" onClick={() => go('../hr/reminders')}>All</button>} />
          {reminders.length === 0 ? <EmptyState icon={Cake} title="No reminders" /> : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {reminders.slice(0, 12).map((r, i) => {
                const Icon = reminderIcon[r.kind];
                return (
                  <li key={i} className="flex items-center gap-3 px-5 py-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-rust" />
                    <div className="min-w-0"><div className="truncate text-sm font-medium text-heading">{r.title}</div><div className="text-xs text-ink-soft">{fmtDay(r.onDate)}{r.detail ? ` · ${r.detail}` : ''}</div></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="By department" subtitle={fmtDay(date)} />
          {byDept.length === 0 ? <EmptyState icon={Users} title="No employees" /> : (
            <Table className="hr-table" head={['Department', 'Employees', 'Present']}>
              {byDept.map((d) => <tr key={d.name}><td className="font-medium text-heading">{d.name}</td><td>{d.Employees}</td><td>{d.Present}</td></tr>)}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Leave balances" subtitle="Available this leave year" action={<button type="button" className="text-xs font-semibold text-rust hover:underline" onClick={() => go('../hr/leave')}>Manage</button>} />
          {balances.length === 0 ? <EmptyState icon={Palmtree} title="No balances yet" /> : (
            <Table className="hr-table" head={['Employee', ...paidTypes.map((t) => t.name)]}>
              {[...new Set(balances.map((b) => b.employeeId))].slice(0, 10).map((id) => (
                <tr key={id}>
                  <td><button type="button" className="font-medium text-heading hover:text-rust hover:underline" onClick={() => setProfile(id)}>{lk.name(id)}</button></td>
                  {paidTypes.map((t) => {
                    const b = balances.find((x) => x.employeeId === id && x.leaveType === t.id);
                    return <td key={t.id}>{b ? `${fmtDays(b.available)}${b.pending ? ` (${fmtDays(b.pending)} pending)` : ''}` : '—'}</td>;
                  })}
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <EmployeeProfileModal employeeId={profile} onClose={() => setProfile(null)} />
    </>
  );
}
