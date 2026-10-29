import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Circle, ListTodo, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Tabs, TimePicker } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { priorityTone } from '../../components/UpdateCard';
import { useStore } from '../../store/store';
import type { Priority, Task } from '../../data/types';
import { cn, daysUntil, formatDateTime, fromDateInput, toDateInput } from '../../lib/utils';

type View = 'open' | 'today' | 'upcoming' | 'done';

export default function Tasks() {
  const { db, actions } = useStore();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('open');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const filtered = (v: View) =>
    db.tasks.filter((t) => {
      const d = daysUntil(t.due);
      if (v === 'done') return t.done;
      if (t.done) return false;
      if (v === 'today') return d <= 0;
      if (v === 'upcoming') return d > 0;
      return true;
    });
  const rows = filtered(view).sort((a, b) => a.due.localeCompare(b.due));

  const toggle = (t: Task) => {
    actions.toggleTask(t.id);
    toast.success(t.done ? 'Task reopened' : 'Task completed', t.title);
  };

  return (
    <>
      <PageHeader title="Tasks & Reminders" subtitle="Keep admissions, finance and partner success on track." actions={<Button icon={Plus} onClick={() => setOpen(true)}>Add Reminder</Button>} />
      <Tabs
        className="mb-5"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'open', label: 'All open', count: filtered('open').length },
          { value: 'today', label: 'Due today', count: filtered('today').length },
          { value: 'upcoming', label: 'Upcoming', count: filtered('upcoming').length },
          { value: 'done', label: 'Completed', count: filtered('done').length },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={ListTodo} title="Nothing here" description="You’re all caught up." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => {
              const d = daysUntil(t.due);
              return (
                <li key={t.id} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-canvas/60">
                  <button type="button" onClick={() => toggle(t)} aria-label={t.done ? 'Mark as open' : 'Mark as done'} className="shrink-0">
                    {t.done ? <CheckCircle2 className="h-6 w-6 text-emerald-500" /> : <Circle className="h-6 w-6 text-ink-mute transition hover:text-rust" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cn('font-semibold text-heading', t.done && 'text-ink-mute line-through')}>{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
                      <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatDateTime(t.due)}</span>
                      <span>{t.assignee}</span>
                      {t.related && <span>· {t.related}</span>}
                    </div>
                  </div>
                  <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
                  {!t.done && <Badge tone={d < 0 ? 'red' : d === 0 ? 'orange' : 'slate'}>{d < 0 ? 'Overdue' : d === 0 ? 'Today' : `${d}d`}</Badge>}
                  <button type="button" aria-label="Delete task" onClick={() => { actions.removeTask(t.id); toast.info('Task removed'); }} className="rounded-lg p-1.5 text-ink-mute opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <TaskForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function TaskForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions, db, session } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [due, setDue] = useState(toDateInput(new Date(Date.now() + 86400000).toISOString()));
  const [time, setTime] = useState('17:00');
  const [errors, setErrors] = useState<{ title?: string; due?: string }>({});
  const [priority, setPriority] = useState<Priority>('Medium');
  const [assignee, setAssignee] = useState('Admissions Team');
  const save = () => {
    const e: { title?: string; due?: string } = {};
    if (title.trim().length < 3) e.title = 'Enter a task of at least 3 characters.';
    if (!due) e.due = 'Choose a due date.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const at = fromDateInput(due, 0);
    const [hh, mm] = (time || '17:00').split(':').map(Number);
    const when = new Date(at);
    when.setHours(hh, mm, 0, 0);
    const person = db.staff.find((m) => m.id === assignedTo);
    actions.addTask({ title: title.trim(), due: when.toISOString(), priority, assignee: person?.fullName ?? assignee, assignedTo: person ? person.id : null });
    toast.success('Reminder added', title);
    setTitle('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add reminder" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Add reminder</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Task" required error={errors.title} className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!errors.title} placeholder="e.g. Follow up CAS for Monash" autoFocus /></Field>
        <Field label="Due date" required error={errors.due}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} invalid={!!errors.due} /></Field>
        <Field label="Due time" hint="Defaults to 5:00 PM"><TimePicker value={time} onChange={setTime} aria-label="Due time" /></Field>
        <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{['High', 'Medium', 'Normal'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Assign to employee" hint="They are notified instantly" className="sm:col-span-2">
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} aria-label="Assign to employee">
            <option value="">Unassigned team task</option>
            {db.staff.map((m) => <option key={m.id} value={m.id}>{m.fullName}{m.id === session?.userId ? ' (me)' : ''}{m.department ? ` · ${m.department}` : ''}</option>)}
          </Select>
        </Field>
        {!assignedTo && (
          <Field label="Team" className="sm:col-span-2"><Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>{['Admissions Team', 'Visa Desk', 'Finance', 'Partner Success', 'Documents Desk'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        )}
      </div>
    </Modal>
  );
}
