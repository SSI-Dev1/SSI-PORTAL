// HR dashboard: live headcount, attendance, approvals, daily reports and reminders.
// Every figure is computed from records the database returned for this user.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Cake, CalendarClock, ClipboardCheck, ClipboardList, Clock, Coffee, FilePen, LogOut, Palmtree, PartyPopper, Timer, UserCheck, UserMinus, Users, UserX } from 'lucide-react';
import { Card, CardHeader, DatePicker, EmptyState, Field, FilterSelect, PageHeader, Table } from '../../components/ui';
import { KPI } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { supabase } from '../../auth/auth';
import { addDays, companyDate, fmtDay, hm, type Reminder } from '../../data/hr';

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

  return (
    <>
      <PageHeader title="HR Dashboard" subtitle={`Live workforce overview · ${fmtDay(date)}`} />
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <Field label="Date"><DatePicker value={date} clearable={false} onChange={(v) => v && setDate(v)} /></Field>
        <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Designation" value={desig} onChange={setDesig} options={[{ value: '', label: 'All designations' }, ...data.designations.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Reporting manager" value={mgr} onChange={setMgr} options={[{ value: '', label: 'Any manager' }, ...data.directory.filter((d) => data.directory.some((x) => x.reportingManagerId === d.id)).map((d) => ({ value: d.id, label: d.fullName }))]} />
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KPI icon={Users} label="Total employees" value={staff.length} onClick={() => go('../hr/employees')} />
        <KPI icon={UserCheck} tone="green" label="Active" value={staff.filter((s) => s.employmentStatus === 'Active').length} />
        <KPI icon={Timer} tone="amber" label="On probation" value={staff.filter((s) => s.employmentStatus === 'Probation').length} />
        <KPI icon={Clock} tone="green" label="Present" value={att.length} hint={`${onLeave.size} on leave`} onClick={() => go('../hr/attendance')} />
        <KPI icon={UserX} tone="red" label="Absent (no punch, not on leave)" value={absent.length} />
        <KPI icon={UserCheck} tone="green" label="Checked in now" value={att.filter((a) => a.state === 'Checked In').length} />
        <KPI icon={Coffee} tone="amber" label="On break" value={att.filter((a) => a.state === 'On Break').length} />
        <KPI icon={Timer} tone="orange" label="Late arrivals" value={att.filter((a) => a.late).length} />
        <KPI icon={LogOut} tone="orange" label="Early checkouts" value={att.filter((a) => a.earlyCheckout).length} />
        <KPI icon={Clock} label={`Net hours · ${month}`} value={hm(monthMinutes)} />
        <KPI icon={Palmtree} tone="amber" label="Leave approvals pending" value={pendingLeave} onClick={() => go('../hr/leave')} />
        <KPI icon={FilePen} tone="amber" label="Corrections pending" value={pendingCorr} hint={`${pendingEarly} early checkout(s)`} onClick={() => go('../hr/corrections')} />
        <KPI icon={ClipboardCheck} tone="green" label="Daily reports submitted" value={reportsToday.length} onClick={() => go('../hr/work-reports')} />
        <KPI icon={ClipboardList} tone="red" label="Daily reports pending" value={Math.max(0, expectedReporters.filter((s) => !onLeave.has(s.id)).length - new Set(reportsToday.map((r) => r.employeeId)).size)} />
        <KPI icon={UserMinus} label="Resigned" value={staff.filter((s) => s.employmentStatus === 'Resigned').length} />
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
            <Table className="hr-table" head={['Employee', ...data.leaveTypes.filter((t) => t.active).map((t) => t.name)]}>
              {[...new Set(balances.map((b) => b.employeeId))].slice(0, 10).map((id) => (
                <tr key={id}>
                  <td className="font-medium text-heading">{lk.name(id)}</td>
                  {data.leaveTypes.filter((t) => t.active).map((t) => {
                    const b = balances.find((x) => x.employeeId === id && x.leaveType === t.id);
                    return <td key={t.id}>{b ? `${b.available}${b.pending ? ` (${b.pending} pending)` : ''}` : '—'}</td>;
                  })}
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
