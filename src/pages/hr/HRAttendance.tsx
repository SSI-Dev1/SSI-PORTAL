// HR attendance: a day's punches for everyone (with location verification) and the monthly
// working-hours sheet per employee. Older months are loaded from the server on demand.
import { useEffect, useMemo, useState } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Badge, Card, DatePicker, EmptyState, Field, FilterSelect, PageHeader, Table, Tabs } from '../../components/ui';
import { AttendanceTable, ExportButtons, stateTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { supabase } from '../../auth/auth';
import { MONTHS_SHORT, addDays, companyDate, companyTime, fmtDay, hm, isoDow, type AttendanceDay } from '../../data/hr';

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export default function HRAttendance({ initialTab = 'day' }: { initialTab?: 'day' | 'hours' }) {
  const { data, call, now } = useHR();
  const lk = useHRLookup();
  const [tab, setTab] = useState<'day' | 'hours'>(initialTab);
  const [date, setDate] = useState(companyDate(now()));
  const [month, setMonth] = useState(companyDate(now()).slice(0, 7));
  const [dept, setDept] = useState('');
  const [emp, setEmp] = useState('');
  const [older, setOlder] = useState<AttendanceDay[]>([]);
  const inMemoryFrom = addDays(companyDate(now()), -120);
  // Months older than the in-memory window are fetched directly (RLS applies as always).
  useEffect(() => {
    setOlder([]);
    if (!supabase || `${month}-31` >= inMemoryFrom) return;
    let alive = true;
    void supabase.from('attendance_days').select('*').gte('work_date', `${month}-01`).lte('work_date', `${month}-31`).then(({ data: r }) => {
      if (alive) setOlder(((r ?? []) as Record<string, unknown>[]).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [camel(k), v])) as unknown as AttendanceDay));
    });
    return () => {
      alive = false;
    };
  }, [month, inMemoryFrom]);
  const all = older.length ? older : data.attendance;
  const people = data.directory.filter((p) => (!dept || p.departmentId === dept) && (!emp || p.id === emp));
  const ids = new Set(people.map((p) => p.id));
  const dayRows = data.attendance.filter((a) => a.workDate === date && ids.has(a.employeeId));
  const onLeave = new Set(data.leaveRequests.filter((r) => r.status === 'Approved' && date >= r.startDate && date <= r.endDate).map((r) => r.employeeId));
  const notIn = people.filter((p) => p.employmentStatus !== 'Resigned' && p.accountStatus === 'active' && !dayRows.some((a) => a.employeeId === p.id));

  const sheet = useMemo(() => people.map((p) => {
    const rs = all.filter((a) => a.employeeId === p.id && a.workDate.slice(0, 7) === month);
    const done = rs.filter((a) => a.state === 'Checked Out');
    const shift = lk.shift.get(lk.employee.get(p.id)?.shiftId ?? '');
    // Expected working days in the month for this shift (Saturday off / holidays from the calendar).
    let expected = 0;
    for (let d = `${month}-01`; d.slice(0, 7) === month; d = addDays(d, 1)) {
      const dow = isoDow(d);
      const holiday = data.holidays.some((h) => h.active && h.holidayDate === d && (!h.departmentIds.length || h.departmentIds.includes(p.departmentId ?? '')));
      const cal = data.calendar.find((c) => c.workDate === d && (!c.shiftId || c.shiftId === shift?.id));
      const working = cal?.kind === 'working_day' || (!holiday && cal?.kind !== 'saturday_off' && cal?.kind !== 'day_off' && (shift?.workingDays ?? [1, 2, 3, 4, 5, 6]).includes(dow));
      if (working) expected++;
    }
    const net = rs.reduce((s, a) => s + (a.netMinutes ?? 0), 0);
    const gross = rs.reduce((s, a) => s + (a.grossMinutes ?? 0), 0);
    const brk = rs.reduce((s, a) => s + a.breakMinutes, 0);
    const shortage = done.reduce((s, a) => s + Math.max(0, a.requiredMinutes - (a.netMinutes ?? 0)), 0);
    return { p, days: rs.length, expected, gross, brk, net, shortage, late: rs.filter((a) => a.late).length, early: rs.filter((a) => a.earlyCheckout).length, missing: rs.filter((a) => a.state === 'Missing Punch-out').length, required: expected * (shift?.requiredMinutes ?? 480) };
  }), [people, all, month, data.holidays, data.calendar, lk]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = companyDate(now()).slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
  const verify = (id: string) => void call('verify_attendance_location', { p_session: id }, { refresh: ['attendance'], success: 'Punch verified' });

  return (
    <>
      <PageHeader title="Attendance" subtitle="Server-recorded punches, breaks and working hours. Corrections are shown next to the original times."
        actions={<ExportButtons filename={tab === 'day' ? `ssi-attendance-${date}` : `ssi-working-hours-${month}`} rows={() => tab === 'day'
          ? dayRows.map((a) => ({ Employee: lk.name(a.employeeId), Date: a.workDate, In: companyTime(a.effIn), Out: companyTime(a.effOut), 'Gross (min)': a.grossMinutes, 'Break (min)': a.breakMinutes, 'Net (min)': a.netMinutes, Status: a.state, Late: a.late ? 'Yes' : '', 'Early checkout': a.earlyCheckout ? 'Yes' : '' }))
          : sheet.map((r) => ({ Employee: r.p.fullName, 'Employee ID': r.p.employeeCode, Month: month, 'Days attended': r.days, 'Working days': r.expected, 'Gross hours': (r.gross / 60).toFixed(2), 'Break hours': (r.brk / 60).toFixed(2), 'Net hours': (r.net / 60).toFixed(2), 'Required hours': (r.required / 60).toFixed(2), 'Shortage hours': (r.shortage / 60).toFixed(2), Late: r.late, 'Early checkouts': r.early, 'Missing punch-outs': r.missing }))} />} />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'day', label: 'Daily attendance' }, { value: 'hours', label: 'Working hours' }]} />
        <div className="ml-auto flex flex-wrap items-end gap-2">
          {tab === 'day' ? <Field label="Date"><DatePicker value={date} clearable={false} onChange={(v) => v && setDate(v)} /></Field>
            : <FilterSelect label="Month" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: `${MONTHS_SHORT[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` }))} />}
          <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
          <FilterSelect label="Employee" value={emp} onChange={setEmp} options={[{ value: '', label: 'Everyone' }, ...data.directory.map((d) => ({ value: d.id, label: d.fullName }))]} />
        </div>
      </Card>
      {tab === 'day' ? (
        <>
          <Card className="p-5"><AttendanceTable rows={dayRows} showName onVerify={verify} /></Card>
          <Card className="mt-5 p-5">
            <h3 className="mb-3 font-display text-[15px] font-semibold text-heading">Not punched in · {fmtDay(date)}</h3>
            {notIn.length === 0 ? <p className="text-sm text-ink-soft">Everyone is accounted for.</p> : (
              <div className="flex flex-wrap gap-2">
                {notIn.map((p) => <Badge key={p.id} tone={onLeave.has(p.id) ? 'blue' : stateTone['Not Checked In']}>{p.fullName}{onLeave.has(p.id) ? ' · on leave' : ''}</Badge>)}
              </div>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-mute"><MapPin className="h-3.5 w-3.5" /> Locations are device-reported and can be spoofed; they support, not prove, attendance. Only HR and the employee can see them.</p>
          </Card>
        </>
      ) : (
        <Card>
          {sheet.length === 0 ? <EmptyState icon={Clock} title="No employees" /> : (
            <Table className="hr-table" head={['Employee', 'Days', 'Working days', 'Gross', 'Break', 'Net', 'Required', 'Shortage', 'Late', 'Early', 'Missing out']}>
              {sheet.map((r) => (
                <tr key={r.p.id}>
                  <td><div className="font-medium text-heading">{r.p.fullName}</div><div className="text-xs text-ink-mute">{lk.shift.get(lk.employee.get(r.p.id)?.shiftId ?? '')?.name}</div></td>
                  <td>{r.days}</td><td>{r.expected}</td>
                  <td className="tabular-nums">{hm(r.gross)}</td><td className="tabular-nums">{hm(r.brk)}</td>
                  <td className="font-semibold tabular-nums text-heading">{hm(r.net)}</td><td className="tabular-nums">{hm(r.required)}</td>
                  <td className="tabular-nums">{r.shortage ? <span className="text-red-600">{hm(r.shortage)}</span> : '—'}</td>
                  <td>{r.late || '—'}</td><td>{r.early || '—'}</td><td>{r.missing ? <Badge tone="red">{r.missing}</Badge> : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
