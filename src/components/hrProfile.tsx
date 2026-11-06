// Employee profile, attendance calendar and leave review history — one implementation for HR
// (Employees → profile), managers (team) and the employee (My Profile). Every figure comes from
// the server: the calendar from attendance_calendar() / attendance_month_summary() (the same day
// values payroll uses: Morning / Afternoon Leave, 0.5 LOP, fractional Present), the rest from RLS-
// filtered tables, so nobody sees another employee's records unless they may.
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Clock, History, Mail, MapPin, Palmtree, Phone, Wallet } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Modal, Table } from './ui';
import { requestTone, reportTone } from './hr';
import { useHR, useHRLookup } from '../store/hr';
import { useStore } from '../store/store';
import { supabase } from '../auth/auth';
import { MONTHS_SHORT, companyDate, fmtDay, fmtDays, halfDayLabel, hm, type DayStatus, type LeaveEvent, type LeaveRequest, type MonthSummary } from '../data/hr';
import { cn } from '../lib/utils';

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const fromRows = <T,>(rows: unknown) => ((rows ?? []) as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && k !== 'day' ? Number(v) : v])) as T);
const monthLabel = (m: string) => `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const lastDay = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

// Day colours (SSI tokens; the label always explains the cell).
const TONE: Record<string, string> = {
  P: 'bg-emerald-500', PL: 'bg-sky-500', SL: 'bg-violet-500', LOP: 'bg-red-500', A: 'bg-red-500',
  H: 'bg-brand', WO: 'bg-slate-300 dark:bg-slate-600', UP: 'bg-slate-200 dark:bg-slate-700', OPEN: 'bg-slate-200 dark:bg-slate-700',
};
const SHORT: Record<string, string> = { P: 'P', PL: 'PL', SL: 'SL', LOP: 'LOP', A: 'A', H: 'H', WO: 'WO', UP: '', OPEN: '—', HD: '½' };

/** Re-reads whenever this employee's attendance or leave changes (realtime via the HR store). */
function useChangeKey(employeeId: string) {
  const { data } = useHR();
  return useMemo(() => [
    ...data.attendance.filter((a) => a.employeeId === employeeId).map((a) => a.updatedAt),
    ...data.leaveRequests.filter((r) => r.employeeId === employeeId).map((r) => `${r.id}:${r.status}`),
    data.holidays.length, data.calendar.length,
  ].join('|'), [data.attendance, data.leaveRequests, data.holidays.length, data.calendar.length, employeeId]);
}

export function useMonthCalendar(employeeId: string | undefined, month: string) {
  const key = useChangeKey(employeeId ?? '');
  const [days, setDays] = useState<DayStatus[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!supabase || !employeeId) return;
    let alive = true;
    setError(false);
    void supabase.rpc('attendance_calendar', { p_emp: employeeId, p_from: `${month}-01`, p_to: lastDay(month) }).then(({ data, error: e }) => {
      if (!alive) return;
      if (e) { setError(true); setDays([]); return; }
      setDays(fromRows<DayStatus>(data));
    });
    return () => {
      alive = false;
    };
  }, [employeeId, month, key]);
  const totals = useMemo(() => {
    const t = { present: 0, paid: 0, sick: 0, lop: 0, absent: 0, half: 0, working: 0 };
    (days ?? []).forEach((d) => {
      t.present += d.present; t.paid += d.paidLeave; t.sick += d.sickLeave; t.lop += d.lop; t.absent += d.absent;
      if (d.code === 'HD') t.half++;
      if (d.counted && d.working) t.working++;
    });
    return t;
  }, [days]);
  return { days, totals, error };
}

/** Monthly totals for every employee the caller may see (server-calculated). */
export function useMonthSummaries(month: string) {
  const { data } = useHR();
  const key = `${data.attendance.length}:${data.leaveRequests.map((r) => r.status).join('')}`;
  const [rows, setRows] = useState<Map<string, MonthSummary>>(new Map());
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.rpc('attendance_month_summary', { p_month: `${month}-01` }).then(({ data: r }) => {
      if (alive) setRows(new Map(fromRows<MonthSummary>(r).map((x) => [x.employeeId, x])));
    });
    return () => {
      alive = false;
    };
  }, [month, key]);
  return rows;
}

export function AttendanceCalendar({ employeeId, month: initial, compact }: { employeeId: string; month?: string; compact?: boolean }) {
  const { now } = useHR();
  const today = companyDate(now());
  const [month, setMonth] = useState(initial ?? today.slice(0, 7));
  const { days, totals, error } = useMonthCalendar(employeeId, month);
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const lead = (first + 6) % 7;                                  // Monday-first grid
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={ChevronLeft} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
          <span className="min-w-[96px] text-center font-display text-sm font-semibold text-heading">{monthLabel(month)}</span>
          <Button size="sm" variant="secondary" icon={ChevronRight} aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} />
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge tone="green">Present {fmtDays(totals.present)}</Badge>
          <Badge tone="blue">Paid {fmtDays(totals.paid)}</Badge>
          <Badge tone="violet">Sick {fmtDays(totals.sick)}</Badge>
          <Badge tone="red">LOP {fmtDays(totals.lop)}{totals.absent ? ` · absent ${fmtDays(totals.absent)}` : ''}</Badge>
          {totals.half > 0 && <Badge tone="amber">{totals.half} half day{totals.half === 1 ? '' : 's'}</Badge>}
        </div>
      </div>
      {error ? <EmptyState icon={CalendarDays} title="The calendar could not be loaded" description="Check your connection and try again. (Needs migration 0023 on the server.)" /> : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-semibold uppercase tracking-wider text-ink-mute">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Attendance ${monthLabel(month)}`}>
            {Array.from({ length: lead }, (_, i) => <div key={`x${i}`} />)}
            {(days ?? Array.from({ length: Number(lastDay(month).slice(8)) }, () => null)).map((d, i) => {
              if (!d) return <div key={i} className="h-14 animate-pulse rounded-lg bg-canvas" />;
              const n = Number(d.day.slice(8));
              const isToday = d.day === today;
              const halfBg = d.code === 'HD' ? halfTones(d) : null;
              return (
                <div key={d.day} role="gridcell" title={`${fmtDay(d.day)} — ${d.label ?? ''}`} aria-label={`${fmtDay(d.day)}: ${d.label ?? 'no record'}`}
                  className={cn('relative flex h-14 flex-col justify-between overflow-hidden rounded-lg border border-line bg-surface p-1 text-left', isToday && 'ring-2 ring-brand', compact && 'h-11')}>
                  {halfBg ? (
                    <span className="absolute inset-x-0 bottom-0 flex h-1.5"><span className={cn('w-1/2', halfBg[0])} /><span className={cn('w-1/2', halfBg[1])} /></span>
                  ) : d.code && TONE[d.code] ? <span className={cn('absolute inset-x-0 bottom-0 h-1.5', TONE[d.code])} /> : null}
                  <span className={cn('text-[11px] font-semibold', d.working ? 'text-heading' : 'text-ink-mute')}>{n}</span>
                  <span className="truncate pb-1 text-[10px] font-semibold text-ink-soft">{d.code === 'HD' ? halfShort(d) : SHORT[d.code ?? ''] ?? ''}</span>
                </div>
              );
            })}
          </div>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-mute">
              {[['bg-emerald-500', 'Present'], ['bg-sky-500', 'Paid Leave'], ['bg-violet-500', 'Sick Leave'], ['bg-red-500', 'LOP / Absent'], ['bg-brand', 'Holiday'], ['bg-slate-300 dark:bg-slate-600', 'Weekly off']].map(([c, l]) => (
                <span key={l} className="inline-flex items-center gap-1.5"><span className={cn('h-2 w-3 rounded-sm', c)} />{l}</span>
              ))}
              <span>Half days show the morning on the left, the afternoon on the right.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Morning / afternoon colours of a half day: leave half in its type colour, the other half Present or Absent.
function halfTones(d: DayStatus): [string, string] {
  const leaveTone = d.sickLeave > 0 && d.paidLeave === 0 && d.lop - d.absent <= 0 ? TONE.SL : d.paidLeave > 0 && d.sickLeave === 0 && d.lop - d.absent <= 0 ? TONE.PL : d.lop - d.absent > 0 && d.paidLeave === 0 && d.sickLeave === 0 ? TONE.LOP : 'bg-amber-500';
  const other = d.present > 0 ? TONE.P : d.absent > 0 ? TONE.A : 'bg-slate-200 dark:bg-slate-700';
  if (d.halfSession === 'both') return [leaveTone, leaveTone];
  return d.halfSession === 'morning' ? [leaveTone, other] : [other, leaveTone];
}
function halfShort(d: DayStatus) {
  if (d.halfSession === 'both') return 'AM+PM';
  return d.halfSession === 'morning' ? 'AM leave' : 'PM leave';
}

/** Who did what to a leave request, in order. */
export function LeaveHistory({ requestId }: { requestId: string }) {
  const lk = useHRLookup();
  const [rows, setRows] = useState<LeaveEvent[] | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.from('leave_events').select('*').eq('request_id', requestId).order('at').then(({ data }) => alive && setRows(fromRows<LeaveEvent>(data)));
    return () => {
      alive = false;
    };
  }, [requestId]);
  if (!rows) return <p className="text-xs text-ink-mute">Loading…</p>;
  if (!rows.length) return <p className="text-xs text-ink-mute">No history recorded (requests before migration 0023 start here).</p>;
  const verb = { requested: 'Requested', manager_approved: 'Approved by manager', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' } as const;
  return (
    <ol className="space-y-2">
      {rows.map((e) => (
        <li key={e.id} className="flex gap-2 text-sm">
          <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', e.action === 'rejected' || e.action === 'cancelled' ? 'bg-red-500' : e.action === 'requested' ? 'bg-slate-400' : 'bg-emerald-500')} />
          <span><b className="text-heading">{verb[e.action]}</b> · {lk.name(e.actorId)} · <span className="text-ink-mute">{new Date(e.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            {e.comment && <span className="block text-xs text-ink-soft">“{e.comment}”</span>}</span>
        </li>
      ))}
    </ol>
  );
}

export const leaveWhen = (r: LeaveRequest) =>
  `${fmtDay(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDay(r.endDate)}` : ''}${halfDayLabel(r.halfDaySession) ? ` · ${halfDayLabel(r.halfDaySession)}` : ''}`;

export function LeaveHistoryModal({ request, onClose }: { request: LeaveRequest | null; onClose: () => void }) {
  const lk = useHRLookup();
  if (!request) return null;
  return (
    <Modal open onClose={onClose} size="sm" title="Leave history" subtitle={`${lk.name(request.employeeId)} · ${lk.leaveType.get(request.leaveType)?.name ?? request.leaveType} · ${leaveWhen(request)}`}>
      <LeaveHistory requestId={request.id} />
    </Modal>
  );
}

// ------------------------------------------------------------------ profile

export function EmployeeProfile({ employeeId, self }: { employeeId: string; self?: boolean }) {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const e = data.employees.find((x) => x.id === employeeId);
  const dir = data.directory.find((x) => x.id === employeeId);
  const [contact, setContact] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [historyOf, setHistoryOf] = useState<LeaveRequest | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.from('profiles').select('email, phone').eq('id', employeeId).maybeSingle().then(({ data: p }) => alive && setContact((p as { email: string | null; phone: string | null } | null) ?? null));
    return () => {
      alive = false;
    };
  }, [employeeId]);
  const today = companyDate(now());
  const month = today.slice(0, 7);
  const monthRows = data.attendance.filter((a) => a.employeeId === employeeId && a.workDate.slice(0, 7) === month);
  const net = monthRows.reduce((s, a) => s + (a.netMinutes ?? 0), 0);
  const balances = data.balances.filter((b) => b.employeeId === employeeId);
  const leave = data.leaveRequests.filter((r) => r.employeeId === employeeId);
  const reports = data.reports.filter((r) => r.employeeId === employeeId).slice(0, 8);
  // RLS returns a salary row only to Super Admin and HR with the salary permission.
  const salary = data.salaries.find((s) => s.employeeId === employeeId);
  const canSalary = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('hr_salary');
  const shift = lk.shift.get(e?.shiftId ?? '');
  const name = dir?.fullName ?? lk.name(employeeId);

  if (!e) return <EmptyState icon={ClipboardList} title="No HR record" description="This account has no employee record yet." />;
  const field = (k: string, v: React.ReactNode) => (
    <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="mt-1 text-sm text-heading">{v ?? '—'}</dd></div>
  );
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-navy to-navy-500" />
        <div className="-mt-8 flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <Avatar name={name} size={72} className="ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-semibold text-heading">{name}</h2>
            <p className="text-sm text-ink-soft">{[e.designationId, ...e.additionalDesignations].map((d) => lk.designation.get(d)?.name ?? d).join(' · ')} · {lk.department.get(e.departmentId ?? '')?.name ?? 'No department'}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="slate">{e.employeeCode}</Badge>
            <Badge tone={e.employmentStatus === 'Active' ? 'green' : e.employmentStatus === 'Probation' ? 'amber' : 'slate'} dot>{e.employmentStatus}</Badge>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Personal information" subtitle={self ? 'Ask HR to correct anything here.' : undefined} />
          <dl className="grid gap-x-6 gap-y-4 px-5 pb-5 sm:grid-cols-2">
            {field('Email', contact?.email ? <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-ink-mute" />{contact.email}</span> : null)}
            {field('Phone', contact?.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-ink-mute" />{contact.phone}</span> : null)}
            {field('Birthday', e.dateOfBirth ? new Date(`${e.dateOfBirth}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : null)}
            {field('Work location', e.workLocation ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-ink-mute" />{e.workLocation}</span> : null)}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Employment details" />
          <dl className="grid gap-x-6 gap-y-4 px-5 pb-5 sm:grid-cols-2">
            {field('Joining date', fmtDay(e.joiningDate))}
            {field('Reporting manager', e.reportingManagerId ? lk.name(e.reportingManagerId) : null)}
            {field('Shift', shift ? `${shift.name}${shift.flexible ? '' : ` · ${shift.startTime?.slice(0, 5)}–${shift.endTime?.slice(0, 5)}`}` : null)}
            {field('Probation ends', e.employmentStatus === 'Probation' ? fmtDay(e.probationEndDate) : null)}
            {canSalary && field('Salary', salary ? <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-ink-mute" />{salary.currency} {Number(salary.amount).toLocaleString('en-IN')} / {salary.payFrequency}</span> : 'Not recorded')}
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-[15px] font-semibold text-heading">Attendance overview</h3>
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft"><Clock className="h-4 w-4" /> Working hours this month: <b className="text-heading">{hm(net)}</b></span>
        </div>
        <AttendanceCalendar employeeId={employeeId} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-3 font-display text-[15px] font-semibold text-heading">Leave balance</h3>
          {balances.length === 0 ? <p className="text-sm text-ink-soft">No balances yet.</p> : (
            <ul className="space-y-3">
              {balances.map((b) => (
                <li key={b.leaveType} className="flex items-center justify-between rounded-xl bg-canvas p-3">
                  <div><div className="text-sm font-semibold text-heading">{b.name}</div><div className="text-xs text-ink-mute">used {fmtDays(b.used)} · pending {fmtDays(b.pending)}{b.carried ? ` · +${fmtDays(b.carried)} carried` : ''}</div></div>
                  <div className="font-display text-2xl font-semibold text-heading">{fmtDays(b.available)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Leave history" />
          {leave.length === 0 ? <EmptyState icon={Palmtree} title="No leave requests" /> : (
            <Table className="hr-table" head={['Type', 'Dates', 'Days', 'Status', '']}>
              {leave.slice(0, 12).map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-heading">{lk.leaveType.get(r.leaveType)?.name ?? r.leaveType}</td>
                  <td>{leaveWhen(r)}</td>
                  <td>{fmtDays(r.days)}</td>
                  <td><Badge tone={requestTone[r.status]}>{r.status}</Badge></td>
                  <td className="text-right"><Button size="sm" variant="secondary" icon={History} onClick={() => setHistoryOf(r)} aria-label="Review history">History</Button></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Daily work reports" subtitle="Most recent" />
        {reports.length === 0 ? <EmptyState icon={ClipboardList} title="No reports yet" /> : (
          <Table className="hr-table" head={['Date', 'Report', 'Status']}>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>{fmtDay(r.reportDate)}</td>
                <td className="text-ink-soft">{lk.designation.get(r.designationId)?.name ?? r.designationId}</td>
                <td><Badge tone={reportTone[r.status]}>{r.status}</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <LeaveHistoryModal request={historyOf} onClose={() => setHistoryOf(null)} />
    </div>
  );
}

export function EmployeeProfileModal({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const lk = useHRLookup();
  if (!employeeId) return null;
  return (
    <Modal open onClose={onClose} size="wide" title={lk.name(employeeId)} subtitle="Employee profile">
      <EmployeeProfile employeeId={employeeId} />
    </Modal>
  );
}
