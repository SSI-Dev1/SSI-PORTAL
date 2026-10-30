// HR leave management: approvals, every employee's balances (from the ledger), audited
// adjustments and the leave policy (entitlement, carry forward, accrual, prorating).
import { useState } from 'react';
import { Palmtree, Settings2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Segmented, Table, Tabs } from '../../components/ui';
import { ApprovalsPanel, ExportButtons, requestTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { fmtDay, type LeaveType } from '../../data/hr';

export default function HRLeave() {
  const { data, call } = useHR();
  const lk = useHRLookup();
  const [tab, setTab] = useState<'approvals' | 'balances' | 'history' | 'policy'>('approvals');
  const [status, setStatus] = useState('');
  const [adjust, setAdjust] = useState<{ emp: string; type: string; days: string; note: string } | null>(null);
  const [policy, setPolicy] = useState<LeaveType | null>(null);
  const emps = [...new Set(data.balances.map((b) => b.employeeId))];
  const history = data.leaveRequests.filter((r) => !status || r.status === status);
  return (
    <>
      <PageHeader title="Leave Management" subtitle="Sick Leave lapses at year end; Paid Leave carries forward. Balances change only when leave is approved or cancelled."
        actions={<ExportButtons filename="ssi-leave" rows={() => tab === 'balances'
          ? data.balances.map((b) => ({ Employee: lk.name(b.employeeId), Type: b.name, Year: b.leaveYear, Entitled: b.accrued, Carried: b.carried, Adjusted: b.adjusted, Used: b.used, Pending: b.pending, Available: b.available }))
          : history.map((r) => ({ Employee: lk.name(r.employeeId), Type: lk.leaveType.get(r.leaveType)?.name, From: r.startDate, To: r.endDate, Days: r.days, Status: r.status, 'Decided by': r.decidedBy ? lk.name(r.decidedBy) : '' }))} />} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { value: 'approvals', label: 'Approvals', count: data.leaveRequests.filter((r) => r.status === 'Pending').length },
        { value: 'balances', label: 'Balances' }, { value: 'history', label: 'All requests' }, { value: 'policy', label: 'Policy' },
      ]} />
      {tab === 'approvals' && <ApprovalsPanel kinds={['leave']} />}
      {tab === 'balances' && (
        <Card>
          {emps.length === 0 ? <EmptyState icon={Palmtree} title="No balances yet" /> : (
            <Table className="hr-table" head={['Employee', ...data.leaveTypes.filter((t) => t.active).map((t) => `${t.name} (avail. / used / pending)`), '']}>
              {emps.map((id) => (
                <tr key={id}>
                  <td className="font-medium text-heading">{lk.name(id)}</td>
                  {data.leaveTypes.filter((t) => t.active).map((t) => {
                    const b = data.balances.find((x) => x.employeeId === id && x.leaveType === t.id);
                    return <td key={t.id} className="tabular-nums">{b ? <><b className="text-heading">{b.available}</b> / {b.used} / {b.pending}{b.carried ? <span className="text-xs text-ink-mute"> · +{b.carried} carried</span> : null}</> : '—'}</td>;
                  })}
                  <td className="text-right"><Button size="sm" variant="secondary" onClick={() => setAdjust({ emp: id, type: data.leaveTypes[0]?.id ?? '', days: '', note: '' })}>Adjust</Button></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === 'history' && (
        <Card>
          <div className="border-b border-line p-4"><FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'Any status' }, 'Pending', 'Approved', 'Rejected', 'Cancelled']} /></div>
          {history.length === 0 ? <EmptyState icon={Palmtree} title="No leave requests" /> : (
            <Table className="hr-table" head={['Employee', 'Type', 'Dates', 'Days', 'Status', 'Decided by', '']}>
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-heading">{lk.name(r.employeeId)}</td>
                  <td>{lk.leaveType.get(r.leaveType)?.name}</td>
                  <td>{fmtDay(r.startDate)}{r.endDate !== r.startDate && ` – ${fmtDay(r.endDate)}`}</td>
                  <td>{r.days}</td>
                  <td><Badge tone={requestTone[r.status]}>{r.status}</Badge></td>
                  <td className="text-ink-soft">{r.decidedBy ? lk.name(r.decidedBy) : '—'}</td>
                  <td className="text-right">{r.status === 'Approved' && <Button size="sm" variant="secondary" onClick={() => call('cancel_leave', { p_id: r.id }, { refresh: ['leaveRequests', 'balances'], success: 'Leave cancelled', successDetail: 'Days returned to the balance.' })}>Cancel</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {tab === 'policy' && (
        <Card>
          <Table className="hr-table" head={['Leave type', 'Days / year', 'Unused days', 'Accrual', 'New joiners', 'Eligible after', '']}>
            {data.leaveTypes.map((t) => (
              <tr key={t.id}>
                <td className="font-medium text-heading">{t.name}{!t.active && <Badge tone="slate" className="ml-2">Inactive</Badge>}</td>
                <td>{t.annualDays}</td>
                <td>{t.carryForward ? `Carry forward${t.carryForwardMax != null ? ` (max ${t.carryForwardMax})` : ' (no limit)'}` : 'Lapse at year end'}</td>
                <td>{t.accrual === 'monthly' ? 'Monthly' : 'Start of year'}</td>
                <td>{t.prorateNewJoiners ? 'Prorated' : 'Full entitlement'}</td>
                <td>{t.eligibleAfterDays ? `${t.eligibleAfterDays} days` : 'Immediately'}</td>
                <td className="text-right"><Button size="sm" variant="secondary" icon={Settings2} onClick={() => setPolicy(t)}>Edit</Button></td>
              </tr>
            ))}
          </Table>
          <p className="p-4 text-xs text-ink-mute">Leave year, approval flow and whether holidays inside a leave count are set in HR Settings.</p>
        </Card>
      )}
      <Modal open={!!adjust} onClose={() => setAdjust(null)} size="sm" title={`Adjust balance · ${lk.name(adjust?.emp)}`} subtitle="Recorded in the leave ledger with your note."
        footer={<><Button variant="secondary" onClick={() => setAdjust(null)}>Cancel</Button><Button disabled={!adjust || !Number(adjust.days) || adjust.note.trim().length < 3} onClick={async () => {
          if (!adjust) return;
          const r = await call('adjust_leave', { p_emp: adjust.emp, p_type: adjust.type, p_days: Number(adjust.days), p_note: adjust.note }, { refresh: ['balances'], success: 'Balance adjusted' });
          if (r.ok) setAdjust(null);
        }}>Save adjustment</Button></>}>
        {adjust && (
          <div className="space-y-4">
            <Field label="Leave type"><Segmented options={data.leaveTypes.map((t) => ({ value: t.id, label: t.name }))} value={adjust.type} onChange={(v) => setAdjust({ ...adjust, type: v })} /></Field>
            <Field label="Days (+ to add, − to remove)"><Input inputMode="decimal" value={adjust.days} onChange={(e) => setAdjust({ ...adjust, days: e.target.value.replace(/[^\d.-]/g, '') })} /></Field>
            <Field label="Note" required><Input value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <PolicyModal value={policy} onClose={() => setPolicy(null)} />
    </>
  );
}

function PolicyModal({ value, onClose }: { value: LeaveType | null; onClose: () => void }) {
  const { write } = useHR();
  const [t, setT] = useState<LeaveType | null>(null);
  const [key, setKey] = useState<string | null>(null);
  if ((value?.id ?? null) !== key) { setKey(value?.id ?? null); setT(value ? { ...value } : null); }
  if (!t) return null;
  const save = async () => {
    const ok = await write('leave_types', 'update', {
      annual_days: t.annualDays, carry_forward: t.carryForward, carry_forward_max: t.carryForward ? t.carryForwardMax : null, accrual: t.accrual,
      prorate_new_joiners: t.prorateNewJoiners, eligible_after_days: t.eligibleAfterDays, requires_reason: t.requiresReason, active: t.active, updated_at: new Date().toISOString(),
    }, { id: t.id }, { refresh: ['leaveTypes', 'balances'], success: 'Policy saved' });
    if (ok) onClose();
  };
  return (
    <Modal open={!!value} onClose={onClose} title={`${t.name} policy`} subtitle="Changes apply to future grants; existing ledger entries are kept."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save policy</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Days per leave year"><Input inputMode="decimal" value={String(t.annualDays)} onChange={(e) => setT({ ...t, annualDays: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></Field>
        <Field label="Eligible after (days from joining)"><Input inputMode="numeric" value={String(t.eligibleAfterDays)} onChange={(e) => setT({ ...t, eligibleAfterDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
        <Field label="Accrual"><Segmented options={[{ value: 'upfront', label: 'Start of year' }, { value: 'monthly', label: 'Monthly' }]} value={t.accrual} onChange={(v) => setT({ ...t, accrual: v as LeaveType['accrual'] })} /></Field>
        <Field label="Unused days"><Segmented options={[{ value: 'lapse', label: 'Lapse' }, { value: 'carry', label: 'Carry forward' }]} value={t.carryForward ? 'carry' : 'lapse'} onChange={(v) => setT({ ...t, carryForward: v === 'carry' })} /></Field>
        {t.carryForward && (
          <Field label="Carry-forward limit" hint="Leave empty for no limit" className="sm:col-span-2">
            <Input inputMode="decimal" value={t.carryForwardMax == null ? '' : String(t.carryForwardMax)} onChange={(e) => setT({ ...t, carryForwardMax: e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')) })} />
          </Field>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Checkbox checked={t.prorateNewJoiners} onCheckedChange={(v) => setT({ ...t, prorateNewJoiners: v })} label="Prorate for employees joining during the leave year" />
          <Checkbox checked={t.requiresReason} onCheckedChange={(v) => setT({ ...t, requiresReason: v })} label="Reason required" />
          <Checkbox checked={t.active} onCheckedChange={(v) => setT({ ...t, active: v })} label="Active" />
        </div>
        {t.id === 'sick' && t.carryForward && <Alert tone="warning" className="sm:col-span-2">Company policy: Sick Leave does not carry forward.</Alert>}
      </div>
    </Modal>
  );
}
