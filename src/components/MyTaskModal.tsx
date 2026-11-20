// Add / view / edit one of the employee's own tasks (0058). Used by the Daily Work Report (Add Pending
// Work, Add Task to Tomorrow's Plan) and My Assigned Tasks. Every task is a row of the shared task system
// (tasks, kind = 'assignment', assigned to and by the employee); the server checks ownership, dates and
// the next working day, and keeps the history. Nothing here counts as completed work until the task is
// marked completed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge, Button, DatePicker, Field, Input, Modal, Select, Textarea } from './ui';
import { useHR } from '../store/hr';
import { useStore } from '../store/store';
import { companyDate, fmtDay, type Assignment } from '../data/hr';
import { fullName } from '../lib/utils';

export type TaskOrigin = 'pending_work' | 'tomorrows_plan';
type Priority = 'High' | 'Medium' | 'Normal';
const istDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

interface Form { title: string; description: string; priority: Priority; due: string; planned: string; related: string; notes: string }

export function MyTaskModal({ open, onClose, origin, nextDay, taskId }: {
  open: boolean; onClose: () => void; origin: TaskOrigin;
  /** The employee's next working day (from the server), the default planned date for Tomorrow's Plan. */
  nextDay?: string | null;
  /** An existing task to view / edit; omitted = add a new one. */
  taskId?: string | null;
}) {
  const { data, call, now } = useHR();
  const { db, session } = useStore();
  const today = companyDate(now());
  const task: Assignment | undefined = taskId ? data.assignments.find((a) => a.id === taskId) : undefined;
  const own = !task || (task.assignedBy === session?.userId && task.assignedTo === session?.userId);
  const closed = !!task && (task.status === 'Completed' || task.status === 'Cancelled');
  const editable = own && !closed;
  const kind: TaskOrigin = task?.origin ?? origin;
  const blank = (): Form => ({ title: '', description: '', priority: 'Normal', due: kind === 'tomorrows_plan' ? nextDay ?? '' : today, planned: kind === 'tomorrows_plan' ? nextDay ?? '' : '', related: '', notes: '' });
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState<'save' | 'done' | 'cancel' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    requestId.current = crypto.randomUUID();
    setCancelling(false);
    setReason('');
    setF(task ? {
      title: task.title, description: task.description ?? '', priority: task.priority, due: istDate(task.due), planned: task.startDate ?? '',
      related: task.related ?? '', notes: task.notes ?? '',
    } : blank());
  }, [open, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Related agency or student: suggestions from the records this employee can already see.
  const suggestions = useMemo(() => [...new Set([
    ...db.partners.filter((p) => !p.archivedAt).map((p) => p.name),
    ...db.students.map((s) => fullName(s)),
  ])].slice(0, 400), [db.partners, db.students]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const titleOk = f.title.trim().length >= 3;
  const plannedNeeded = kind === 'tomorrows_plan';
  const datesOk = (!plannedNeeded || !!f.planned) && (!f.planned || !f.due || f.due >= f.planned);

  const save = async () => {
    if (!titleOk || !datesOk || busy) return;
    setBusy('save');
    const r = await call<string>('save_my_task', {
      p_id: task?.id ?? null, p_title: f.title.trim(), p_description: f.description.trim() || null, p_priority: f.priority,
      p_due: f.due || null, p_planned: f.planned || null, p_related: f.related.trim() || null, p_notes: f.notes.trim() || null,
      p_origin: kind, p_request: task ? null : requestId.current,
    }, { refresh: ['assignments'], success: task ? 'Task updated' : kind === 'tomorrows_plan' ? "Added to Tomorrow's Plan" : 'Added to Pending Work',
      successDetail: task ? undefined : kind === 'tomorrows_plan' && f.planned ? `It appears in My Assigned Tasks on ${fmtDay(f.planned)}.` : 'It stays pending until you complete or cancel it.' });
    setBusy(null);
    if (r.ok) onClose();
  };
  const complete = async () => {
    if (!task || busy) return;
    setBusy('done');
    const r = await call('update_assignment_progress', { p_id: task.id, p_status: 'Completed', p_progress: 100, p_note: f.notes.trim() && f.notes.trim() !== (task.notes ?? '') ? f.notes.trim() : null },
      { refresh: ['assignments'], success: 'Task completed' });
    setBusy(null);
    if (r.ok) onClose();
  };
  const cancelTask = async () => {
    if (!task || busy || reason.trim().length < 3) return;
    setBusy('cancel');
    const r = await call('cancel_my_task', { p_id: task.id, p_reason: reason.trim() }, { refresh: ['assignments'], success: 'Task cancelled' });
    setBusy(null);
    if (r.ok) onClose();
  };

  const title = task ? (editable ? 'Edit task' : 'Task') : kind === 'tomorrows_plan' ? "Add task to Tomorrow's Plan" : 'Add pending work';
  const subtitle = task
    ? `${task.status}${task.assignedBy && task.assignedBy !== session?.userId ? ' · assigned to you' : ' · added by you'} · created ${fmtDay(istDate(task.createdAt))}`
    : kind === 'tomorrows_plan' ? 'Planned for a working day; it becomes actionable in My Assigned Tasks on that day.' : 'Outstanding work that is not already recorded elsewhere in the CRM.';

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} dirty={!task && !!f.title.trim()}
      footer={<>
        {task && editable && !cancelling && <Button variant="ghost" icon={XCircle} className="mr-auto text-red-600" onClick={() => setCancelling(true)}>Cancel task</Button>}
        {task && editable && cancelling && <Button variant="ghost" className="mr-auto" onClick={() => setCancelling(false)}>Keep task</Button>}
        <Button variant="secondary" onClick={onClose} className="hidden sm:inline-flex">Close</Button>
        {cancelling ? (
          <Button variant="danger" disabled={reason.trim().length < 3 || !!busy} loading={busy === 'cancel'} onClick={() => void cancelTask()}>Confirm cancel</Button>
        ) : <>
          {task && !closed && (own || task.assignedTo === session?.userId) && <Button variant="secondary" icon={CheckCircle2} disabled={!!busy} loading={busy === 'done'} onClick={() => void complete()}>Mark completed</Button>}
          {editable && <Button disabled={!titleOk || !datesOk || !!busy} loading={busy === 'save'} onClick={() => void save()}>{task ? 'Save changes' : 'Save task'}</Button>}
        </>}
      </>}>
      {task && closed && <div className="mb-4"><Badge tone={task.status === 'Completed' ? 'green' : 'red'}>{task.status}</Badge>{task.lastNote && <span className="ml-2 text-sm text-ink-soft">“{task.lastNote}”</span>}</div>}
      {cancelling ? (
        <Field label="Why is this task cancelled?" required hint="Cancelled tasks are kept and shown as cancelled — they are not counted as completed.">
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Task title" required className="sm:col-span-2" error={f.title && !titleOk ? 'At least 3 characters' : undefined}>
            <Input value={f.title} maxLength={300} disabled={!editable} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Contact Sterling Education about pending documents" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={3} maxLength={4000} value={f.description} disabled={!editable} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Related agency or student" hint="Optional">
            <Input value={f.related} maxLength={300} disabled={!editable} list="my-task-related" onChange={(e) => set('related', e.target.value)} placeholder="Search or type a name" />
            <datalist id="my-task-related">{suggestions.map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} disabled={!editable} onChange={(e) => set('priority', e.target.value as Priority)} aria-label="Priority">
              <option value="Normal">Normal</option><option value="Medium">Medium</option><option value="High">High</option>
            </Select>
          </Field>
          {plannedNeeded && (
            <Field label="Planned date" required hint={nextDay && f.planned === nextDay ? 'Your next working day' : 'The day it becomes actionable'}>
              <DatePicker value={f.planned} min={task ? undefined : today} disabled={!editable} clearable={false} onChange={(v) => setF((x) => ({ ...x, planned: v, due: !x.due || x.due < v ? v : x.due }))} />
            </Field>
          )}
          <Field label="Due date" hint={datesOk ? undefined : 'Not before the planned date'}>
            <DatePicker value={f.due} min={f.planned || (task ? undefined : today)} disabled={!editable} clearable={false} invalid={!datesOk} onChange={(v) => set('due', v)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2" hint="Optional">
            <Textarea rows={2} maxLength={2000} value={f.notes} disabled={!editable && closed} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
