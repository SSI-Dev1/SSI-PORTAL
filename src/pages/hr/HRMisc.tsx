// HR reminders, HR report exports and HR settings (policies, shifts, departments).
import { useEffect, useState } from 'react';
import { Bell, Cake, CalendarClock, Download, Palmtree, PartyPopper, Plus, Save, Settings2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Segmented, Switch, Table, Tabs, TimePicker } from '../../components/ui';
import { exportCsv } from '../../components/hr';
import { useToast } from '../../components/feedback';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { DAY_NAMES, MONTHS_SHORT, companyDate, fmtDay, type Reminder, type Shift } from '../../data/hr';
import { cn } from '../../lib/utils';

const icons = { birthday: Cake, anniversary: PartyPopper, probation: CalendarClock, leave: Palmtree, holiday: PartyPopper };

export function HRReminders() {
  const { call } = useHR();
  const [days, setDays] = useState('30');
  const [rows, setRows] = useState<Reminder[]>([]);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.rpc('hr_reminders', { p_days: Number(days) }).then(({ data }) => {
      if (alive) setRows(((data ?? []) as Record<string, string>[]).map((x) => ({ kind: x.kind, onDate: x.on_date, employeeId: x.employee_id, title: x.title, detail: x.detail }) as Reminder));
    });
    return () => {
      alive = false;
    };
  }, [days, rev]);
  return (
    <>
      <PageHeader title="Employee Reminders" subtitle="Birthdays (no birth years shown), work anniversaries, probation completions, upcoming leave and holidays."
        actions={<Button variant="secondary" icon={Bell} onClick={async () => {
          const r = await call<number>('send_hr_reminders', {}, {});
          if (r.ok) { setRev((n) => n + 1); }
        }}>Send today's notifications</Button>} />
      <Card>
        <div className="border-b border-line p-4"><Segmented options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} value={days} onChange={setDays} /></div>
        {rows.length === 0 ? <EmptyState icon={Cake} title="No reminders in this period" /> : (
          <ul className="divide-y divide-line">
            {rows.map((r, i) => {
              const Icon = icons[r.kind];
              return (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-rust dark:bg-brand-500/10"><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1"><div className="font-medium text-heading">{r.title}</div>{r.detail && <div className="text-xs text-ink-soft">{r.detail}</div>}</div>
                  <Badge tone={r.onDate === companyDate() ? 'orange' : 'slate'}>{r.onDate === companyDate() ? 'Today' : fmtDay(r.onDate)}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-mute">Reminder notifications go to HR and the employee's manager (holidays: everyone). They are created once a day when HR opens the portal or presses the button above.</p>
    </>
  );
}

export function HRReports() {
  const { data } = useHR();
  const lk = useHRLookup();
  const toast = useToast();
  const today = companyDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const months = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
  });
  const run = (name: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return toast.info('Nothing to export', 'No records for this period.');
    exportCsv(name, rows);
    toast.success('Report downloaded', `${rows.length} row(s).`);
  };
  const reports = [
    { title: 'Monthly attendance', desc: 'Every attendance day with in/out, breaks, net hours, late and early flags.', go: () => run(`ssi-attendance-${month}`, data.attendance.filter((a) => a.workDate.slice(0, 7) === month).map((a) => ({ Employee: lk.name(a.employeeId), Date: a.workDate, 'Net (min)': a.netMinutes, 'Break (min)': a.breakMinutes, 'Required (min)': a.requiredMinutes, Status: a.state, Late: a.late ? 'Yes' : '', Early: a.earlyCheckout ? 'Yes' : '', Corrected: a.correctedInAt || a.correctedOutAt ? 'Yes' : '' }))) },
    { title: 'Leave taken', desc: 'Approved leave in the month with type and days.', go: () => run(`ssi-leave-${month}`, data.leaveRequests.filter((r) => r.status === 'Approved' && (r.startDate.slice(0, 7) === month || r.endDate.slice(0, 7) === month)).map((r) => ({ Employee: lk.name(r.employeeId), Type: lk.leaveType.get(r.leaveType)?.name, From: r.startDate, To: r.endDate, Days: r.days }))) },
    { title: 'Leave balances', desc: 'Current leave-year balances per employee and type.', go: () => run('ssi-leave-balances', data.balances.map((b) => ({ Employee: lk.name(b.employeeId), Type: b.name, Year: b.leaveYear, Entitled: b.accrued, Carried: b.carried, Used: b.used, Pending: b.pending, Available: b.available }))) },
    { title: 'Daily report submissions', desc: 'Every report in the month with status and submission time.', go: () => run(`ssi-daily-reports-${month}`, data.reports.filter((r) => r.reportDate.slice(0, 7) === month).map((r) => ({ Date: r.reportDate, Employee: lk.name(r.employeeId), Designation: lk.designation.get(r.designationId)?.name, Status: r.status, Submitted: r.submittedAt ?? '' }))) },
    { title: 'Early checkouts', desc: 'Requests, approvals and exceptions in the month.', go: () => run(`ssi-early-checkouts-${month}`, data.earlyCheckouts.filter((r) => r.workDate.slice(0, 7) === month).map((r) => ({ Employee: lk.name(r.employeeId), Date: r.workDate, Status: r.status, Exception: r.override ? 'Yes' : '', Reason: r.reason }))) },
    { title: 'Headcount', desc: 'Employees with designation, department, manager and status.', go: () => run('ssi-headcount', data.directory.map((e) => ({ 'Employee ID': e.employeeCode, Name: e.fullName, Designation: lk.designation.get(e.designationId)?.name, Department: lk.department.get(e.departmentId ?? '')?.name ?? '', Manager: e.reportingManagerId ? lk.name(e.reportingManagerId) : '', Status: e.employmentStatus, Account: e.accountStatus }))) },
  ];
  return (
    <>
      <PageHeader title="HR Reports" subtitle="Downloads for Excel from live records. Use Print / PDF on any HR page for a printable copy." />
      <Card className="mb-5 p-4">
        <Field label="Month"><Segmented options={months.slice(0, 6).map((m) => ({ value: m, label: `${MONTHS_SHORT[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}` }))} value={month} onChange={setMonth} /></Field>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <Card key={r.title} className="flex flex-col p-5">
            <h3 className="font-display text-[15px] font-semibold text-heading">{r.title}</h3>
            <p className="mt-1 flex-1 text-sm text-ink-soft">{r.desc}</p>
            <Button className="mt-4 self-start" variant="secondary" icon={Download} onClick={r.go}>Download (Excel)</Button>
          </Card>
        ))}
      </div>
    </>
  );
}

const SETTING_FORM: { key: string; label: string; kind: 'select' | 'number' | 'bool'; options?: { value: string; label: string }[]; hint?: string }[] = [
  { key: 'location_policy', label: 'Punch location', kind: 'select', options: [{ value: 'optional', label: 'Optional' }, { value: 'approval', label: 'Allowed, HR verifies' }, { value: 'required', label: 'Required' }], hint: 'What happens when an employee denies location access.' },
  { key: 'location_retention_days', label: 'Keep punch locations for (days)', kind: 'number' },
  { key: 'early_checkout_monthly_limit', label: 'Early checkouts per month', kind: 'number', hint: 'Company policy: 2.' },
  { key: 'saturday_offs_per_month', label: 'Saturdays off per month', kind: 'number', hint: 'Company policy: 1. Choose the dates in the Holiday Calendar.' },
  { key: 'leave_year_start_month', label: 'Leave year starts in month (1–12)', kind: 'number' },
  { key: 'leave_approval', label: 'Leave approval', kind: 'select', options: [{ value: 'manager_or_hr', label: 'Manager or HR' }, { value: 'manager_then_hr', label: 'Manager, then HR' }] },
  { key: 'leave_counts_non_working_days', label: 'Count holidays / days off inside leave', kind: 'bool' },
];

export function HRSettings() {
  const { data, write, call } = useHR();
  const { session } = useStore();
  const [tab, setTab] = useState<'policies' | 'shifts' | 'departments'>('policies');
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [shift, setShift] = useState<Partial<Shift> | null>(null);
  const [dept, setDept] = useState('');
  useEffect(() => setVals(Object.fromEntries(data.settings.map((s) => [s.key, s.value]))), [data.settings]);
  const canManageDepts = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('hr_accounts');
  const saveSettings = async () => {
    for (const s of SETTING_FORM) {
      const cur = data.settings.find((x) => x.key === s.key)?.value;
      if (JSON.stringify(cur) !== JSON.stringify(vals[s.key])) await write('company_settings', 'update', { value: vals[s.key] }, { key: s.key }, { refresh: ['settings'] });
    }
  };
  return (
    <>
      <PageHeader title="HR Settings" subtitle="Company policies that were not fixed rules are configured here. Every change is audited." />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'policies', label: 'Policies' }, { value: 'shifts', label: 'Shifts & working days' }, { value: 'departments', label: 'Departments' }]} />
      {tab === 'policies' && (
        <Card className="p-5">
          <div className="grid gap-5 md:grid-cols-2">
            {SETTING_FORM.map((s) => (
              <Field key={s.key} label={s.label} hint={s.hint}>
                {s.kind === 'select' ? <Segmented options={s.options!} value={String(vals[s.key] ?? '')} onChange={(v) => setVals({ ...vals, [s.key]: v })} />
                  : s.kind === 'bool' ? <Switch checked={vals[s.key] === true} onCheckedChange={(v) => setVals({ ...vals, [s.key]: v })} label={s.label} />
                  : <Input inputMode="numeric" value={String(vals[s.key] ?? '')} onChange={(e) => setVals({ ...vals, [s.key]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}
              </Field>
            ))}
            <Field label="Company timezone" hint="Attendance dates follow this timezone."><Input value={String(vals.timezone ?? 'Asia/Kolkata')} readOnly disabled /></Field>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => call<number>('purge_attendance_locations', {}, { success: 'Old locations removed' })}>Remove locations past retention</Button>
            <Button icon={Save} onClick={saveSettings}>Save policies</Button>
          </div>
        </Card>
      )}
      {tab === 'shifts' && (
        <Card>
          <CardHeader title="Shifts" subtitle="Required hours, working days, start window and grace period. Assign shifts per employee." action={<Button size="sm" icon={Plus} onClick={() => setShift({ name: '', flexible: false, startTime: '09:30', endTime: '18:30', graceMinutes: 15, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5, 6], unpaidBreaks: true, active: true })}>Add shift</Button>} />
          <Table className="hr-table" head={['Shift', 'Window', 'Grace', 'Required', 'Working days', 'Breaks', '']}>
            {data.shifts.map((s) => (
              <tr key={s.id}>
                <td className="font-medium text-heading">{s.name}{!s.active && <Badge tone="slate" className="ml-2">Inactive</Badge>}</td>
                <td>{s.flexible ? 'Flexible' : `${s.startTime?.slice(0, 5)} – ${s.endTime?.slice(0, 5)}`}</td>
                <td>{s.flexible ? '—' : `${s.graceMinutes} min`}</td>
                <td>{s.requiredMinutes / 60} h</td>
                <td>{s.workingDays.map((d) => DAY_NAMES[d - 1]).join(', ')}</td>
                <td>{s.unpaidBreaks ? 'Unpaid' : 'Paid'}</td>
                <td className="text-right"><Button size="sm" variant="secondary" icon={Settings2} onClick={() => setShift(s)}>Edit</Button></td>
              </tr>
            ))}
          </Table>
          <p className="p-4 text-xs text-ink-mute">Flexible shifts are never marked late; an early checkout is a day below the required hours. The monthly Saturday off is chosen in the Holiday Calendar.</p>
        </Card>
      )}
      {tab === 'departments' && (
        <Card className="p-5">
          {canManageDepts && (
            <div className="mb-4 flex gap-2">
              <Input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="New department name" />
              <Button icon={Plus} disabled={dept.trim().length < 2} onClick={async () => { if (await write('departments', 'insert', { name: dept.trim() }, undefined, { refresh: ['departments'], success: 'Department added' })) setDept(''); }}>Add</Button>
            </div>
          )}
          <ul className="divide-y divide-line">
            {data.departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2.5">
                <span className={cn('font-medium text-heading', !d.active && 'text-ink-mute line-through')}>{d.name}</span>
                {canManageDepts && <Switch checked={d.active} onCheckedChange={(v) => write('departments', 'update', { active: v }, { id: d.id }, { refresh: ['departments'] })} label={`${d.name} active`} />}
              </li>
            ))}
          </ul>
          <Alert tone="info" className="mt-4">Designations and their report templates are managed by a Super Admin.</Alert>
        </Card>
      )}
      <ShiftModal value={shift} onClose={() => setShift(null)} />
    </>
  );
}

function ShiftModal({ value, onClose }: { value: Partial<Shift> | null; onClose: () => void }) {
  const { write } = useHR();
  const [s, setS] = useState<Partial<Shift>>({});
  const [key, setKey] = useState<string | null>(null);
  if ((value ? value.id ?? 'new' : null) !== key) { setKey(value ? value.id ?? 'new' : null); setS(value ?? {}); }
  const save = async () => {
    const row = {
      name: s.name?.trim(), flexible: !!s.flexible, start_time: s.flexible ? null : s.startTime, end_time: s.flexible ? null : s.endTime,
      grace_minutes: s.graceMinutes ?? 0, required_minutes: s.requiredMinutes ?? 480, working_days: s.workingDays ?? [], unpaid_breaks: s.unpaidBreaks !== false, active: s.active !== false,
    };
    const ok = s.id ? await write('shifts', 'update', row, { id: s.id }, { refresh: ['shifts', 'attendance'], success: 'Shift saved' })
      : await write('shifts', 'insert', row, undefined, { refresh: ['shifts'], success: 'Shift added' });
    if (ok) onClose();
  };
  return (
    <Modal open={!!value} onClose={onClose} title={s.id ? 'Edit shift' : 'Add shift'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={(s.name?.trim().length ?? 0) < 2 || !(s.workingDays?.length)} onClick={save}>Save shift</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={s.name ?? ''} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={!!s.flexible} onCheckedChange={(v) => setS({ ...s, flexible: v })} label="Flexible (no fixed start time)" /></div>
        {!s.flexible && (
          <>
            <Field label="Start"><TimePicker value={(s.startTime ?? '').slice(0, 5)} onChange={(v) => setS({ ...s, startTime: v })} /></Field>
            <Field label="End"><TimePicker value={(s.endTime ?? '').slice(0, 5)} onChange={(v) => setS({ ...s, endTime: v })} /></Field>
            <Field label="Grace period (minutes)"><Input inputMode="numeric" value={String(s.graceMinutes ?? 0)} onChange={(e) => setS({ ...s, graceMinutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
          </>
        )}
        <Field label="Required working hours per day"><Input inputMode="decimal" value={String((s.requiredMinutes ?? 480) / 60)} onChange={(e) => setS({ ...s, requiredMinutes: Math.round((Number(e.target.value.replace(/[^\d.]/g, '')) || 0) * 60) })} /></Field>
        <Field label="Working days" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {DAY_NAMES.map((d, i) => {
              const on = (s.workingDays ?? []).includes(i + 1);
              return <button key={d} type="button" onClick={() => setS({ ...s, workingDays: on ? (s.workingDays ?? []).filter((x) => x !== i + 1) : [...(s.workingDays ?? []), i + 1].sort() })}
                className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold', on ? 'border-rust bg-brand-50 text-rust dark:bg-brand-500/10' : 'border-line text-ink-soft')}>{d}</button>;
            })}
          </div>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox checked={s.unpaidBreaks !== false} onCheckedChange={(v) => setS({ ...s, unpaidBreaks: v })} label="Breaks are unpaid (not counted in working hours)" />
          <Checkbox checked={s.active !== false} onCheckedChange={(v) => setS({ ...s, active: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

