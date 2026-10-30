// My leave: balances (from the ledger), apply, history and cancellation.
import { useEffect, useState } from 'react';
import { CalendarPlus, Palmtree } from 'lucide-react';
import { Alert, Badge, Button, Card, DateRangePicker, EmptyState, Field, Modal, PageHeader, Segmented, Table, Textarea } from '../../components/ui';
import { requestTone } from '../../components/hr';
import { useConfirm } from '../../components/feedback';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDay } from '../../data/hr';

export default function MyLeave() {
  const { data, call, now } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const confirm = useConfirm();
  const me = session?.userId;
  const [open, setOpen] = useState(false);
  const balances = data.balances.filter((b) => b.employeeId === me);
  const history = data.leaveRequests.filter((r) => r.employeeId === me);
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
                <div className="text-right"><div className="font-display text-3xl font-semibold text-heading">{b.available}</div><div className="text-xs text-ink-soft">available</div></div>
              </div>
              <dl className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Entitled</dt><dd className="font-semibold text-heading">{b.accrued}{b.accrued !== b.entitled ? `/${b.entitled}` : ''}</dd></div>
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Carried</dt><dd className="font-semibold text-heading">{b.carried}</dd></div>
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Used</dt><dd className="font-semibold text-heading">{b.used}</dd></div>
                <div className="rounded-xl bg-canvas p-2"><dt className="text-ink-mute">Pending</dt><dd className="font-semibold text-heading">{b.pending}</dd></div>
              </dl>
              {b.adjusted !== 0 && <p className="mt-2 text-[11px] text-ink-mute">Adjustments: {b.adjusted > 0 ? '+' : ''}{b.adjusted}</p>}
            </Card>
          );
        })}
      </div>
      <Card>
        {history.length === 0 ? <EmptyState icon={Palmtree} title="No leave requests yet" /> : (
          <Table className="hr-table" head={['Type', 'Dates', 'Days', 'Reason', 'Status', '']}>
            {history.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-heading">{lk.leaveType.get(r.leaveType)?.name}</td>
                <td>{fmtDay(r.startDate)}{r.endDate !== r.startDate && ` – ${fmtDay(r.endDate)}`}</td>
                <td>{r.days}</td>
                <td className="max-w-[240px] truncate text-ink-soft">{r.reason}</td>
                <td><Badge tone={requestTone[r.status]}>{r.status}</Badge>{r.decidedBy && <div className="text-[11px] text-ink-mute">by {lk.name(r.decidedBy)}</div>}</td>
                <td className="text-right">
                  {(r.status === 'Pending' || (r.status === 'Approved' && r.startDate > today)) && (
                    <Button size="sm" variant="secondary" onClick={async () => {
                      if (!(await confirm({ title: 'Cancel this leave?', message: r.status === 'Approved' ? 'The days are returned to your balance.' : 'The request is withdrawn.', confirmLabel: 'Cancel leave', danger: true }))) return;
                      await call('cancel_leave', { p_id: r.id }, { refresh: ['leaveRequests', 'balances'], success: 'Leave cancelled' });
                    }}>Cancel</Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ApplyLeaveModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ApplyLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, call } = useHR();
  const { session } = useStore();
  const types = data.leaveTypes.filter((t) => t.active);
  const [type, setType] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setType(types[0]?.id ?? ''); setRange({ from: '', to: '' }); setReason(''); setDays(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Working days in the range, counted by the server (holidays and days off excluded).
  useEffect(() => {
    setDays(null);
    if (!supabase || !session || !range.from) return;
    let alive = true;
    void supabase.rpc('count_leave_days', { p_emp: session.userId, p_start: range.from, p_end: range.to || range.from }).then(({ data: n }) => {
      if (alive && n != null) setDays(Number(n));
    });
    return () => {
      alive = false;
    };
  }, [range.from, range.to, session]);
  const bal = data.balances.find((b) => b.employeeId === session?.userId && b.leaveType === type);
  const submit = async () => {
    setBusy(true);
    const r = await call('apply_leave', { p_type: type, p_start: range.from, p_end: range.to || range.from, p_reason: reason }, {
      refresh: ['leaveRequests', 'balances'], success: 'Leave requested', successDetail: 'Your manager / HR will review it.',
    });
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Apply for leave" dirty={!!(range.from || reason)}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !type || !range.from || !days || reason.trim().length < 3} onClick={submit}>Submit request</Button></>}>
      <div className="space-y-4">
        <Field label="Leave type" required><Segmented options={types.map((t) => ({ value: t.id, label: t.name }))} value={type} onChange={setType} /></Field>
        <Field label="Dates" required><DateRangePicker from={range.from} to={range.to} onChange={setRange} aria-label="Leave dates" /></Field>
        {range.from && (
          days === 0 ? <Alert tone="info">These dates are holidays or days off — no leave is needed.</Alert> :
          days != null && <Alert tone={bal && bal.available < days ? 'warning' : 'info'}>
            {days} working day(s) · {bal ? `${bal.available} ${bal.name} available` : ''}{bal && bal.available < days ? ' — not enough balance' : ''}
          </Alert>
        )}
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
