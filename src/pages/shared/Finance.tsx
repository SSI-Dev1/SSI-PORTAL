import { useMemo, useState } from 'react';
import { AlertCircle, Banknote, CheckCircle2, Clock, Download, MoreHorizontal, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Card, CardHeader, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, Pagination, Progress, SearchInput, Select, Table, usePaged } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { useLookup, useScoped, useStore } from '../../store/store';
import { useChartColors } from '../../theme/theme';
import type { Payment, PaymentStatus, PaymentType } from '../../data/types';
import { daysUntil, formatDate, fromDateInput, fullName, matches, money, toDateInput, type Tone } from '../../lib/utils';

const tone: Record<PaymentStatus, Tone> = { Paid: 'green', Pending: 'amber', Overdue: 'red', 'Partially Paid': 'blue' };
const TYPES: PaymentType[] = ['Application Fee', 'Tuition Deposit', 'Service Fee', 'Commission'];

const effectiveStatus = (p: Payment): PaymentStatus => (p.status !== 'Paid' && daysUntil(p.dueDate) < 0 && p.paid < p.amount ? 'Overdue' : p.status);

export default function Finance() {
  const scoped = useScoped();
  const lk = useLookup();
  const { actions } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const c = useChartColors();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [paying, setPaying] = useState<Payment>();

  const all = scoped.payments.map((p) => ({ ...p, status: effectiveStatus(p) }));
  const rows = useMemo(
    () =>
      all
        .filter((p) => matches(q, p.invoiceNo, p.description, lk.partner.get(p.partnerId)?.name))
        .filter((p) => !status || p.status === status)
        .filter((p) => !type || p.type === type)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [all, q, status, type, lk],
  );
  const paged = usePaged(rows, 10, `${q}${status}${type}`);

  const total = all.reduce((s, p) => s + p.amount, 0);
  const paid = all.reduce((s, p) => s + p.paid, 0);
  const overdue = all.filter((p) => p.status === 'Overdue').reduce((s, p) => s + (p.amount - p.paid), 0);
  const byType = TYPES.map((t) => ({
    type: t.replace(' Fee', '').replace('Tuition ', ''),
    Collected: all.filter((p) => p.type === t).reduce((s, p) => s + p.paid, 0),
    Outstanding: all.filter((p) => p.type === t).reduce((s, p) => s + p.amount - p.paid, 0),
  }));

  const cards = [
    { label: 'Total invoiced', value: money(total), icon: Receipt, cls: 'bg-navy-50 text-heading' },
    { label: 'Collected', value: money(paid), icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600' },
    { label: 'Outstanding', value: money(total - paid), icon: Clock, cls: 'bg-amber-50 text-amber-600' },
    { label: 'Overdue', value: money(overdue), icon: AlertCircle, cls: 'bg-red-50 text-red-600' },
  ];

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle={scoped.isAdmin ? 'Invoices, collections and partner commissions.' : 'Fees and payment status for your workspace.'}
        actions={scoped.isAdmin && <Button icon={Plus} onClick={() => setNewOpen(true)}>New Invoice</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c, i) => (
          <Card key={c.label} className="animate-fade-up p-5" >
            <div style={{ animationDelay: `${i * 60}ms` }} className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.cls}`}>
                <c.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-ink-soft">{c.label}</div>
                <div className="truncate font-display text-xl font-semibold text-heading">{c.value}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Collections by fee type" subtitle="Collected vs outstanding (USD equivalent)" />
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byType} barGap={4}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="type" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: c.tick }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.tickMute }} tickFormatter={(v) => `$${v / 1000}k`} width={44} />
                <Tooltip cursor={{ fill: c.cursor }} formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, ...c.tooltip }} />
                <Bar dataKey="Collected" fill={c.navy} radius={[6, 6, 0, 0]} maxBarSize={34} />
                <Bar dataKey="Outstanding" fill="#FBA51E" radius={[6, 6, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-display text-[15px] font-semibold text-heading">Collection rate</h3>
          <div className="mt-4 font-display text-4xl font-semibold text-heading">{total ? Math.round((paid / total) * 100) : 0}%</div>
          <Progress value={total ? (paid / total) * 100 : 0} className="mt-3 h-2.5" />
          <div className="mt-6 space-y-3">
            {(['Paid', 'Partially Paid', 'Pending', 'Overdue'] as PaymentStatus[]).map((s) => (
              <button key={s} type="button" onClick={() => setStatus(status === s ? '' : s)} className="flex w-full items-center justify-between text-sm hover:opacity-80">
                <Badge tone={tone[s]} dot>
                  {s}
                </Badge>
                <span className="font-semibold text-heading">{all.filter((p) => p.status === s).length}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search invoice or description…" className="lg:w-96" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            <FilterSelect label="All types" value={type} onChange={setType} options={TYPES} />
            <FilterSelect label="All statuses" value={status} onChange={setStatus} options={['Paid', 'Partially Paid', 'Pending', 'Overdue']} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No invoices found" description="Adjust filters to see more." />
        ) : (
          <>
            <Table head={['Invoice', 'Description', ...(scoped.isAdmin ? ['Partner'] : []), 'Type', 'Amount', 'Paid', 'Due', 'Status', '']}>
              {paged.rows.map((p) => {
                const d = daysUntil(p.dueDate);
                return (
                  <tr key={p.id} className="hover:bg-brand-50/30">
                    <td className="whitespace-nowrap px-5 py-3.5 font-semibold text-heading">{p.invoiceNo}</td>
                    <td className="max-w-[240px] truncate px-5 py-3.5 text-ink-soft">{p.description}</td>
                    {scoped.isAdmin && <td className="px-5 py-3.5 text-ink-soft">{lk.partner.get(p.partnerId)?.code}</td>}
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{p.type}</td>
                    <td className="px-5 py-3.5 font-semibold text-heading">{money(p.amount)}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{money(p.paid)}</td>
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <div className="text-ink-soft">{formatDate(p.dueDate)}</div>
                      {p.status !== 'Paid' && <div className={`text-[11px] ${d < 0 ? 'text-red-600' : 'text-ink-mute'}`}>{d < 0 ? `${-d}d overdue` : d === 0 ? 'Due today' : `in ${d}d`}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone={tone[p.status]} dot>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <Menu
                        trigger={() => (
                          <button type="button" aria-label="Invoice actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-heading">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        )}
                        items={[
                          { label: 'Download invoice', icon: Download, onClick: () => downloadInvoice(p, lk.partner.get(p.partnerId)?.name ?? '', p.studentId ? fullName(lk.student.get(p.studentId)) : '') },
                          ...(scoped.isAdmin && p.status !== 'Paid'
                            ? [{ label: 'Record payment', icon: Banknote, onClick: () => setPaying(p) }]
                            : []),
                          ...(scoped.isAdmin
                            ? [
                                {
                                  label: 'Delete',
                                  icon: Trash2,
                                  danger: true,
                                  onClick: async () => {
                                    if (await confirm({ title: 'Delete invoice?', message: `${p.invoiceNo} will be removed.`, danger: true, confirmLabel: 'Delete' })) {
                                      actions.removePayment(p.id);
                                      toast.success('Invoice deleted');
                                    }
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="invoices" />
          </>
        )}
      </Card>

      <NewInvoice open={newOpen} onClose={() => setNewOpen(false)} />
      <RecordPayment payment={paying} onClose={() => setPaying(undefined)} />
    </>
  );
}

function downloadInvoice(p: Payment, partner: string, student: string) {
  const text = [
    'SSI GLOBAL — INVOICE',
    '',
    `Invoice:     ${p.invoiceNo}`,
    `Partner:     ${partner}`,
    student ? `Student:     ${student}` : '',
    `Type:        ${p.type}`,
    `Description: ${p.description}`,
    `Amount:      ${money(p.amount)}`,
    `Paid:        ${money(p.paid)}`,
    `Balance:     ${money(p.amount - p.paid)}`,
    `Due date:    ${formatDate(p.dueDate)}`,
    `Status:      ${p.status}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.invoiceNo}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function NewInvoice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scoped = useScoped();
  const { actions } = useStore();
  const toast = useToast();
  const [partner, setPartner] = useState('');
  const [student, setStudent] = useState('');
  const [type, setType] = useState<PaymentType>('Application Fee');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(toDateInput(new Date(Date.now() + 14 * 86400000).toISOString()));
  const save = () => {
    const amt = Number(amount);
    if (!partner || !amt || amt <= 0 || !due) return toast.error('Partner, amount and due date are required');
    const s = scoped.students.find((x) => x.id === student);
    actions.addPayment({
      partnerId: partner,
      studentId: student || undefined,
      type,
      description: s ? `${type} — ${fullName(s)}` : `${type} — ${scoped.partners.find((p) => p.id === partner)?.name}`,
      amount: amt,
      paid: 0,
      dueDate: fromDateInput(due),
      status: 'Pending',
    });
    toast.success('Invoice created');
    setAmount('');
    setStudent('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="New invoice" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Create invoice</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Partner" required>
          <Select value={partner} onChange={(e) => { setPartner(e.target.value); setStudent(''); }}>
            <option value="">Select partner…</option>
            {scoped.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Student (optional)">
          <Select value={student} onChange={(e) => setStudent(e.target.value)} disabled={!partner}>
            <option value="">—</option>
            {scoped.students.filter((s) => s.partnerId === partner).map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
          </Select>
        </Field>
        <Field label="Fee type">
          <Select value={type} onChange={(e) => setType(e.target.value as PaymentType)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Amount (USD)" required>
          <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250" />
        </Field>
        <Field label="Due date" required>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function RecordPayment({ payment, onClose }: { payment?: Payment; onClose: () => void }) {
  const { actions } = useStore();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  if (!payment) return null;
  const balance = payment.amount - payment.paid;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Record payment · ${payment.invoiceNo}`}
      subtitle={`Balance due ${money(balance)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const amt = Number(amount || balance);
              if (amt <= 0) return toast.error('Enter a valid amount');
              actions.recordPayment(payment.id, amt);
              toast.success('Payment recorded', `${money(Math.min(amt, balance))} applied to ${payment.invoiceNo}`);
              setAmount('');
              onClose();
            }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <Field label="Amount received" hint="Leave blank to record the full balance.">
        <Input type="number" min="1" max={balance} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balance)} autoFocus />
      </Field>
    </Modal>
  );
}
