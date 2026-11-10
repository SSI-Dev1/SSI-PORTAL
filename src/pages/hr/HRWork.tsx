// Stage 4 HR screens: Work Assignment (HR and managers), My Assigned Tasks (every employee),
// Company Assets and Employee Documents. Assignments are rows of the existing "tasks" table
// (kind = 'assignment'); every change goes through a database function that re-checks who may
// make it (0027_hr_work_assets_documents.sql). HR documents live in a private bucket and are
// opened only through 60-second signed links after the server records the download.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Briefcase, Download, Eye, EyeOff, FileText, History, Laptop, PackageCheck, PackagePlus, Pencil, Plus, Undo2, Upload, Users, XCircle } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, CardHeader, Checkbox, DatePicker, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Progress, SearchInput, Select, Table, Tabs, Textarea, usePaged, Pagination } from '../../components/ui';
import { ExportButtons, KPI } from '../../components/hr';
import { EmployeeProfileModal } from '../../components/hrProfile';
import { useConfirm, useToast } from '../../components/feedback';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { prepareUpload, UploadError } from '../../lib/files';
import {
  ASSET_CATEGORIES, ASSIGNMENT_STATUSES, HR_DOCUMENT_CATEGORIES, companyDate, fmtDay, serverMessage,
  type Assignment, type AssignmentStatus, type CompanyAsset, type EmployeeDocument, type TaskEvent,
} from '../../data/hr';
import { cn, matches } from '../../lib/utils';

const HR_BUCKET = 'hr-documents';
const statusTone: Record<AssignmentStatus, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  'Not Started': 'slate', 'In Progress': 'blue', 'On Hold': 'amber', Completed: 'green', Cancelled: 'red',
};
const priorityTone = { High: 'red', Medium: 'amber', Normal: 'slate' } as const;
const istDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const isOpen = (a: Assignment) => a.status !== 'Completed' && a.status !== 'Cancelled';

function useWho() {
  const { session } = useStore();
  const hr = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('hr');
  return { me: session?.userId ?? '', hr };
}

/** Employees the signed-in user may assign work to (HR: everyone current; managers: their team). */
function useAssignable() {
  const { data } = useHR();
  const { me, hr } = useWho();
  return useMemo(() => {
    const team = new Set<string>();
    const walk = (m: string) => data.employees.filter((e) => e.reportingManagerId === m && !team.has(e.id)).forEach((e) => { team.add(e.id); walk(e.id); });
    walk(me);
    return data.directory.filter((e) => e.employmentStatus !== 'Resigned' && e.accountStatus === 'active' && (hr || team.has(e.id)));
  }, [data.employees, data.directory, me, hr]);
}

// ------------------------------------------------------------------ work assignment

export function WorkAssignments() {
  const { data, call, now } = useHR();
  const lk = useHRLookup();
  const { me } = useWho();
  const assignable = useAssignable();
  const today = companyDate(now());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [emp, setEmp] = useState('');
  const [dept, setDept] = useState('');
  const [editing, setEditing] = useState<Partial<Assignment> | null>(null);
  const [historyOf, setHistoryOf] = useState<Assignment | null>(null);
  const [progressOf, setProgressOf] = useState<Assignment | null>(null);
  const [cancelOf, setCancelOf] = useState<{ a: Assignment; reason: string } | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  const all = data.assignments.filter((a) => a.assignedTo !== me || a.assignedBy === me);
  const rows = all.filter((a) => matches(q, a.title, lk.name(a.assignedTo))
    && (status === 'open' ? isOpen(a) : status === 'overdue' ? isOpen(a) && istDate(a.due) < today : !status || a.status === status)
    && (!emp || a.assignedTo === emp) && (!dept || lk.employee.get(a.assignedTo)?.departmentId === dept))
    .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || a.due.localeCompare(b.due));
  const paged = usePaged(rows, 20, `${q}${status}${emp}${dept}`);
  const open = all.filter(isOpen);
  const overdue = open.filter((a) => istDate(a.due) < today);
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const workload = useMemo(() => {
    const m = new Map<string, { open: number; overdue: number; high: number; done: number }>();
    for (const a of all) {
      const w = m.get(a.assignedTo) ?? { open: 0, overdue: 0, high: 0, done: 0 };
      if (isOpen(a)) { w.open++; if (istDate(a.due) < today) w.overdue++; if (a.priority === 'High') w.high++; }
      else if (a.status === 'Completed' && (a.completedAt ?? '').slice(0, 7) === today.slice(0, 7)) w.done++;
      m.set(a.assignedTo, w);
    }
    return [...m.entries()].sort((x, y) => y[1].open - x[1].open);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assignments, today]);

  return (
    <>
      <PageHeader title="Work Assignment" subtitle="Assign work to your team, set priorities and deadlines, and follow progress. Employees update their own status from My Assigned Tasks."
        actions={<>
          <ExportButtons filename="ssi-work-assignments" rows={() => rows.map((a) => ({
            Title: a.title, Employee: lk.name(a.assignedTo), Department: lk.department.get(lk.employee.get(a.assignedTo)?.departmentId ?? '')?.name ?? '',
            Priority: a.priority, Start: a.startDate ?? '', Deadline: istDate(a.due), Status: a.status, 'Progress %': a.progress, 'Assigned by': a.assignedBy ? lk.name(a.assignedBy) : '',
            Completed: a.completedAt ? istDate(a.completedAt) : '', 'Latest note': a.lastNote ?? '',
          }))} />
          <Button icon={Plus} disabled={assignable.length === 0} onClick={() => setEditing({ priority: 'Normal', due: `${weekEnd}T12:30:00.000Z` })}>Create assignment</Button>
        </>} />
      {assignable.length === 0 && <Alert tone="info" className="mb-4">You can assign work to employees who report to you. Nobody reports to you yet.</Alert>}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Briefcase} label="Open assignments" value={open.length} onClick={() => setStatus('open')} />
        <KPI icon={XCircle} tone="red" label="Overdue" value={overdue.length} onClick={() => setStatus('overdue')} />
        <KPI icon={History} tone="amber" label="Due in the next 7 days" value={open.filter((a) => istDate(a.due) >= today && istDate(a.due) <= weekEnd).length} />
        <KPI icon={PackageCheck} tone="green" label="Completed this month" value={all.filter((a) => a.status === 'Completed' && (a.completedAt ?? '').slice(0, 7) === today.slice(0, 7)).length} onClick={() => setStatus('Completed')} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex flex-wrap gap-2 border-b border-line p-4">
            <SearchInput value={q} onChange={setQ} placeholder="Search title or employee…" className="w-full sm:w-64" />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: '', label: 'All' }, ...ASSIGNMENT_STATUSES]} />
            <FilterSelect label="Employee" value={emp} onChange={setEmp} options={[{ value: '', label: 'Everyone' }, ...[...new Set(all.map((a) => a.assignedTo))].map((id) => ({ value: id, label: lk.name(id) }))]} />
            <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
          {rows.length === 0 ? <EmptyState icon={Briefcase} title="No assignments" description="Create an assignment to give work to an employee." /> : (
            <>
              <Table className="hr-table" head={['Assignment', 'Employee', 'Deadline', 'Status', 'Progress', '']}>
                {paged.rows.map((a) => {
                  const late = isOpen(a) && istDate(a.due) < today;
                  return (
                    <tr key={a.id}>
                      <td className="min-w-[220px]">
                        <div className="font-medium text-heading">{a.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                          <Badge tone={priorityTone[a.priority]}>{a.priority}</Badge>
                          {a.assignedBy && <span>by {lk.name(a.assignedBy)}</span>}
                        </div>
                        {a.lastNote && <div className="mt-1 max-w-sm truncate text-xs text-ink-soft">“{a.lastNote}”</div>}
                      </td>
                      <td><button type="button" className="flex items-center gap-2 text-left hover:text-rust" onClick={() => setProfile(a.assignedTo)}><Avatar name={lk.name(a.assignedTo)} size={26} /><span className="font-medium text-heading">{lk.name(a.assignedTo)}</span></button></td>
                      <td className={cn('whitespace-nowrap', late && 'font-semibold text-red-600')}>{fmtDay(istDate(a.due))}{late && <div className="text-[11px]">Overdue</div>}</td>
                      <td><Badge tone={statusTone[a.status]}>{a.status}</Badge></td>
                      <td className="min-w-[110px]"><div className="flex items-center gap-2"><Progress value={a.progress} className="dark:bg-white/10" /><span className="w-9 text-right text-xs tabular-nums text-ink-soft">{a.progress}%</span></div></td>
                      <td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" icon={History} aria-label="History" onClick={() => setHistoryOf(a)} />
                        {isOpen(a) && <>
                          <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit or reassign" onClick={() => setEditing(a)} />
                          <Button size="sm" variant="secondary" onClick={() => setProgressOf(a)}>Update</Button>
                          <Button size="sm" variant="ghost" icon={XCircle} aria-label="Cancel assignment" onClick={() => setCancelOf({ a, reason: '' })} />
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="assignments" />
            </>
          )}
        </Card>
        <Card>
          <CardHeader title="Team workload" subtitle="Open work per employee" />
          {workload.length === 0 ? <EmptyState icon={Users} title="No assignments yet" /> : (
            <ul className="divide-y divide-line">
              {workload.map(([id, w]) => (
                <li key={id}>
                  <button type="button" onClick={() => { setEmp(id); setStatus('open'); }} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-canvas">
                    <Avatar name={lk.name(id)} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-heading">{lk.name(id)}</span>
                      <span className="block text-xs text-ink-soft">{w.open} open{w.high ? ` · ${w.high} high priority` : ''} · {w.done} done this month</span>
                    </span>
                    {w.overdue > 0 && <Badge tone="red">{w.overdue} overdue</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <AssignmentDialog value={editing} onClose={() => setEditing(null)} />
      <ProgressDialog value={progressOf} onClose={() => setProgressOf(null)} />
      <AssignmentHistory value={historyOf} onClose={() => setHistoryOf(null)} />
      <Modal open={!!cancelOf} onClose={() => setCancelOf(null)} size="sm" title="Cancel assignment" subtitle={cancelOf?.a.title}
        footer={<><Button variant="secondary" onClick={() => setCancelOf(null)}>Keep it</Button>
          <Button variant="danger" disabled={(cancelOf?.reason.trim().length ?? 0) < 3} onClick={async () => {
            if (!cancelOf) return;
            const r = await call('cancel_assignment', { p_id: cancelOf.a.id, p_reason: cancelOf.reason.trim() }, { refresh: ['assignments'], success: 'Assignment cancelled', successDetail: 'The employee was notified.' });
            if (r.ok) setCancelOf(null);
          }}>Cancel assignment</Button></>}>
        <Field label="Reason" required><Textarea rows={3} maxLength={300} value={cancelOf?.reason ?? ''} onChange={(e) => setCancelOf((x) => (x ? { ...x, reason: e.target.value } : x))} placeholder="e.g. No longer needed" /></Field>
        <p className="mt-2 text-xs text-ink-mute">The assignment and its history are kept.</p>
      </Modal>
      <EmployeeProfileModal employeeId={profile} onClose={() => setProfile(null)} />
    </>
  );
}

function AssignmentDialog({ value, onClose }: { value: Partial<Assignment> | null; onClose: () => void }) {
  const { call } = useHR();
  const assignable = useAssignable();
  const [f, setF] = useState({ title: '', description: '', assignee: '', priority: 'Normal', due: '', time: '18:00', start: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!value) return;
    setF({
      title: value.title ?? '', description: value.description ?? '', assignee: value.assignedTo ?? '', priority: value.priority ?? 'Normal',
      due: value.due ? istDate(value.due) : '', time: value.due ? new Date(new Date(value.due).getTime() + 5.5 * 3600_000).toISOString().slice(11, 16) : '18:00',
      start: value.startDate ?? '',
    });
  }, [value]);
  const isNew = !value?.id;
  const problems = [
    f.title.trim().length < 3 && 'Enter a title (3+ characters)',
    !f.assignee && 'Choose the employee',
    !f.due && 'Choose a deadline',
    f.start && f.due && f.start > f.due && 'The start date is after the deadline',
    f.description.length > 4000 && 'The description is too long',
  ].filter(Boolean) as string[];
  const save = async () => {
    if (problems.length) return;
    setBusy(true);
    const r = await call('save_assignment', {
      p_id: value?.id ?? null, p_title: f.title.trim(), p_description: f.description.trim() || null, p_assignee: f.assignee,
      p_priority: f.priority, p_due: `${f.due}T${f.time}:00+05:30`, p_start: f.start || null,
    }, { refresh: ['assignments'], success: isNew ? 'Assignment created' : 'Assignment saved', successDetail: 'The employee was notified.' });
    setBusy(false);
    if (r.ok) onClose();
  };
  const currentMissing = value?.assignedTo && !assignable.some((p) => p.id === value.assignedTo);
  return (
    <Modal open={!!value} onClose={onClose} title={isNew ? 'Create assignment' : 'Edit assignment'} subtitle={isNew ? 'The employee is notified and sees it in My Assigned Tasks.' : 'Changing the employee reassigns the work; the history is kept.'} dirty={!!f.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : isNew ? 'Assign work' : 'Save changes'}</Button></>}>
      <div className="space-y-4">
        <Field label="Title" required><Input value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Prepare partner pitch deck" /></Field>
        <Field label="Description" hint={`${f.description.length}/4000`}><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What needs to be done, links, expected output" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assign to" required>
            <Select value={f.assignee} searchable onChange={(e) => setF({ ...f, assignee: e.target.value })}>
              <option value="">Choose employee</option>
              {currentMissing && <option value={value!.assignedTo!}>Current assignee</option>}
              {assignable.map((p) => <option key={p.id} value={p.id}>{p.fullName} · {p.employeeCode}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="High">High</option><option value="Medium">Medium</option><option value="Normal">Normal</option>
            </Select>
          </Field>
          <Field label="Start date"><DatePicker value={f.start} onChange={(v) => setF({ ...f, start: v ?? '' })} /></Field>
          <Field label="Deadline" required><DatePicker value={f.due} clearable={false} onChange={(v) => v && setF({ ...f, due: v })} /></Field>
        </div>
        {problems.length > 0 && f.title && <p className="text-xs text-ink-mute">{problems[0]}</p>}
      </div>
    </Modal>
  );
}

function ProgressDialog({ value, onClose }: { value: Assignment | null; onClose: () => void }) {
  const { call } = useHR();
  const [s, setS] = useState<{ status: AssignmentStatus; progress: number; note: string }>({ status: 'In Progress', progress: 0, note: '' });
  useEffect(() => { if (value) setS({ status: value.status === 'Not Started' ? 'In Progress' : value.status, progress: value.progress, note: '' }); }, [value]);
  const needsNote = s.status === 'On Hold' && s.note.trim().length < 3;
  const save = async () => {
    if (!value || needsNote) return;
    const r = await call('update_assignment_progress', { p_id: value.id, p_status: s.status, p_progress: s.progress, p_note: s.note.trim() || null },
      { refresh: ['assignments'], success: s.status === 'Completed' ? 'Marked complete' : 'Progress updated' });
    if (r.ok) onClose();
  };
  const fixed = s.status === 'Completed' ? 100 : s.status === 'Not Started' ? 0 : null;
  return (
    <Modal open={!!value} onClose={onClose} size="sm" title="Update progress" subtitle={value?.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={needsNote} onClick={save}>Save update</Button></>}>
      <div className="space-y-4">
        <Field label="Status">
          <Select value={s.status} onChange={(e) => setS({ ...s, status: e.target.value as AssignmentStatus })}>
            {ASSIGNMENT_STATUSES.filter((x) => x !== 'Cancelled').map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label={`Progress · ${fixed ?? s.progress}%`} hint={fixed !== null ? `Set to ${fixed}% for “${s.status}”.` : 'Up to 99% until it is marked Completed.'}>
          <input type="range" min={0} max={99} step={5} value={fixed ?? Math.min(s.progress, 99)} disabled={fixed !== null}
            onChange={(e) => setS({ ...s, progress: Number(e.target.value) })} className="w-full accent-[#B94A12]" aria-label="Progress percent" />
        </Field>
        <Field label="Note" required={s.status === 'On Hold'} hint={s.status === 'On Hold' ? 'Say what is blocking the work.' : 'Optional — what changed.'}>
          <Textarea rows={3} maxLength={1000} value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

const EVENT_LABEL: Record<string, string> = { created: 'Assigned', edited: 'Edited', reassigned: 'Reassigned', progress: 'Progress update', completed: 'Completed', reopened: 'Reopened', cancelled: 'Cancelled' };

function AssignmentHistory({ value, onClose }: { value: Assignment | null; onClose: () => void }) {
  const lk = useHRLookup();
  const [rows, setRows] = useState<TaskEvent[] | null>(null);
  useEffect(() => {
    if (!value || !supabase) { setRows(value ? [] : null); return; }
    let alive = true;
    setRows(null);
    void supabase.from('task_events').select('*').eq('task_id', value.id).order('at').then(({ data }) => {
      if (alive) setRows(((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), taskId: r.task_id as string, at: r.at as string, actor: r.actor as string | null, action: r.action as string, detail: r.detail as Record<string, unknown> | null })));
    });
    return () => { alive = false; };
  }, [value]);
  return (
    <Modal open={!!value} onClose={onClose} title="Assignment history" subtitle={value?.title} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {value?.description && <p className="mb-4 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-sm text-ink-soft">{value.description}</p>}
      {rows === null ? <p className="text-sm text-ink-soft">Loading…</p> : rows.length === 0 ? <EmptyState icon={History} title="No history yet" /> : (
        <ol className="space-y-3">
          {rows.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
              <div className="min-w-0 text-sm">
                <div className="font-medium text-heading">{EVENT_LABEL[e.action] ?? e.action}{e.detail?.status ? ` · ${String(e.detail.status)}` : ''}{typeof e.detail?.progress === 'number' ? ` · ${e.detail.progress}%` : ''}</div>
                <div className="text-xs text-ink-mute">{e.actor ? lk.name(e.actor) : 'System'} · {new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                {e.action === 'reassigned' && <div className="text-xs text-ink-soft">{lk.name(String(e.detail?.from ?? ''))} → {lk.name(String(e.detail?.to ?? ''))}</div>}
                {(e.detail?.note || e.detail?.reason) ? <div className="mt-0.5 text-xs text-ink-soft">“{String(e.detail?.note ?? e.detail?.reason)}”</div> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ my assigned tasks

export function MyAssignedTasks() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const { me } = useWho();
  const today = companyDate(now());
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [progressOf, setProgressOf] = useState<Assignment | null>(null);
  const [historyOf, setHistoryOf] = useState<Assignment | null>(null);
  const mine = data.assignments.filter((a) => a.assignedTo === me);
  const open = mine.filter(isOpen).sort((a, b) => a.due.localeCompare(b.due));
  const closed = mine.filter((a) => !isOpen(a)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const list = tab === 'open' ? open : closed;
  return (
    <>
      <PageHeader title="My Assigned Tasks" subtitle="Work assigned to you. Keep the status and progress up to date — whoever assigned it sees changes straight away." />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open', count: open.length }, { value: 'done', label: 'Completed & cancelled', count: closed.length }]} />
      {list.length === 0 ? <Card><EmptyState icon={Briefcase} title={tab === 'open' ? 'Nothing assigned to you' : 'Nothing here yet'} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const late = isOpen(a) && istDate(a.due) < today;
            return (
              <Card key={a.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-[15px] font-semibold text-heading">{a.title}</h3>
                  <Badge tone={priorityTone[a.priority]}>{a.priority}</Badge>
                </div>
                {a.description && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink-soft">{a.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <Badge tone={statusTone[a.status]}>{a.status}</Badge>
                  <span className={cn(late && 'font-semibold text-red-600')}>Due {fmtDay(istDate(a.due))}{late ? ' · overdue' : ''}</span>
                  {a.assignedBy && <span>· from {lk.name(a.assignedBy)}</span>}
                </div>
                <div className="mt-3 flex items-center gap-2"><Progress value={a.progress} className="dark:bg-white/10" /><span className="w-9 text-right text-xs tabular-nums text-ink-soft">{a.progress}%</span></div>
                <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
                  <Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryOf(a)}>History</Button>
                  {isOpen(a) && <Button size="sm" onClick={() => setProgressOf(a)}>Update progress</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ProgressDialog value={progressOf} onClose={() => setProgressOf(null)} />
      <AssignmentHistory value={historyOf} onClose={() => setHistoryOf(null)} />
    </>
  );
}

// ------------------------------------------------------------------ company assets

const assetTone: Record<CompanyAsset['status'], 'green' | 'blue' | 'amber' | 'slate' | 'red'> = { Available: 'green', Assigned: 'blue', 'In Repair': 'amber', Retired: 'slate', Lost: 'red' };

export function CompanyAssets() {
  const { data, call, now } = useHR();
  const lk = useHRLookup();
  const today = companyDate(now());
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Partial<CompanyAsset> | null>(params.get('add') === '1' ? { category: 'Laptop' } : null);
  useEffect(() => { if (params.get('add')) setParams((p) => { p.delete('add'); return p; }, { replace: true }); }, [params, setParams]);
  const [issuing, setIssuing] = useState<CompanyAsset | null>(null);
  const [returning, setReturning] = useState<CompanyAsset | null>(null);
  const [historyOf, setHistoryOf] = useState<CompanyAsset | null>(null);
  const holder = (id: string) => data.assetAssignments.find((x) => x.assetId === id && !x.returnedOn);
  const rows = data.assets.filter((a) => matches(q, a.assetTag, a.name, a.serialNumber ?? '', holder(a.id) ? lk.name(holder(a.id)!.employeeId) : '')
    && (!cat || a.category === cat) && (!status || a.status === status));
  const paged = usePaged(rows, 20, `${q}${cat}${status}`);
  const count = (s: CompanyAsset['status']) => data.assets.filter((a) => a.status === s).length;
  const [ret, setRet] = useState({ date: today, condition: '', note: '', status: 'Available' });
  const [iss, setIss] = useState({ emp: '', date: today, expected: '', condition: '', note: '' });
  useEffect(() => { if (returning) setRet({ date: today, condition: '', note: '', status: 'Available' }); }, [returning, today]);
  useEffect(() => { if (issuing) setIss({ emp: '', date: today, expected: '', condition: '', note: '' }); }, [issuing, today]);
  const people = data.directory.filter((e) => e.employmentStatus !== 'Resigned' && e.accountStatus === 'active');

  return (
    <>
      <PageHeader title="Company Assets" subtitle="Equipment owned by SSI GLOBAL, who holds it and its full issue / return history."
        actions={<>
          <ExportButtons filename="ssi-company-assets" rows={() => rows.map((a) => ({ Tag: a.assetTag, Name: a.name, Category: a.category, Serial: a.serialNumber ?? '', Status: a.status,
            'Held by': holder(a.id) ? lk.name(holder(a.id)!.employeeId) : '', 'Issued on': holder(a.id)?.issuedOn ?? '', Purchased: a.purchaseDate ?? '', 'Warranty until': a.warrantyUntil ?? '' }))} />
          <Button icon={PackagePlus} onClick={() => setEditing({ category: 'Laptop' })}>Add asset</Button>
        </>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI icon={Laptop} label="Total assets" value={data.assets.length} onClick={() => setStatus('')} />
        <KPI icon={Users} tone="navy" label="Assigned" value={count('Assigned')} onClick={() => setStatus('Assigned')} />
        <KPI icon={PackageCheck} tone="green" label="Available" value={count('Available')} onClick={() => setStatus('Available')} />
        <KPI icon={XCircle} tone="amber" label="In repair / lost" value={count('In Repair') + count('Lost')} onClick={() => setStatus('In Repair')} />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search tag, name, serial or holder…" className="w-full sm:w-72" />
          <FilterSelect label="Category" value={cat} onChange={setCat} options={[{ value: '', label: 'All categories' }, ...ASSET_CATEGORIES]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'Any status' }, 'Available', 'Assigned', 'In Repair', 'Retired', 'Lost']} />
        </div>
        {rows.length === 0 ? <EmptyState icon={Laptop} title="No assets" description="Add the company's laptops, phones and other equipment." /> : (
          <>
            <Table className="hr-table" head={['Asset', 'Category', 'Status', 'Held by', 'Warranty', '']}>
              {paged.rows.map((a) => {
                const h = holder(a.id);
                return (
                  <tr key={a.id}>
                    <td className="min-w-[200px]"><div className="font-medium text-heading">{a.name}</div><div className="text-xs text-ink-mute">{a.assetTag}{a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}</div></td>
                    <td>{a.category}</td>
                    <td><Badge tone={assetTone[a.status]}>{a.status}</Badge></td>
                    <td>{h ? <><div className="font-medium text-heading">{lk.name(h.employeeId)}</div><div className="text-xs text-ink-mute">since {fmtDay(h.issuedOn)}{h.expectedReturn ? ` · return by ${fmtDay(h.expectedReturn)}` : ''}</div></> : <span className="text-ink-mute">—</span>}</td>
                    <td className={cn(a.warrantyUntil && a.warrantyUntil < today && 'text-ink-mute')}>{a.warrantyUntil ? fmtDay(a.warrantyUntil) : '—'}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" icon={History} aria-label="History" onClick={() => setHistoryOf(a)} />
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEditing(a)} />
                      {a.status === 'Available' && <Button size="sm" variant="secondary" onClick={() => setIssuing(a)}>Assign</Button>}
                      {a.status === 'Assigned' && <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setReturning(a)}>Return</Button>}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="assets" />
          </>
        )}
      </Card>

      <AssetDialog value={editing} onClose={() => setEditing(null)} />
      <Modal open={!!issuing} onClose={() => setIssuing(null)} title="Assign asset" subtitle={issuing ? `${issuing.name} · ${issuing.assetTag}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setIssuing(null)}>Cancel</Button><Button disabled={!iss.emp || !iss.date || (!!iss.expected && iss.expected < iss.date)} onClick={async () => {
          if (!issuing) return;
          const r = await call('assign_asset', { p_asset: issuing.id, p_emp: iss.emp, p_issued: iss.date, p_expected: iss.expected || null, p_condition: iss.condition || null, p_note: iss.note || null },
            { refresh: ['assets', 'assetAssignments'], success: 'Asset assigned', successDetail: 'The employee was notified.' });
          if (r.ok) setIssuing(null);
        }}>Assign</Button></>}>
        <div className="space-y-4">
          <Field label="Employee" required>
            <Select value={iss.emp} searchable onChange={(e) => setIss({ ...iss, emp: e.target.value })}>
              <option value="">Choose employee</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} · {p.employeeCode}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Issue date" required><DatePicker value={iss.date} clearable={false} onChange={(v) => v && setIss({ ...iss, date: v })} /></Field>
            <Field label="Expected return" error={iss.expected && iss.expected < iss.date ? 'Before the issue date' : undefined}><DatePicker value={iss.expected} min={iss.date} onChange={(v) => setIss({ ...iss, expected: v ?? '' })} /></Field>
          </div>
          <Field label="Condition when issued"><Input maxLength={300} value={iss.condition} onChange={(e) => setIss({ ...iss, condition: e.target.value })} placeholder="e.g. New, sealed box" /></Field>
          <Field label="Note"><Textarea rows={2} maxLength={1000} value={iss.note} onChange={(e) => setIss({ ...iss, note: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={!!returning} onClose={() => setReturning(null)} title="Record return" subtitle={returning ? `${returning.name} · held by ${lk.name(holder(returning.id)?.employeeId ?? '')}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setReturning(null)}>Cancel</Button><Button disabled={!ret.date || ret.date > today} onClick={async () => {
          if (!returning) return;
          const r = await call('return_asset', { p_asset: returning.id, p_returned: ret.date, p_condition: ret.condition || null, p_note: ret.note || null, p_status: ret.status },
            { refresh: ['assets', 'assetAssignments'], success: 'Return recorded' });
          if (r.ok) setReturning(null);
        }}>Record return</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Return date" required><DatePicker value={ret.date} clearable={false} max={today} onChange={(v) => v && setRet({ ...ret, date: v })} /></Field>
            <Field label="Asset status after return">
              <Select value={ret.status} onChange={(e) => setRet({ ...ret, status: e.target.value })}>
                <option value="Available">Available</option><option value="In Repair">In Repair</option><option value="Retired">Retired</option><option value="Lost">Lost</option>
              </Select>
            </Field>
          </div>
          <Field label="Condition on return"><Input maxLength={300} value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })} placeholder="e.g. Scratch on lid" /></Field>
          <Field label="Note"><Textarea rows={2} maxLength={1000} value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={!!historyOf} onClose={() => setHistoryOf(null)} title="Asset history" subtitle={historyOf ? `${historyOf.name} · ${historyOf.assetTag}` : undefined} footer={<Button variant="secondary" onClick={() => setHistoryOf(null)}>Close</Button>}>
        {historyOf && (data.assetAssignments.filter((x) => x.assetId === historyOf.id).length === 0 ? <EmptyState icon={History} title="Never issued" /> : (
          <Table className="hr-table" head={['Employee', 'Issued', 'Returned', 'Condition (out / in)']}>
            {data.assetAssignments.filter((x) => x.assetId === historyOf.id).map((x) => (
              <tr key={x.id}>
                <td className="font-medium text-heading">{lk.name(x.employeeId)}</td>
                <td className="whitespace-nowrap">{fmtDay(x.issuedOn)}</td>
                <td className="whitespace-nowrap">{x.returnedOn ? fmtDay(x.returnedOn) : <Badge tone="blue">Holding</Badge>}</td>
                <td className="text-ink-soft">{x.conditionOut ?? '—'} / {x.conditionIn ?? '—'}</td>
              </tr>
            ))}
          </Table>
        ))}
      </Modal>
    </>
  );
}

function AssetDialog({ value, onClose }: { value: Partial<CompanyAsset> | null; onClose: () => void }) {
  const { data, write } = useHR();
  const [a, setA] = useState<Partial<CompanyAsset>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (value) setA(value); }, [value]);
  const tag = (a.assetTag ?? '').trim().toUpperCase();
  const tagErr = tag.length < 2 ? 'At least 2 characters' : data.assets.some((x) => x.id !== a.id && x.assetTag.toUpperCase() === tag) ? 'This tag is already used' : '';
  const nameErr = (a.name ?? '').trim().length < 2 ? 'At least 2 characters' : '';
  const save = async () => {
    if (tagErr || nameErr) return;
    setBusy(true);
    const row: Record<string, unknown> = { asset_tag: tag, name: (a.name ?? '').trim(), category: a.category ?? 'Other', serial_number: a.serialNumber?.trim() || null,
      purchase_date: a.purchaseDate || null, warranty_until: a.warrantyUntil || null, notes: a.notes?.trim() || null };
    if (a.id && a.status !== 'Assigned') row.status = a.status;
    const ok = a.id ? await write('company_assets', 'update', row, { id: a.id }, { refresh: ['assets'], success: 'Asset saved' })
      : await write('company_assets', 'insert', row, undefined, { refresh: ['assets'], success: 'Asset added' });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal open={!!value} onClose={onClose} title={a.id ? 'Edit asset' : 'Add asset'} dirty={!!a.name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !!tagErr || !!nameErr} onClick={save}>{busy ? 'Saving…' : 'Save asset'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asset tag" required error={a.assetTag !== undefined && tag ? tagErr : undefined}><Input value={a.assetTag ?? ''} maxLength={40} onChange={(e) => setA({ ...a, assetTag: e.target.value })} placeholder="e.g. LAP-014" /></Field>
          <Field label="Category" required>
            <Select value={a.category ?? 'Other'} onChange={(e) => setA({ ...a, category: e.target.value as CompanyAsset['category'] })}>
              {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Name" required error={a.name !== undefined && a.name ? nameErr : undefined}><Input value={a.name ?? ''} maxLength={120} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Laptop 14-inch" /></Field>
        <Field label="Serial number"><Input value={a.serialNumber ?? ''} maxLength={120} onChange={(e) => setA({ ...a, serialNumber: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purchase date"><DatePicker value={a.purchaseDate ?? ''} onChange={(v) => setA({ ...a, purchaseDate: v })} /></Field>
          <Field label="Warranty until"><DatePicker value={a.warrantyUntil ?? ''} onChange={(v) => setA({ ...a, warrantyUntil: v })} /></Field>
        </div>
        {a.id && a.status !== 'Assigned' && (
          <Field label="Status" hint="Use Assign / Return to issue the asset to someone.">
            <Select value={a.status ?? 'Available'} onChange={(e) => setA({ ...a, status: e.target.value as CompanyAsset['status'] })}>
              <option value="Available">Available</option><option value="In Repair">In Repair</option><option value="Retired">Retired</option><option value="Lost">Lost</option>
            </Select>
          </Field>
        )}
        <Field label="Notes"><Textarea rows={2} maxLength={1000} value={a.notes ?? ''} onChange={(e) => setA({ ...a, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ employee documents

/** Records the download on the server, then opens a 60-second signed link. */
export async function openHRDocument(id: string) {
  if (!supabase) throw new Error('Not configured');
  const { data: path, error } = await supabase.rpc('authorize_hr_document', { p_id: id });
  if (error || !path) throw new Error('You do not have access to this document.');
  const { data, error: e2 } = await supabase.storage.from(HR_BUCKET).createSignedUrl(path as string, 60);
  if (e2 || !data) throw new Error('The file is not available.');
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function EmployeeDocuments() {
  const { data, write, now } = useHR();
  const lk = useHRLookup();
  const toast = useToast();
  const today = companyDate(now());
  const [q, setQ] = useState('');
  const [emp, setEmp] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('Active');
  const [params, setParams] = useSearchParams();
  const [uploading, setUploading] = useState(params.get('upload') === '1');
  useEffect(() => { if (params.get('upload')) setParams((p) => { p.delete('upload'); return p; }, { replace: true }); }, [params, setParams]);
  const [archiving, setArchiving] = useState<{ d: EmployeeDocument; reason: string } | null>(null);
  const [historyOf, setHistoryOf] = useState<EmployeeDocument | null>(null);
  const rows = data.documents.filter((d) => matches(q, d.title, d.fileName, lk.name(d.employeeId)) && (!emp || d.employeeId === emp) && (!cat || d.category === cat) && (!status || d.status === status));
  const paged = usePaged(rows, 20, `${q}${emp}${cat}${status}`);
  const open = async (id: string) => {
    try { await openHRDocument(id); } catch (e) { toast.error('Could not open the document', e instanceof Error ? e.message : undefined); }
  };
  const expiring = data.documents.filter((d) => d.status === 'Active' && d.expiresOn && d.expiresOn <= new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));

  return (
    <>
      <PageHeader title="Employee Documents" subtitle="Private HR files. Employees see a document only when you share it with them; every upload, download, share and archive is recorded."
        actions={<>
          <ExportButtons filename="ssi-employee-documents" rows={() => rows.map((d) => ({ Employee: lk.name(d.employeeId), Category: d.category, Title: d.title, File: d.fileName, Size: kb(d.size),
            Shared: d.visibleToEmployee ? 'Yes' : 'No', Status: d.status, Uploaded: d.uploadedAt.slice(0, 10), 'Uploaded by': d.uploadedBy ? lk.name(d.uploadedBy) : '', Expires: d.expiresOn ?? '' }))} />
          <Button icon={Upload} onClick={() => setUploading(true)}>Upload document</Button>
        </>} />
      {expiring.length > 0 && <Alert tone="warning" className="mb-4">{expiring.length} document(s) expire within 30 days or have expired: {expiring.slice(0, 4).map((d) => `${d.title} (${lk.name(d.employeeId)})`).join(', ')}{expiring.length > 4 ? '…' : ''}</Alert>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search title, file or employee…" className="w-full sm:w-72" />
          <FilterSelect label="Employee" value={emp} onChange={setEmp} options={[{ value: '', label: 'Everyone' }, ...data.directory.map((d) => ({ value: d.id, label: d.fullName }))]} />
          <FilterSelect label="Category" value={cat} onChange={setCat} options={[{ value: '', label: 'All categories' }, ...HR_DOCUMENT_CATEGORIES]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'Active', label: 'Active' }, { value: 'Archived', label: 'Archived' }, { value: '', label: 'All' }]} />
        </div>
        {rows.length === 0 ? <EmptyState icon={FileText} title="No documents" description="Upload contracts, offer letters, ID proofs and other HR files." /> : (
          <>
            <Table className="hr-table" head={['Document', 'Employee', 'Category', 'Shared with employee', 'Uploaded', '']}>
              {paged.rows.map((d) => (
                <tr key={d.id}>
                  <td className="min-w-[200px]">
                    <div className="font-medium text-heading">{d.title}</div>
                    <div className="text-xs text-ink-mute">{d.fileName} · {kb(d.size)}{d.expiresOn ? ` · expires ${fmtDay(d.expiresOn)}` : ''}</div>
                    {d.status === 'Archived' && <div className="text-xs text-ink-soft">Archived: {d.archiveReason}</div>}
                  </td>
                  <td>{lk.name(d.employeeId)}</td>
                  <td>{d.category === 'Medical' ? <Badge tone="violet">Medical</Badge> : d.category}</td>
                  <td>{d.visibleToEmployee ? <Badge tone="green">Shared</Badge> : <span className="text-ink-mute">HR only</span>}</td>
                  <td className="whitespace-nowrap">{fmtDay(d.uploadedAt.slice(0, 10))}<div className="text-xs text-ink-mute">{d.uploadedBy ? lk.name(d.uploadedBy) : ''}</div></td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" icon={Download} aria-label="View or download" onClick={() => void open(d.id)} />
                    <Button size="sm" variant="ghost" icon={History} aria-label="History" onClick={() => setHistoryOf(d)} />
                    {d.status === 'Active' ? <>
                      <Button size="sm" variant="ghost" icon={d.visibleToEmployee ? EyeOff : Eye} aria-label={d.visibleToEmployee ? 'Stop sharing with the employee' : 'Share with the employee'}
                        onClick={() => void write('employee_documents', 'update', { visible_to_employee: !d.visibleToEmployee }, { id: d.id }, { refresh: ['documents'], success: d.visibleToEmployee ? 'No longer shared' : 'Shared with the employee' })} />
                      <Button size="sm" variant="ghost" icon={Archive} aria-label="Archive" onClick={() => setArchiving({ d, reason: '' })} />
                    </> : <Button size="sm" variant="ghost" icon={ArchiveRestore} aria-label="Restore" onClick={() => void write('employee_documents', 'update', { status: 'Active' }, { id: d.id }, { refresh: ['documents'], success: 'Document restored' })} />}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="documents" />
          </>
        )}
      </Card>
      <UploadDocumentModal open={uploading} onClose={() => setUploading(false)} />
      <Modal open={!!archiving} onClose={() => setArchiving(null)} size="sm" title="Archive document" subtitle={archiving?.d.title}
        footer={<><Button variant="secondary" onClick={() => setArchiving(null)}>Cancel</Button><Button disabled={(archiving?.reason.trim().length ?? 0) < 3} onClick={async () => {
          if (!archiving) return;
          if (await write('employee_documents', 'update', { status: 'Archived', archive_reason: archiving.reason.trim() }, { id: archiving.d.id }, { refresh: ['documents'], success: 'Document archived' })) setArchiving(null);
        }}>Archive</Button></>}>
        <Field label="Reason" required><Input maxLength={300} value={archiving?.reason ?? ''} onChange={(e) => setArchiving((x) => (x ? { ...x, reason: e.target.value } : x))} placeholder="e.g. Replaced by renewed contract" /></Field>
        <p className="mt-2 text-xs text-ink-mute">The file is kept and can be restored. Archived documents are hidden from the employee.</p>
      </Modal>
      <DocumentHistory value={historyOf} onClose={() => setHistoryOf(null)} />
    </>
  );
}

const DOC_EVENT: Record<string, string> = { uploaded: 'Uploaded', downloaded: 'Viewed / downloaded', shared: 'Shared with the employee', unshared: 'Sharing stopped', archived: 'Archived', restored: 'Restored', edited: 'Details edited' };

function DocumentHistory({ value, onClose }: { value: EmployeeDocument | null; onClose: () => void }) {
  const lk = useHRLookup();
  const [rows, setRows] = useState<{ id: string; at: string; actor: string | null; action: string }[] | null>(null);
  useEffect(() => {
    if (!value || !supabase) { setRows(value ? [] : null); return; }
    let alive = true;
    setRows(null);
    void supabase.from('employee_document_events').select('id, at, actor, action').eq('document_id', value.id).order('at').then(({ data }) => {
      if (alive) setRows(((data ?? []) as { id: number; at: string; actor: string | null; action: string }[]).map((r) => ({ ...r, id: String(r.id) })));
    });
    return () => { alive = false; };
  }, [value]);
  return (
    <Modal open={!!value} onClose={onClose} title="Document history" subtitle={value ? `${value.title} · ${lk.name(value.employeeId)}` : undefined} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {rows === null ? <p className="text-sm text-ink-soft">Loading…</p> : rows.length === 0 ? <EmptyState icon={History} title="No history" /> : (
        <ol className="space-y-2.5">
          {rows.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-heading">{DOC_EVENT[e.action] ?? e.action}</span>
              <span className="text-right text-xs text-ink-mute">{e.actor ? lk.name(e.actor) : 'System'} · {new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

export function UploadDocumentModal({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId?: string }) {
  const { data, load } = useHR();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({ emp: '', category: 'Offer Letter', title: '', share: false, expires: '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ emp: employeeId ?? '', category: 'Offer Letter', title: '', share: false, expires: '' }); setFile(null); setErr(null); } }, [open, employeeId]);
  const people = data.directory.filter((e) => e.employmentStatus !== 'Resigned');
  const ready = f.emp && f.title.trim().length >= 2 && file && !busy;
  const submit = async () => {
    if (!ready || !file || !supabase) return;
    if (f.share && f.category === 'Medical' && !(await confirm({ title: 'Share a medical document?', message: 'The employee will be able to view this medical document. Nobody else except HR can see it.', confirmLabel: 'Share it' }))) return;
    setBusy(true);
    setErr(null);
    try {
      const prepared = await prepareUpload(file);
      const id = crypto.randomUUID();
      const path = `${f.emp}/${id}.${prepared.ext}`;
      const up = await supabase.storage.from(HR_BUCKET).upload(path, file, { contentType: prepared.mime, upsert: false });
      if (up.error) throw new Error('The upload was rejected by the server.');
      const res = await supabase.from('employee_documents').insert({
        id, employee_id: f.emp, category: f.category, title: f.title.trim(), file_name: prepared.safeName, size: file.size, mime: prepared.mime,
        storage_path: path, visible_to_employee: f.share, expires_on: f.expires || null,
      });
      if (res.error) {
        await supabase.storage.from(HR_BUCKET).remove([path]);
        throw new Error(serverMessage(res.error));
      }
      toast.success('Document uploaded', f.share ? 'Shared with the employee, who was notified.' : 'Visible to HR only.');
      void load(['documents']);
      onClose();
    } catch (e) {
      setErr(e instanceof UploadError || e instanceof Error ? e.message : 'The document could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Upload employee document" subtitle="PDF, Word, JPG or PNG up to 10 MB. Stored privately; never a public link." dirty={!!file}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Upload} disabled={!ready} onClick={submit}>{busy ? 'Uploading…' : 'Upload'}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Employee" required>
          <Select value={f.emp} searchable onChange={(e) => setF({ ...f, emp: e.target.value })}>
            <option value="">Choose employee</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} · {p.employeeCode}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" required>
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {HR_DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Expires on" hint="Optional — e.g. visa or ID expiry"><DatePicker value={f.expires} onChange={(v) => setF({ ...f, expires: v ?? '' })} /></Field>
        </div>
        <Field label="Title" required><Input maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Employment contract 2026" /></Field>
        <Field label="File" required>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-4 text-sm text-ink-soft transition hover:border-brand-300 focus-within:ring-2 focus-within:ring-brand-300">
            <Upload className="h-5 w-5 text-rust" />
            <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${kb(file.size)}` : 'Choose a file…'}</span>
            <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} />
          </label>
        </Field>
        <Checkbox checked={f.share} onCheckedChange={(v) => setF({ ...f, share: v })} label="Share with the employee" description="They can view and download it from My Profile and are notified. You can stop sharing later." />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ self-service (My Profile)

/** The signed-in employee's shared HR documents and the company assets they hold. */
export function MyDocumentsAndAssets() {
  const { data } = useHR();
  const { me } = useWho();
  const toast = useToast();
  const docs = data.documents.filter((d) => d.employeeId === me && d.visibleToEmployee && d.status === 'Active');
  const held = data.assetAssignments.filter((x) => x.employeeId === me && !x.returnedOn);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="My HR documents" subtitle="Documents HR has shared with you" />
        {docs.length === 0 ? <EmptyState icon={FileText} title="No documents shared yet" /> : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <FileText className="h-5 w-5 shrink-0 text-rust" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-heading">{d.title}</span><span className="block text-xs text-ink-soft">{d.category} · {fmtDay(d.uploadedAt.slice(0, 10))}</span></span>
                <Button size="sm" variant="secondary" icon={Download} onClick={() => void openHRDocument(d.id).catch((e) => toast.error('Could not open the document', e instanceof Error ? e.message : undefined))}>Open</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Company assets with me" subtitle="Return them to HR when you leave" />
        {held.length === 0 ? <EmptyState icon={Laptop} title="No company assets" /> : (
          <ul className="divide-y divide-line">
            {held.map((x) => {
              const a = data.assets.find((y) => y.id === x.assetId);
              return (
                <li key={x.id} className="flex items-center gap-3 px-5 py-3">
                  <Laptop className="h-5 w-5 shrink-0 text-rust" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-heading">{a?.name ?? 'Asset'}</span><span className="block text-xs text-ink-soft">{a?.assetTag} · since {fmtDay(x.issuedOn)}{x.expectedReturn ? ` · return by ${fmtDay(x.expectedReturn)}` : ''}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
