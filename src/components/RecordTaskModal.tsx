// Assign Task / Escalate from one Student or Application (0059) — one component for both places.
// The task is a row of the existing task system: it reaches the recipient's My Assigned Tasks, follows
// the existing progress / completion flow and never changes the record itself (status, Assigned staff,
// officers). Who can be chosen comes from the server (reporting hierarchy, Application Team delegation,
// escalation chain) and is checked again when saving.
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ClipboardList, Send, UserPlus } from 'lucide-react';
import { Alert, Badge, Button, DatePicker, Field, Input, Modal, Select, SelectMenu, Textarea, type SelectOption } from './ui';
import { useToast } from './feedback';
import { supabase } from '../auth/auth';
import { companyDate, fmtDay } from '../data/hr';
import { cn } from '../lib/utils';

type Mode = 'task' | 'escalation';
type Priority = 'High' | 'Medium' | 'Normal';
interface Person { id: string; full_name: string; designation: string | null; role: string; kind: 'assign' | 'escalate'; level: number | null; open_tasks: number }
interface Form { title: string; description: string; to: string; due: string; priority: Priority; notes: string; reason: string }

const today = () => companyDate(new Date());
const blank = (): Form => ({ title: '', description: '', to: '', due: today(), priority: 'Normal', notes: '', reason: '' });

export function RecordTaskModal({ open, onClose, studentId, applicationId, recordLabel, onSaved }: {
  open: boolean; onClose: () => void;
  /** The record the action was started from (an application implies its student). */
  studentId?: string | null; applicationId?: string | null;
  /** Shown read-only in the form, e.g. "SSI-24106 · Student A — University B". */
  recordLabel: string;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('task');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setMode('task'); setF(blank()); setError(''); requestId.current = crypto.randomUUID();
    if (!supabase) { setPeople([]); return; }
    let alive = true;
    setPeople(null);
    void supabase.rpc('record_task_people', { p_student: applicationId ? null : studentId ?? null, p_app: applicationId ?? null }).then(({ data, error: e }) => {
      if (alive) setPeople(e ? [] : ((data ?? []) as Person[]));
    });
    return () => { alive = false; };
  }, [open, studentId, applicationId]);

  const assignable = (people ?? []).filter((p) => p.kind === 'assign');
  const chain = (people ?? []).filter((p) => p.kind === 'escalate');
  const list = mode === 'task' ? assignable : chain;
  // Escalation: preselect the nearest manager.
  useEffect(() => { if (mode === 'escalation' && chain.length && !chain.some((p) => p.id === f.to)) setF((x) => ({ ...x, to: chain[0].id })); },
    [mode, people]); // eslint-disable-line react-hooks/exhaustive-deps

  const options: SelectOption[] = list.map((p) => ({
    value: p.id,
    label: `${p.full_name} · ${p.designation ?? p.role}${mode === 'escalation' ? (p.level === 1 ? ' · your reporting manager' : p.level === 99 ? ' · higher authority' : ' · senior manager') : ` · ${p.open_tasks} open task${p.open_tasks === 1 ? '' : 's'}`}`,
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setError(''); };
  const switchMode = (m: Mode) => { setMode(m); setF((x) => ({ ...x, to: '' })); setError(''); requestId.current = crypto.randomUUID(); };
  const valid = f.title.trim().length >= 3 && !!f.to && !!f.due && (mode === 'task' || f.reason.trim().length >= 10);

  const submit = async () => {
    if (!valid || busy || !supabase) return;
    setBusy(true);
    const { error: e } = await supabase.rpc('create_record_task', {
      p_category: mode, p_student: applicationId ? null : studentId ?? null, p_app: applicationId ?? null,
      p_title: f.title.trim(), p_description: f.description.trim() || null, p_assignee: f.to, p_priority: f.priority, p_due: f.due,
      p_notes: f.notes.trim() || null, p_reason: mode === 'escalation' ? f.reason.trim() : null, p_request: requestId.current,
    });
    setBusy(false);
    if (e) { setError(e.message || 'Not saved'); return; } // keep everything typed
    const who = list.find((p) => p.id === f.to)?.full_name ?? 'the employee';
    toast.success(mode === 'task' ? 'Task assigned' : 'Escalated', `${who} sees it in My Assigned Tasks · due ${fmtDay(f.due)}.`);
    onSaved?.();
    onClose();
  };

  const noOne = people !== null && list.length === 0;
  return (
    <Modal open={open} onClose={onClose} title="Assign task or escalate" subtitle={recordLabel}
      dirty={!!f.title.trim() || !!f.reason.trim()}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button icon={mode === 'task' ? Send : ArrowUpRight} disabled={!valid || busy || noOne} loading={busy} onClick={() => void submit()}>
          {mode === 'task' ? 'Assign task' : 'Escalate'}
        </Button>
      </>}>
      <div className="mb-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Action">
        {([['task', UserPlus, 'Assign task', 'Delegate a piece of work to your team or the Application Team'],
           ['escalation', ArrowUpRight, 'Escalate', 'Send an issue to your reporting manager or a higher authority']] as const).map(([m, Icon, label, hint]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => switchMode(m)}
            className={cn('rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
              mode === m ? 'border-rust bg-brand-50/60 ring-1 ring-rust dark:bg-brand-500/10' : 'border-line hover:border-brand-200')}>
            <span className="flex items-center gap-2 text-sm font-semibold text-heading"><Icon className="h-4 w-4 text-rust" />{label}</span>
            <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-ink-mute">The {applicationId ? 'application' : 'student'} itself does not change — its status, Assigned staff and officers stay as they are.</p>
      {noOne && (
        <Alert tone="info" className="mb-4">
          {mode === 'task' ? 'There is no one you can assign tasks to for this record. Use Escalate to send it to your manager.' : 'No escalation recipient is configured for you. Ask HR to set your reporting manager.'}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={applicationId ? 'Related application' : 'Related student'} className="sm:col-span-2">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm text-heading"><ClipboardList className="h-4 w-4 text-ink-mute" />{recordLabel}</div>
        </Field>
        <Field label={mode === 'task' ? 'Task title' : 'Escalation subject'} required className="sm:col-span-2">
          <Input value={f.title} maxLength={300} onChange={(e) => set('title', e.target.value)}
            placeholder={mode === 'task' ? 'e.g. Follow up on pending documents' : 'e.g. University not responding to the offer request'} />
        </Field>
        {mode === 'escalation' && (
          <Field label="Reason for escalation" required className="sm:col-span-2" hint={f.reason && f.reason.trim().length < 10 ? 'At least 10 characters' : 'Why this needs a manager'}>
            <Textarea rows={2} maxLength={2000} value={f.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
        <Field label={mode === 'task' ? 'Task description' : 'Issue description'} className="sm:col-span-2">
          <Textarea rows={3} maxLength={4000} value={f.description} onChange={(e) => set('description', e.target.value)}
            placeholder={mode === 'task' ? 'Instructions for the employee' : 'What happened so far'} />
        </Field>
        <Field label={mode === 'task' ? 'Assign to' : 'Escalate to'} required className="sm:col-span-2">
          <SelectMenu value={f.to} onChange={(v) => set('to', v)} options={options} searchable disabled={people === null || noOne}
            placeholder={people === null ? 'Loading…' : mode === 'task' ? 'Choose an employee' : 'Choose a manager'} aria-label={mode === 'task' ? 'Assign to' : 'Escalate to'} />
        </Field>
        <Field label={mode === 'task' ? 'Due date' : 'Required response date'} required hint={f.due ? fmtDay(f.due) : undefined}>
          <DatePicker value={f.due} min={today()} clearable={false} onChange={(v) => set('due', v)} />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)} aria-label="Priority">
            <option value="Normal">Normal</option><option value="Medium">Medium</option><option value="High">High</option>
          </Select>
        </Field>
        <Field label="Notes" hint="Optional" className="sm:col-span-2">
          <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      {error && <p role="alert" className="mt-4 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ task history of a record

interface RecordTaskRow { id: string; title: string; category: Mode; assignee: string | null; status: string; priority: Priority; due: string; created_at: string; last_note: string | null; application_id: string | null }
const statusTone: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = { 'Not Started': 'slate', 'In Progress': 'blue', 'On Hold': 'amber', Completed: 'green', Cancelled: 'red' };
const istDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Tasks and escalations raised from this student (incl. its applications) or application that the user may see. */
export function RecordTaskHistory({ studentId, applicationId, rev, className }: { studentId?: string | null; applicationId?: string | null; rev?: unknown; className?: string }) {
  const [rows, setRows] = useState<RecordTaskRow[] | null>(null);
  useEffect(() => {
    if (!supabase || (!studentId && !applicationId)) { setRows([]); return; }
    let alive = true;
    let q = supabase.from('tasks').select('id,title,category,assignee,status,priority,due,created_at,last_note,application_id').eq('kind', 'assignment').not('category', 'is', null);
    q = applicationId ? q.eq('application_id', applicationId) : q.eq('student_id', studentId!);
    void q.order('created_at', { ascending: false }).limit(50).then(({ data }) => { if (alive) setRows((data ?? []) as RecordTaskRow[]); });
    return () => { alive = false; };
  }, [studentId, applicationId, rev]);
  if (!rows?.length) return null;
  const t = companyDate(new Date());
  return (
    <section className={cn('rounded-2xl border border-line p-5', className)}>
      <h4 className="mb-3 font-display text-sm font-semibold text-heading">Tasks &amp; escalations</h4>
      <ul className="space-y-2">
        {rows.map((r) => {
          const open = r.status !== 'Completed' && r.status !== 'Cancelled';
          const d = istDate(r.due);
          return (
            <li key={r.id} className="rounded-lg border border-line px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words font-medium text-heading">{r.title}</span>
                {r.category === 'escalation' && <Badge tone="amber">Escalation</Badge>}
                <Badge tone={statusTone[r.status] ?? 'slate'}>{r.category === 'escalation' && r.status === 'Not Started' ? 'Awaiting response' : r.status}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-ink-soft">
                {r.assignee ?? 'Employee'} · {open && d < t ? <span className="font-semibold text-red-600">Overdue · {fmtDay(d)}</span> : `Due ${fmtDay(d)}`}{r.priority === 'High' ? ' · High priority' : ''}
                {r.last_note && !open ? ` · “${r.last_note}”` : ''}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** SSI GLOBAL employees (not partner logins, not while previewing another account). Who they may pick is decided by the server. */
export const canRaiseRecordTasks = (s: { role: string; previewOf?: unknown } | null | undefined) => !!s && (s.role === 'admin' || s.role === 'staff') && !s.previewOf;
