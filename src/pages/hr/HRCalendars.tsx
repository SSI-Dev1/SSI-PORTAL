// Stage 3 HR screens: Attendance Exceptions, Leave Calendar, Workforce Calendar and "Record leave"
// (HR enters leave for an employee). Day statuses come from the server (workforce_calendar →
// attendance_calendar), so these pages show the same numbers as attendance, leave and payroll.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, FilePen, LogOut, Palmtree, Timer, UserX } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, FilterSelect, Modal, PageHeader, Segmented, Select, Table, Tabs, Textarea } from '../../components/ui';
import { ApprovalsPanel, AttendanceTable, ExportButtons, KPI, ReviewAutoCloseModal, requestTone } from '../../components/hr';
import { EmployeeProfileModal, SHORT, TONE, fromRows, lastDay, monthLabel, shiftMonth } from '../../components/hrProfile';
import { useHR, useHRLookup } from '../../store/hr';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDay, fmtDays, halfDayLabel, type AttendanceDay, type DayStatus } from '../../data/hr';
import { cn } from '../../lib/utils';

export type WorkforceDay = Pick<DayStatus, 'day' | 'code' | 'label' | 'halfSession' | 'working' | 'attended'> & { employeeId: string };

/** Server day status for every visible employee in a month; re-read when attendance or leave changes. */
export function useWorkforceCalendar(month: string) {
  const hr = useHR();
  const { data } = hr;
  // The dev-only HR harness supplies sample day statuses instead of calling the server.
  const demo = (hr as { demoWorkforce?: (m: string) => WorkforceDay[] }).demoWorkforce;
  const key = `${data.attendance.length}:${data.attendance[0]?.updatedAt ?? ''}:${data.leaveRequests.map((r) => r.status).join('')}:${data.holidays.length}:${data.calendar.length}`;
  const [rows, setRows] = useState<WorkforceDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (demo) { setRows(demo(month)); return; }
    if (!supabase) { setRows([]); return; }
    let alive = true;
    void supabase.rpc('workforce_calendar', { p_month: `${month}-01` }).then(({ data: r, error: e }) => {
      if (!alive) return;
      if (e) { setError(e.message.includes('workforce_calendar') ? 'Run migration 0026 to enable this view.' : 'The calendar could not be loaded.'); setRows([]); return; }
      setError(null);
      setRows(fromRows<WorkforceDay>(r));
    });
    return () => {
      alive = false;
    };
  }, [month, key, demo]);
  const byEmployee = useMemo(() => {
    const m = new Map<string, Map<string, WorkforceDay>>();
    for (const d of rows ?? []) {
      if (!m.has(d.employeeId)) m.set(d.employeeId, new Map());
      m.get(d.employeeId)!.set(String(d.day).slice(0, 10), d);
    }
    return m;
  }, [rows]);
  return { rows, byEmployee, error, loading: rows === null };
}

function MonthNav({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="secondary" icon={ChevronLeft} aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))} />
      <span className="min-w-[96px] text-center font-display text-sm font-semibold text-heading" aria-live="polite">{monthLabel(month)}</span>
      <Button size="sm" variant="secondary" icon={ChevronRight} aria-label="Next month" disabled={!!max && month >= max} onClick={() => onChange(shiftMonth(month, 1))} />
    </div>
  );
}

const daysOf = (month: string) => Array.from({ length: Number(lastDay(month).slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);

// ------------------------------------------------------------------ attendance exceptions

type ExceptionKind = 'absent' | 'half_absent' | 'missing_out' | 'auto_close' | 'late' | 'early';
const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  absent: 'Missed clock-in (no leave)',
  half_absent: 'Half day absent',
  missing_out: 'Missed clock-out',
  auto_close: 'Auto clock-out — needs review',
  late: 'Late arrival',
  early: 'Early checkout',
};
const EXCEPTION_TONE: Record<ExceptionKind, 'red' | 'amber' | 'orange' | 'violet'> = {
  absent: 'red', half_absent: 'amber', missing_out: 'red', auto_close: 'violet', late: 'orange', early: 'orange',
};

export function AttendanceExceptions() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const today = companyDate(now());
  const [tab, setTab] = useState<'action' | 'detected'>('action');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [kind, setKind] = useState('');
  const [dept, setDept] = useState('');
  const [reviewing, setReviewing] = useState<AttendanceDay | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const cal = useWorkforceCalendar(month);

  const pendingCorr = data.corrections.filter((c) => c.status === 'Pending');
  const pendingEarly = data.earlyCheckouts.filter((c) => c.status === 'Pending');
  const review = data.attendance.filter((a) => a.reviewStatus === 'pending_review');
  const inDept = (id: string) => !dept || lk.employee.get(id)?.departmentId === dept;

  const detected = useMemo(() => {
    const out: { employeeId: string; date: string; kind: ExceptionKind; detail: string; day?: AttendanceDay }[] = [];
    for (const d of cal.rows ?? []) {
      const date = String(d.day).slice(0, 10);
      if (date >= today) continue;
      if (d.code === 'A') out.push({ employeeId: d.employeeId, date, kind: 'absent', detail: 'Working day with no clock-in and no approved leave' });
      else if (d.code === 'HD' && (d.label ?? '').includes('absent')) out.push({ employeeId: d.employeeId, date, kind: 'half_absent', detail: d.label ?? '' });
    }
    for (const a of data.attendance.filter((x) => x.workDate.slice(0, 7) === month)) {
      if (a.state === 'Missing Punch-out') out.push({ employeeId: a.employeeId, date: a.workDate, kind: 'missing_out', detail: 'Clocked in but never clocked out', day: a });
      if (a.reviewStatus === 'pending_review') out.push({ employeeId: a.employeeId, date: a.workDate, kind: 'auto_close', detail: 'Closed by the system at the cutoff; hours not counted until confirmed', day: a });
      if (a.late) out.push({ employeeId: a.employeeId, date: a.workDate, kind: 'late', detail: 'Clocked in after the shift start and grace period', day: a });
      if (a.earlyCheckout) out.push({ employeeId: a.employeeId, date: a.workDate, kind: 'early', detail: a.earlyCheckoutId ? 'Approved early checkout' : 'Left before the shift end', day: a });
    }
    return out.filter((x) => inDept(x.employeeId)).sort((a, b) => b.date.localeCompare(a.date) || lk.name(a.employeeId).localeCompare(lk.name(b.employeeId)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal.rows, data.attendance, month, today, dept, lk]);
  const shown = detected.filter((x) => !kind || x.kind === kind);
  const count = (k: ExceptionKind) => detected.filter((x) => x.kind === k).length;
  const requestFor = (emp: string, date: string) => data.corrections.find((c) => c.employeeId === emp && c.workDate === date);

  return (
    <>
      <PageHeader title="Attendance Exceptions" subtitle="Requests to decide and problems found in attendance. Original punch times are never overwritten; every decision is audited."
        actions={<ExportButtons filename={`ssi-attendance-exceptions-${month}`} rows={() => shown.map((x) => ({
          Employee: lk.name(x.employeeId), 'Employee ID': lk.employee.get(x.employeeId)?.employeeCode ?? '', Date: x.date, Exception: EXCEPTION_LABEL[x.kind], Detail: x.detail,
          'Correction request': requestFor(x.employeeId, x.date)?.status ?? '',
        }))} />} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPI icon={FilePen} tone="amber" label="Correction requests" value={pendingCorr.length} hint="Waiting for a decision" onClick={() => setTab('action')} />
        <KPI icon={LogOut} tone="amber" label="Early checkout requests" value={pendingEarly.length} hint="Waiting for a decision" onClick={() => setTab('action')} />
        <KPI icon={AlertTriangle} tone="red" label="Auto clock-out review" value={review.length} hint="Hours not counted yet" onClick={() => setTab('action')} />
        <KPI icon={UserX} tone="red" label={`Missed clock-in · ${monthLabel(month)}`} value={count('absent')} hint={`${count('half_absent')} half day(s)`} onClick={() => { setTab('detected'); setKind('absent'); }} />
        <KPI icon={Clock} tone="red" label={`Missed clock-out · ${monthLabel(month)}`} value={count('missing_out')} onClick={() => { setTab('detected'); setKind('missing_out'); }} />
        <KPI icon={Timer} tone="orange" label={`Late arrivals · ${monthLabel(month)}`} value={count('late')} hint={`${count('early')} early checkout(s)`} onClick={() => { setTab('detected'); setKind('late'); }} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'action', label: 'Needs action', count: pendingCorr.length + pendingEarly.length + review.length },
        { value: 'detected', label: 'Detected exceptions', count: detected.length },
      ]} />
      {tab === 'action' ? (
        <div className="space-y-6">
          <ApprovalsPanel kinds={['corrections', 'early']} />
          <Card className="p-5">
            <h3 className="mb-1 font-display text-[15px] font-semibold text-heading">Automatic clock-out review</h3>
            <p className="mb-4 text-sm text-ink-soft">Days the system closed at the cutoff because nobody clocked out. Confirm the real finish time; until then these days count no working hours.</p>
            {review.length === 0 ? <EmptyState icon={AlertTriangle} title="Nothing to review" /> : <AttendanceTable rows={review} showName onReview={setReviewing} />}
          </Card>
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
            <MonthNav month={month} onChange={setMonth} max={today.slice(0, 7)} />
            <FilterSelect label="Exception" value={kind} onChange={setKind} options={[{ value: '', label: 'All exceptions' }, ...(Object.keys(EXCEPTION_LABEL) as ExceptionKind[]).map((k) => ({ value: k, label: `${EXCEPTION_LABEL[k]} (${count(k)})` }))]} />
            <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
          {cal.error && <Alert tone="warning" className="m-4">{cal.error} Missed clock-ins cannot be listed until then.</Alert>}
          {cal.loading ? <div className="p-6 text-sm text-ink-soft">Loading…</div> : shown.length === 0 ? <EmptyState icon={CalendarDays} title="No exceptions" description="Nothing matches these filters." /> : (
            <Table className="hr-table" head={['Employee', 'Date', 'Exception', 'Detail', 'Correction request', '']}>
              {shown.slice(0, 500).map((x, i) => {
                const req = requestFor(x.employeeId, x.date);
                return (
                  <tr key={`${x.employeeId}${x.date}${x.kind}${i}`}>
                    <td><button type="button" className="text-left font-medium text-heading hover:text-rust hover:underline" onClick={() => setProfile(x.employeeId)}>{lk.name(x.employeeId)}</button></td>
                    <td className="whitespace-nowrap">{fmtDay(x.date)}</td>
                    <td><Badge tone={EXCEPTION_TONE[x.kind]}>{EXCEPTION_LABEL[x.kind]}</Badge></td>
                    <td className="min-w-[220px] max-w-[320px] text-ink-soft">{x.detail}</td>
                    <td>{req ? <Badge tone={requestTone[req.status]}>{req.status}</Badge> : <span className="text-ink-mute">None</span>}</td>
                    <td className="text-right">{x.kind === 'auto_close' && x.day && <Button size="sm" variant="secondary" onClick={() => setReviewing(x.day!)}>Review</Button>}</td>
                  </tr>
                );
              })}
            </Table>
          )}
          {shown.length > 500 && <p className="p-4 text-xs text-ink-mute">Showing the first 500 of {shown.length}. Export for the full list.</p>}
        </Card>
      )}
      <ReviewAutoCloseModal day={reviewing} onClose={() => setReviewing(null)} />
      <EmployeeProfileModal employeeId={profile} onClose={() => setProfile(null)} />
    </>
  );
}

// ------------------------------------------------------------------ leave calendar

export function LeaveCalendar() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const today = companyDate(now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [show, setShow] = useState<'approved' | 'all'>('all');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const days = daysOf(month);
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const requests = data.leaveRequests.filter((r) => (r.status === 'Approved' || (show === 'all' && r.status === 'Pending'))
    && r.endDate >= `${month}-01` && r.startDate <= lastDay(month)
    && (!dept || lk.employee.get(r.employeeId)?.departmentId === dept) && (!type || r.leaveType === type));
  const on = (d: string) => requests.filter((r) => d >= r.startDate && d <= r.endDate);
  const holiday = (d: string) => data.holidays.find((h) => h.active && h.holidayDate === d && h.departmentIds.length === 0);
  const satOff = (d: string) => data.calendar.some((c) => c.workDate === d && c.kind === 'saturday_off' && !c.shiftId);
  const total = requests.filter((r) => r.status === 'Approved').reduce((s, r) => {
    const from = r.startDate < `${month}-01` ? `${month}-01` : r.startDate;
    const to = r.endDate > lastDay(month) ? lastDay(month) : r.endDate;
    return s + (r.halfDaySession ? 0.5 : from === r.startDate && to === r.endDate ? Number(r.days) : 0);
  }, 0);
  const typeTone = (t: string) => (t === 'sick' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : t === 'lop' ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-sky-500/15 text-sky-700 dark:text-sky-300');
  const dayRequests = openDay ? on(openDay) : [];

  return (
    <>
      <PageHeader title="Leave Calendar" subtitle="Who is away and when. Leave reasons are not shown here."
        actions={<>
          <ExportButtons filename={`ssi-leave-calendar-${month}`} rows={() => requests.map((r) => ({ Employee: lk.name(r.employeeId), Type: lk.leaveType.get(r.leaveType)?.name, From: r.startDate, To: r.endDate, Session: halfDayLabel(r.halfDaySession) ?? 'Full day', Days: r.days, Status: r.status }))} />
          <Button icon={CalendarPlus} onClick={() => setRecording(true)}>Record leave</Button>
        </>} />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-4">
        <MonthNav month={month} onChange={setMonth} />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Leave type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...data.leaveTypes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))]} />
        <Segmented value={show} onChange={setShow} options={[{ value: 'all', label: 'Approved + pending' }, { value: 'approved', label: 'Approved only' }]} />
        <span className="ml-auto text-xs text-ink-soft">{requests.length} request(s){total ? ` · ${fmtDays(total)} approved day(s) fully inside this month` : ''}</span>
      </Card>
      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-semibold uppercase tracking-wider text-ink-mute">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Leave ${monthLabel(month)}`}>
          {Array.from({ length: lead }, (_, i) => <div key={`x${i}`} />)}
          {days.map((d) => {
            const list = on(d);
            const h = holiday(d);
            const off = new Date(`${d}T00:00:00Z`).getUTCDay() === 0 || satOff(d);
            return (
              <button key={d} type="button" role="gridcell" onClick={() => setOpenDay(d)} aria-label={`${fmtDay(d)}: ${list.length} on leave${h ? `, ${h.name}` : ''}`}
                className={cn('flex min-h-[92px] flex-col gap-1 rounded-lg border border-line p-1.5 text-left transition hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                  off || h ? 'bg-canvas' : 'bg-surface', d === today && 'ring-2 ring-brand')}>
                <span className="flex items-center justify-between">
                  <span className={cn('text-[11px] font-semibold', off || h ? 'text-ink-mute' : 'text-heading')}>{Number(d.slice(8))}</span>
                  {list.length > 0 && <span className="rounded-full bg-navy px-1.5 text-[10px] font-bold text-white dark:bg-white/15">{list.length}</span>}
                </span>
                {h && <span className="truncate rounded bg-brand-50 px-1 text-[10px] font-medium text-rust dark:bg-brand-500/10 dark:text-brand-300">{h.name}</span>}
                {!h && satOff(d) && <span className="truncate text-[10px] text-ink-mute">Saturday off</span>}
                <span className="hidden flex-col gap-0.5 sm:flex">
                  {list.slice(0, 3).map((r) => (
                    <span key={r.id} className={cn('truncate rounded px-1 text-[10px] font-medium', typeTone(r.leaveType), r.status === 'Pending' && 'border border-dashed border-current bg-transparent')}>
                      {lk.name(r.employeeId).split(' ')[0]}{r.halfDaySession ? ` · ${r.halfDaySession === 'morning' ? 'AM' : 'PM'}` : ''}
                    </span>
                  ))}
                  {list.length > 3 && <span className="text-[10px] text-ink-mute">+{list.length - 3} more</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-mute">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-sky-500" />Paid Leave</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-violet-500" />Sick Leave</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-red-500" />Loss of Pay</span>
          <span>Dashed = pending · AM / PM = half day (0.5)</span>
        </div>
      </Card>
      <Modal open={!!openDay} onClose={() => setOpenDay(null)} title={openDay ? fmtDay(openDay) : ''} subtitle={openDay ? `${dayRequests.length} on leave${holiday(openDay) ? ` · ${holiday(openDay)!.name}` : ''}` : undefined}
        footer={<Button variant="secondary" onClick={() => setOpenDay(null)}>Close</Button>}>
        {dayRequests.length === 0 ? <EmptyState icon={Palmtree} title="Nobody is on leave" /> : (
          <ul className="divide-y divide-line">
            {dayRequests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={lk.name(r.employeeId)} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-heading">{lk.name(r.employeeId)}</span>
                  <span className="block truncate text-xs text-ink-soft">{lk.leaveType.get(r.leaveType)?.name} · {halfDayLabel(r.halfDaySession) ?? 'Full day'} · {fmtDay(r.startDate)}{r.endDate !== r.startDate ? ` – ${fmtDay(r.endDate)}` : ''}</span>
                </span>
                <Badge tone={requestTone[r.status]}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <RecordLeaveModal open={recording} onClose={() => setRecording(false)} />
    </>
  );
}

// ------------------------------------------------------------------ record leave (HR)

export function RecordLeaveModal({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId?: string }) {
  const { data, call, now } = useHR();
  const lk = useHRLookup();
  const today = companyDate(now());
  const blank = { emp: employeeId ?? '', type: '', start: today, end: today, mode: 'full' as 'full' | 'morning' | 'afternoon', reason: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ ...blank, emp: employeeId ?? '' }); setErr(null); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeId]);
  const people = data.directory.filter((e) => e.employmentStatus !== 'Resigned' && e.accountStatus === 'active');
  const half = f.mode !== 'full';
  const end = half ? f.start : f.end;
  const bal = data.balances.find((b) => b.employeeId === f.emp && b.leaveType === f.type);
  const t = lk.leaveType.get(f.type);
  const problems = [
    !f.emp && 'Choose the employee',
    !f.type && 'Choose the leave type',
    end < f.start && 'The end date is before the start date',
    f.reason.trim().length < 3 && 'Enter a reason',
  ].filter(Boolean) as string[];
  const save = async () => {
    if (problems.length) return;
    setBusy(true);
    const r = await call<string>('hr_record_leave', { p_emp: f.emp, p_type: f.type, p_start: f.start, p_end: end, p_reason: f.reason.trim(), p_half: half ? f.mode : null },
      { refresh: ['leaveRequests', 'balances'], success: 'Leave recorded', successDetail: 'Approved and the employee was notified.', quiet: true });
    setBusy(false);
    if (r.ok) onClose();
    else setErr(r.error.replace(/^LEAVE_[A-Z]+:\s*/, ''));
  };
  return (
    <Modal open={open} onClose={onClose} title="Record leave for an employee" subtitle="For leave reported to HR directly. It is approved at once and the employee is notified." dirty={!!f.reason}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : 'Record leave'}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Employee" required>
          <Select value={f.emp} searchable onChange={(e) => setF({ ...f, emp: e.target.value })}>
            <option value="">Choose employee</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} · {p.employeeCode}</option>)}
          </Select>
        </Field>
        <Field label="Leave type" required hint={t && t.paid !== false && bal ? `${fmtDays(bal.available)} day(s) available this leave year` : t?.paid === false ? 'Unpaid — counted as Loss of Pay, no balance used' : undefined}>
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">Choose type</option>
            {data.leaveTypes.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="Duration">
          <Segmented value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: 'full', label: 'Full day(s)' }, { value: 'morning', label: 'Morning (0.5)' }, { value: 'afternoon', label: 'Afternoon (0.5)' }]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={half ? 'Date' : 'From'} required><DatePicker value={f.start} clearable={false} onChange={(v) => v && setF({ ...f, start: v, end: v > f.end ? v : f.end })} /></Field>
          {!half && <Field label="To" required error={end < f.start ? 'Before the start date' : undefined}><DatePicker value={f.end} clearable={false} min={f.start} onChange={(v) => v && setF({ ...f, end: v })} /></Field>}
        </div>
        <Field label="Reason" required hint="For example how and when the employee reported it.">
          <Textarea rows={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        <p className="text-xs text-ink-mute">Holidays and non-working days inside the dates are not counted. Paid leave above the balance is refused — record Loss of Pay instead.</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ workforce calendar

const CELL_TEXT: Record<string, string> = { P: 'text-white', PL: 'text-white', SL: 'text-white', LOP: 'text-white', A: 'text-white', H: 'text-navy', WO: 'text-ink-soft', UP: 'text-ink-mute', OPEN: 'text-ink-soft' };

export function WorkforceCalendar() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const today = companyDate(now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dept, setDept] = useState('');
  const [profile, setProfile] = useState<string | null>(null);
  const cal = useWorkforceCalendar(month);
  const days = daysOf(month);
  const people = data.directory.filter((e) => cal.byEmployee.has(e.id) && (!dept || e.departmentId === dept)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const tally = (id: string) => {
    const t = { present: 0, leave: 0, absent: 0 };
    cal.byEmployee.get(id)?.forEach((d) => {
      if (d.code === 'P') t.present += 1;
      else if (d.code === 'PL' || d.code === 'SL' || d.code === 'LOP') t.leave += 1;
      else if (d.code === 'A') t.absent += 1;
      else if (d.code === 'HD') { t.leave += d.halfSession === 'both' ? 1 : 0.5; if (d.attended) t.present += d.halfSession === 'both' ? 0 : 0.5; else if (String(d.day) < today && (d.label ?? '').includes('absent')) t.absent += 0.5; }
    });
    return t;
  };
  const staffing = (d: string) => people.filter((p) => { const x = cal.byEmployee.get(p.id)?.get(d); return x?.attended; }).length;

  return (
    <>
      <PageHeader title="Workforce Calendar" subtitle="Each employee's day: present, leave (half days included), absent, holidays and weekly offs — the same status attendance and payroll use."
        actions={<ExportButtons filename={`ssi-workforce-${month}`} rows={() => people.map((p) => ({
          Employee: p.fullName, 'Employee ID': p.employeeCode, Department: lk.department.get(p.departmentId ?? '')?.name ?? '',
          ...Object.fromEntries(days.map((d) => { const x = cal.byEmployee.get(p.id)?.get(d); return [d.slice(8), x?.code === 'HD' ? (x.halfSession === 'morning' ? 'AM-L' : x.halfSession === 'afternoon' ? 'PM-L' : 'L') : x?.code ?? '']; })),
        }))} />} />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-4">
        <MonthNav month={month} onChange={setMonth} />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <span className="ml-auto text-xs text-ink-soft">{people.length} employee(s)</span>
      </Card>
      {cal.error ? <Alert tone="warning">{cal.error}</Alert> : cal.loading ? <Card className="p-6 text-sm text-ink-soft">Loading…</Card> : people.length === 0 ? <Card><EmptyState icon={CalendarDays} title="No employees" /></Card> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-[180px] border-b border-line bg-surface px-3 py-2 text-left font-semibold text-ink-soft">Employee</th>
                  {days.map((d) => {
                    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                    return (
                      <th key={d} scope="col" className={cn('w-8 border-b border-line px-0.5 py-2 text-center font-semibold', d === today ? 'text-rust' : dow === 0 ? 'text-ink-mute' : 'text-ink-soft')}>
                        <div>{'SMTWTFS'[dow]}</div><div>{Number(d.slice(8))}</div>
                      </th>
                    );
                  })}
                  <th scope="col" className="border-b border-line px-2 py-2 text-left font-semibold text-ink-soft">Present · Leave · Absent</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const t = tally(p.id);
                  return (
                    <tr key={p.id}>
                      <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5 text-left font-normal">
                        <button type="button" className="flex items-center gap-2 text-left hover:text-rust" onClick={() => setProfile(p.id)}>
                          <Avatar name={p.fullName} size={24} />
                          <span className="max-w-[140px] truncate font-medium text-heading">{p.fullName}</span>
                        </button>
                      </th>
                      {days.map((d) => {
                        const x = cal.byEmployee.get(p.id)?.get(d);
                        const code = x?.code ?? '';
                        const label = `${p.fullName} · ${fmtDay(d)}: ${x?.label ?? 'No record'}`;
                        return (
                          <td key={d} className="border-b border-line p-0.5 text-center">
                            {code === 'HD' ? (
                              <span title={label} aria-label={label} className="flex h-7 w-7 overflow-hidden rounded-md border border-line">
                                <span className={cn('w-1/2', x!.halfSession === 'afternoon' ? (x!.attended ? TONE.P : 'bg-slate-200 dark:bg-slate-700') : 'bg-amber-500')} />
                                <span className={cn('w-1/2', x!.halfSession === 'morning' ? (x!.attended ? TONE.P : 'bg-slate-200 dark:bg-slate-700') : 'bg-amber-500')} />
                              </span>
                            ) : (
                              <span title={label} aria-label={label} className={cn('flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold', TONE[code] ?? 'bg-canvas', CELL_TEXT[code] ?? 'text-ink-mute')}>
                                {SHORT[code] ?? ''}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap border-b border-line px-2 text-ink-soft"><b className="text-heading">{fmtDays(t.present)}</b> · {fmtDays(t.leave)} · <span className={t.absent ? 'text-red-600' : ''}>{fmtDays(t.absent)}</span></td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-[11px] font-semibold text-ink-soft">Clocked in</th>
                  {days.map((d) => <td key={d} className="py-2 text-center text-[11px] font-semibold text-ink-soft">{d <= today ? staffing(d) : ''}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-line p-3 text-[11px] text-ink-mute">
            {[['bg-emerald-500', 'P Present'], ['bg-sky-500', 'PL Paid Leave'], ['bg-violet-500', 'SL Sick Leave'], ['bg-red-500', 'LOP / A Absent'], ['bg-amber-500', 'Half-day leave (left = morning)'], ['bg-brand', 'H Holiday'], ['bg-slate-300 dark:bg-slate-600', 'WO Weekly off']].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-3 rounded-sm', c)} />{l}</span>
            ))}
          </div>
        </Card>
      )}
      <Card className="mt-4">
        <CardHeader title="Upcoming holidays" subtitle="Company and public holidays from the Holiday Calendar" />
        {data.holidays.filter((h) => h.active && h.holidayDate >= today).length === 0 ? <EmptyState icon={Palmtree} title="No upcoming holidays" /> : (
          <ul className="divide-y divide-line">
            {data.holidays.filter((h) => h.active && h.holidayDate >= today).sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)).slice(0, 8).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="font-medium text-heading">{h.name}</span>
                <span className="text-ink-soft">{fmtDay(h.holidayDate)} · {h.kind}{h.departmentIds.length ? ` · ${h.departmentIds.map((d) => lk.department.get(d)?.name ?? d).join(', ')}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <EmployeeProfileModal employeeId={profile} onClose={() => setProfile(null)} />
    </>
  );
}
