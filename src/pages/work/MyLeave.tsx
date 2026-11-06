// My leave: balances (from the ledger), apply, history and cancellation.
import { useEffect, useState } from 'react';
import { CalendarPlus, History, Palmtree } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DatePicker, DateRangePicker, EmptyState, Field, Modal, PageHeader, Segmented, Table, Tabs, Textarea } from '../../components/ui';
import { requestTone } from '../../components/hr';
import { AttendanceCalendar, LeaveHistoryModal, leaveWhen } from '../../components/hrProfile';
import { useConfirm } from '../../components/feedback';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDays, halfDayLabel, type LeaveRequest } from '../../data/hr';

export default function MyLeave() {
  const { data, call, now } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const confirm = useConfirm();
  const me = session?.userId;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'>('all');
  const [historyOf, setHistoryOf] = useState<LeaveRequest | null>(null);
  const balances = data.balances.filter((b) => b.employeeId === me);
  const mine = data.leaveRequests.filter((r) => r.employeeId === me);
  const history = mine.filter((r) => filter === 'all' || r.status === filter);
  const count = (st: string) => mine.filter((r) => r.status === st).length;
  const today = companyDate(now());
  return (
    <>
      <PageHeader title="My Leave" subtitle="Balances update when a request is approved; pending requests are reserved, not deducted."
        actions={<Button icon={CalendarPlus} onClick={() => setOpen(true)}>Apply for leave</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {balances.map((b) => {
          const t = lk.leaveType.get(b.leaveType);
          return (
            <Card key={b.leaveType} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-heading">{b.name}</div>
                  <div className="text-xs text-ink-mute">Leave year {b.leaveYear}{t ? ` · ${t.carryForward ? 'unused days carry forward' : 'unused days lapse at year end'}` : ''}</div>
                </div>
                <div className="text-right"><div className="font-display text-3xl font-semibold text-heading">{fmtDays(b.available)}</div><div className="text-xs text-ink-soft">available</div></div>
              </div>
              <dl className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Entitled</dt><dd className="font-semibold text-heading">{fmtDays(b.accrued)}{b.accrued !== b.entitled ? `/${fmtDays(b.entitled)}` : ''}</dd></div>
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Carried</dt><dd className="font-semibold text-heading">{fmtDays(b.carried)}</dd></div>
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Used</dt><dd className="font-semibold text-heading">{fmtDays(b.used)}</dd></div>
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Pending</dt><dd className="font-semibold text-heading">{fmtDays(b.pending)}</dd></div>
              </dl>
              {b.adjusted !== 0 && <p className="mt-2 text-[11px] text-ink-mute">Adjustments: {b.adjusted > 0 ? '+' : ''}{b.adjusted}</p>}
            </Card>
          );
        })}
      </div>
      <Card>
        <div className="border-b border-line px-5 pt-3">
          <Tabs value={filter} onChange={setFilter} className="border-b-0" tabs={[
            { value: 'all', label: 'Leave history', count: mine.length },
            { value: 'Pending', label: 'Pending', count: count('Pending') },
            { value: 'Approved', label: 'Approved', count: count('Approved') },
            { value: 'Rejected', label: 'Rejected', count: count('Rejected') },
            { value: 'Cancelled', label: 'Cancelled', count: count('Cancelled') },
          ]} />
        </div>
        {history.length === 0 ? <EmptyState icon={Palmtree} title={mine.length ? 'Nothing here' : 'No leave requests yet'} /> : (
          <Table className="hr-table" head={['Type', 'Dates', 'Days', 'Reason', 'Status', '']}>
            {history.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-heading">{lk.leaveType.get(r.leaveType)?.name}</td>
                <td>{leaveWhen(r)}</td>
                <td>{fmtDays(r.days)}</td>
                <td className="max-w-[240px] truncate text-ink-soft">{r.reason}</td>
                <td><Badge tone={requestTone[r.status]}>{r.status}</Badge>{r.decidedBy && <div className="text-[11px] text-ink-mute">by {lk.name(r.decidedBy)}</div>}</td>
                <td className="text-right">
                  <span className="inline-flex gap-1.5">
                  <Button size="sm" variant="secondary" icon={History} onClick={() => setHistoryOf(r)} aria-label="Review history" />
                  {(r.status === 'Pending' || (r.status === 'Approved' && r.startDate > today)) && (
                    <Button size="sm" variant="secondary" onClick={async () => {
                      if (!(await confirm({ title: 'Cancel this leave?', message: r.status === 'Approved' ? 'The days are returned to your balance.' : 'The request is withdrawn.', confirmLabel: 'Cancel leave', danger: true }))) return;
                      await call('cancel_leave', { p_id: r.id }, { refresh: ['leaveRequests', 'balances'], success: 'Leave cancelled' });
                    }}>Cancel</Button>
                  )}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {me && (
        <Card className="mt-6">
          <CardHeader title="Leave calendar" subtitle="Approved leave, half days and attendance, as HR and payroll see them." />
          <div className="px-5 pb-5"><AttendanceCalendar employeeId={me} /></div>
        </Card>
      )}
      <ApplyLeaveModal open={open} onClose={() => setOpen(false)} />
      <LeaveHistoryModal request={historyOf} onClose={() => setHistoryOf(null)} />
    </>
  );
}

function ApplyLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, call } = useHR();
  const { session } = useStore();
  const types = data.leaveTypes.filter((t) => t.active);
  const [type, setType] = useState('');
  const [mode, setMode] = useState<'full' | 'half'>('full');
  const [session2, setSession2] = useState<'morning' | 'afternoon'>('morning');
  const [range, setRange] = useState({ from: '', to: '' });
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setType(types[0]?.id ?? ''); setMode('full'); setSession2('morning'); setRange({ from: '', to: '' }); setReason(''); setDays(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const to = mode === 'half' ? range.from : range.to || range.from;
  // Working days in the range, counted by the server (holidays and days off excluded).
  useEffect(() => {
    setDays(null);
    if (!supabase || !session || !range.from) return;
    let alive = true;
    void supabase.rpc('count_leave_days', { p_emp: session.userId, p_start: range.from, p_end: to }).then(({ data: n }) => {
      if (alive && n != null) setDays(Number(n));
    });
    return () => {
      alive = false;
    };
  }, [range.from, to, session]);
  const t = types.find((x) => x.id === type);
  const unpaid = t?.paid === false;
  const need = days == null ? null : days === 0 ? 0 : mode === 'half' ? 0.5 : days;
  const bal = data.balances.find((b) => b.employeeId === session?.userId && b.leaveType === type);
  const submit = async () => {
    setBusy(true);
    const r = await call('apply_leave', { p_type: type, p_start: range.from, p_end: to, p_reason: reason, p_half: mode === 'half' ? session2 : null }, {
      refresh: ['leaveRequests', 'balances'], success: 'Leave requested', successDetail: 'Your manager / HR will review it.',
    });
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Apply for leave" subtitle="Sick Leave and Paid Leave use your balance; Loss of Pay is unpaid." dirty={!!(range.from || reason)}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !type || !range.from || !need || reason.trim().length < 3} onClick={submit}>Submit request</Button></>}>
      <div className="space-y-4">
        <Field label="Leave type" required><Segmented options={types.map((x) => ({ value: x.id, label: x.name }))} value={type} onChange={setType} /></Field>
        <Field label="Duration" required><Segmented options={[{ value: 'full', label: 'Full day(s)' }, { value: 'half', label: 'Half day' }]} value={mode} onChange={(v) => setMode(v as 'full' | 'half')} /></Field>
        {mode === 'half' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required><DatePicker value={range.from} onChange={(v) => setRange({ from: v ?? '', to: v ?? '' })} /></Field>
            <Field label="Session" required><Segmented options={[{ value: 'morning', label: 'Morning' }, { value: 'afternoon', label: 'Afternoon' }]} value={session2} onChange={(v) => setSession2(v as 'morning' | 'afternoon')} /></Field>
          </div>
        ) : (
          <Field label="Dates" required><DateRangePicker from={range.from} to={range.to} onChange={setRange} aria-label="Leave dates" /></Field>
        )}
        {range.from && (
          need === 0 ? <Alert tone="info">{mode === 'half' ? 'This date is a holiday or day off' : 'These dates are holidays or days off'} — no leave is needed.</Alert> :
          need != null && <Alert tone={!unpaid && bal && bal.available < need ? 'warning' : 'info'}>
            {mode === 'half' ? `${halfDayLabel(session2)} · 0.5 day` : `${fmtDays(need)} working day(s)`}
            {unpaid ? ' · unpaid (Loss of Pay), no balance used' : bal ? ` · ${fmtDays(bal.available)} ${bal.name} available` : ''}
            {!unpaid && bal && bal.available < need ? ' — not enough balance; choose Loss of Pay for unpaid leave' : ''}
          </Alert>
        )}
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
