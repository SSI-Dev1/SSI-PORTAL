// Holiday calendar: month view with holidays, the HR-chosen Saturday off and extra working
// days; annual list below. HR (and Super Admin) can add, edit, deactivate and remove holidays
// and choose the Saturday off for each month.
import { useMemo, useState } from 'react';
import { CalendarCheck2, CalendarOff, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Segmented, Switch, Table } from '../../components/ui';
import { useConfirm } from '../../components/feedback';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { DAY_NAMES, MONTHS_SHORT, addDays, companyDate, fmtDay, isoDow, type Holiday } from '../../data/hr';
import { isHR } from '../../auth/roles';
import { cn } from '../../lib/utils';

export default function Holidays() {
  const { data, write, now } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const confirm = useConfirm();
  const canEdit = isHR(session);
  const today = companyDate(now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState<Partial<Holiday> | null>(null);
  const first = `${month}-01`;
  const lead = isoDow(first) - 1;
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) out.push(d);
    return out;
  }, [first, month]);
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const hol = (d: string) => data.holidays.filter((h) => h.holidayDate === d && h.active);
  const cal = (d: string) => data.calendar.find((c) => c.workDate === d && !c.shiftId);
  const satOff = data.calendar.find((c) => c.kind === 'saturday_off' && !c.shiftId && c.workDate.slice(0, 7) === month);
  const year = month.slice(0, 4);
  const yearList = data.holidays.filter((h) => h.holidayDate.startsWith(year)).sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));

  const toggleSaturday = async (d: string) => {
    if (!canEdit) return;
    const existing = cal(d);
    if (existing?.kind === 'saturday_off') {
      await write('work_calendar', 'delete', {}, { id: existing.id }, { refresh: ['calendar'], success: 'Saturday is a working day again' });
    } else {
      if (satOff) await write('work_calendar', 'delete', {}, { id: satOff.id }, { refresh: ['calendar'] });
      await write('work_calendar', 'insert', { work_date: d, kind: 'saturday_off', note: 'Monthly Saturday off' }, undefined, { refresh: ['calendar'], success: `Saturday off set: ${fmtDay(d)}` });
    }
  };

  return (
    <>
      <PageHeader title="Holiday Calendar" subtitle={canEdit ? 'Click a Saturday to make it the month\'s Saturday off. Holidays and days off are excluded from attendance and leave.' : 'Company and public holidays, and this month\'s Saturday off.'}
        actions={canEdit && <Button icon={Plus} onClick={() => setEditing({ holidayDate: today, kind: 'Company', active: true, locations: [], departmentIds: [] })}>Add holiday</Button>} />
      <Card className="mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <Button size="sm" variant="secondary" icon={ChevronLeft} onClick={() => shift(-1)} aria-label="Previous month" />
          <div className="text-center">
            <div className="font-display text-lg font-semibold text-heading">{MONTHS_SHORT[Number(month.slice(5)) - 1]} {year}</div>
            <div className="text-xs text-ink-soft">{satOff ? `Saturday off: ${fmtDay(satOff.workDate)}` : 'No Saturday off chosen for this month'}</div>
          </div>
          <Button size="sm" variant="secondary" icon={ChevronRight} onClick={() => shift(1)} aria-label="Next month" />
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
          {DAY_NAMES.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
          {days.map((d) => {
            const h = hol(d);
            const c = cal(d);
            const dow = isoDow(d);
            const off = dow === 7 || c?.kind === 'saturday_off' || c?.kind === 'day_off' || h.length > 0;
            const sat = dow === 6;
            return (
              <button
                key={d}
                type="button"
                disabled={!canEdit || !sat}
                onClick={() => toggleSaturday(d)}
                title={sat && canEdit ? (c?.kind === 'saturday_off' ? 'Make this Saturday a working day' : 'Make this the Saturday off') : undefined}
                className={cn('min-h-[72px] rounded-xl border p-1.5 text-left text-xs transition sm:p-2',
                  d === today ? 'border-rust' : 'border-line',
                  off ? 'bg-canvas' : 'bg-surface',
                  sat && canEdit && 'hover:border-brand-300',
                  !canEdit || !sat ? 'cursor-default' : '')}
              >
                <div className={cn('font-semibold', off ? 'text-ink-mute' : 'text-heading')}>{Number(d.slice(8))}</div>
                {h.map((x) => <div key={x.id} className="mt-0.5 truncate rounded bg-brand-50 px-1 text-[10px] font-medium text-rust dark:bg-brand-500/10">{x.name}</div>)}
                {c?.kind === 'saturday_off' && <div className="mt-0.5 truncate rounded bg-navy-50 px-1 text-[10px] font-medium text-navy dark:bg-white/10 dark:text-white">Saturday off</div>}
                {c?.kind === 'working_day' && <div className="mt-0.5 truncate text-[10px] text-emerald-600">Working day</div>}
              </button>
            );
          })}
        </div>
      </Card>
      <Card>
        <CardHeader title={`Holidays ${year}`} subtitle={`${yearList.filter((h) => h.active).length} active`} />
        {yearList.length === 0 ? <EmptyState icon={CalendarOff} title="No holidays added for this year" /> : (
          <Table className="hr-table" head={['Date', 'Holiday', 'Type', 'Applies to', 'Status', ...(canEdit ? [''] : [])]}>
            {yearList.map((h) => (
              <tr key={h.id} className={cn(!h.active && 'opacity-60')}>
                <td className="whitespace-nowrap">{fmtDay(h.holidayDate)}</td>
                <td className="font-medium text-heading">{h.name}</td>
                <td><Badge tone={h.kind === 'Public' ? 'blue' : 'orange'}>{h.kind}</Badge></td>
                <td className="text-ink-soft">{[...h.departmentIds.map((d) => lk.department.get(d)?.name ?? d), ...h.locations].join(', ') || 'Everyone'}</td>
                <td>{h.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</td>
                {canEdit && (
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(h)}>Edit</Button>{' '}
                    <Button size="sm" variant="secondary" icon={Trash2} aria-label="Delete holiday" onClick={async () => {
                      if (await confirm({ title: `Delete ${h.name}?`, message: 'It will no longer be excluded from attendance and leave. You can deactivate it instead to keep the record.', confirmLabel: 'Delete', danger: true })) {
                        await write('holidays', 'delete', {}, { id: h.id }, { refresh: ['holidays'], success: 'Holiday deleted' });
                      }
                    }} />
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {canEdit && <HolidayModal value={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HolidayModal({ value, onClose }: { value: Partial<Holiday> | null; onClose: () => void }) {
  const { data, write } = useHR();
  const [h, setH] = useState<Partial<Holiday>>({});
  const [key, setKey] = useState<string | undefined>();
  if (value && (value.id ?? 'new') !== key) {
    setKey(value.id ?? 'new');
    setH({ ...value, locations: value.locations ?? [], departmentIds: value.departmentIds ?? [] });
  }
  if (!value && key) setKey(undefined);
  const save = async () => {
    const row = { holiday_date: h.holidayDate, name: h.name?.trim(), kind: h.kind, active: h.active !== false, department_ids: h.departmentIds ?? [], locations: (h.locations ?? []).filter(Boolean) };
    const ok = h.id ? await write('holidays', 'update', row, { id: h.id }, { refresh: ['holidays'], success: 'Holiday saved' })
      : await write('holidays', 'insert', row, undefined, { refresh: ['holidays'], success: 'Holiday added' });
    if (ok) onClose();
  };
  return (
    <Modal open={!!value} onClose={onClose} title={h.id ? 'Edit holiday' : 'Add holiday'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={CalendarCheck2} disabled={!h.holidayDate || (h.name?.trim().length ?? 0) < 2} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" required><Input type="date" value={h.holidayDate ?? ''} onChange={(e) => setH({ ...h, holidayDate: e.target.value })} /></Field>
        <Field label="Type"><Segmented options={[{ value: 'Company', label: 'Company' }, { value: 'Public', label: 'Public' }]} value={h.kind ?? 'Company'} onChange={(v) => setH({ ...h, kind: v as Holiday['kind'] })} /></Field>
        <Field label="Name" required className="sm:col-span-2"><Input value={h.name ?? ''} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="e.g. Onam" /></Field>
        <Field label="Departments" hint="None selected = every department" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {data.departments.map((d) => {
              const on = (h.departmentIds ?? []).includes(d.id);
              return <button key={d.id} type="button" onClick={() => setH({ ...h, departmentIds: on ? (h.departmentIds ?? []).filter((x) => x !== d.id) : [...(h.departmentIds ?? []), d.id] })}
                className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold', on ? 'border-rust bg-brand-50 text-rust dark:bg-brand-500/10' : 'border-line text-ink-soft')}>{d.name}</button>;
            })}
          </div>
        </Field>
        <Field label="Locations" hint="Comma-separated work locations; empty = every location" className="sm:col-span-2">
          <Input value={(h.locations ?? []).join(', ')} onChange={(e) => setH({ ...h, locations: e.target.value.split(',').map((x) => x.trim()) })} />
        </Field>
        <div className="sm:col-span-2"><Switch checked={h.active !== false} onCheckedChange={(v) => setH({ ...h, active: v })} label="Active" /></div>
      </div>
    </Modal>
  );
}
