import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, Circle, ExternalLink, ListChecks, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Progress, Select, SelectMenu, type SelectOption } from './ui';
import { ChatButton } from './ApplicationChat';
import { useConfirm, useToast } from './feedback';
import { useLookup, useScoped, useStore } from '../store/store';
import { APP_STATUSES, type AppStatus, type Application } from '../data/types';
import { appStatusColor, appStatusTone, cn, countryFlag, formatDate, formatDateTime, fullName, money } from '../lib/utils';
import { ApplicationMilestones } from './ApplicationMilestones';
import { ApplicationCommission } from './ApplicationCommission';
import { supabase } from '../auth/auth';
import { RecordTaskHistory, RecordTaskModal, canRaiseRecordTasks } from './RecordTaskModal';
import { ROLE_LABEL } from '../auth/roles';
import type { UserRole } from '../data/types';

export function StatusBadge({ status }: { status: AppStatus }) {
  return (
    <Badge tone={appStatusTone[status]} dot>
      {status}
    </Badge>
  );
}

const PIPELINE: AppStatus[] = ['Draft', 'Pending Assessment', 'Submitted', 'Offer Pending', 'Conditional Offer', 'Unconditional Offer', 'Visa Lodged', 'Visa Granted'];

export function stageProgress(status: AppStatus) {
  if (status === 'Visa Refused') return 100;
  return Math.round(((PIPELINE.indexOf(status) + 1) / PIPELINE.length) * 100);
}

export function PipelineStepper({ status }: { status: AppStatus }) {
  const refused = status === 'Visa Refused';
  const current = refused ? PIPELINE.length - 1 : PIPELINE.indexOf(status);
  return (
    <ol className="flex items-start">
      {PIPELINE.map((s, i) => {
        const done = i < current || (i === current && status === 'Visa Granted');
        const active = i === current;
        const label = refused && i === PIPELINE.length - 1 ? 'Visa Refused' : s;
        return (
          <li key={s} className="flex flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : i <= current ? 'bg-rust' : 'bg-line')} />
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition',
                  done && 'bg-rust text-white',
                  active && !done && (refused ? 'bg-red-600 text-white' : 'bg-surface text-rust ring-2 ring-rust'),
                  !done && !active && 'bg-canvas text-ink-mute ring-1 ring-line',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('h-0.5 flex-1', i === PIPELINE.length - 1 ? 'bg-transparent' : i < current ? 'bg-rust' : 'bg-line')} />
            </div>
            <span className={cn('mt-1.5 hidden px-0.5 text-[10px] font-medium leading-tight sm:block', active ? (refused ? 'text-red-600' : 'text-rust') : 'text-ink-mute')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Application details, centred modal used in every portal (Admin, Staff, Partner).
 * Internal users can change status (with a note), assign an employee and delete; everyone
 * with access can tick the document checklist. Changes save through the store (RLS applies)
 * and the open modal updates live when someone else changes the application.
 */
interface Assignee { id: string; full_name: string; designation: string | null; role: UserRole; open_applications: number; application_team: boolean }

/** Who this user may pick as Assigned staff for one application (server-checked; empty = not allowed). */
function useAssignees(appId: string | undefined, enabled: boolean, rev: unknown) {
  const [list, setList] = useState<Assignee[] | null>(null);
  useEffect(() => {
    if (!appId || !enabled || !supabase) { setList([]); return; }
    let alive = true;
    setList(null);
    void supabase.rpc('application_assignees', { p_app: appId }).then(({ data, error }) => {
      if (alive) setList(error ? [] : ((data ?? []) as Assignee[]));
    });
    return () => { alive = false; };
  }, [appId, enabled, rev]);
  return list;
}

export function ApplicationDetailsModal({ app, onClose }: { app?: Application; onClose: () => void }) {
  const { actions, db, session, canDelete } = useStore();
  const scoped = useScoped();
  const lk = useLookup();
  const toast = useToast();
  const confirm = useConfirm();
  const [nextStatus, setNextStatus] = useState<AppStatus>('Draft');
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskRev, setTaskRev] = useState(0);

  useEffect(() => {
    if (app) {
      setNextStatus(app.status);
      setNote('');
      setAssignee(app.assignedTo ?? '');
      setReason('');
      setAssignError('');
    }
  }, [app?.id, app?.status, app?.assignedTo]);
  // Admin Portal users with Applications, and Partner Success Officers for their own clients and leads.
  const perms = session?.permissions ?? [];
  const mayAssign = !!session && (session.userRole === 'super_admin' || (session.role === 'admin' && perms.includes('applications'))
    || (perms.includes('partner_success') && perms.includes('applications')));
  const assignees = useAssignees(app?.id, mayAssign, app?.assignedTo);

  if (!app) return null;
  const student = lk.student.get(app.studentId);
  const uni = lk.university.get(app.universityId);
  const course = lk.course.get(app.courseId);
  const partner = lk.partner.get(app.partnerId);
  const docs = scoped.documents.filter((d) => d.studentId === app.studentId);
  const done = app.checklist.filter((c) => c.done).length;
  const internal = scoped.isAdmin;
  const isAdminAssigner = session?.userRole === 'super_admin' || (session?.role === 'admin' && perms.includes('applications'));
  const canAssign = mayAssign && !!assignees?.length;
  const statusChanged = nextStatus !== app.status;
  const assignChanged = canAssign && assignee !== (app.assignedTo ?? '');
  const dirty = internal && (statusChanged || assignChanged || note.trim() !== '');
  const nameOf = (id: string | null | undefined) => (id ? assignees?.find((m) => m.id === id)?.full_name ?? db.staff.find((m) => m.id === id)?.fullName ?? 'Assigned' : 'Unassigned');
  const assigneeOptions: SelectOption[] = (assignees ?? []).map((m) => ({
    value: m.id,
    label: `${m.full_name} · ${m.designation ?? ROLE_LABEL[m.role] ?? m.role} · ${m.open_applications} open application${m.open_applications === 1 ? '' : 's'}${m.id === app.assignedTo ? ' (current)' : ''}`,
    group: isAdminAssigner ? (m.application_team ? 'Application Team' : 'Other employees') : undefined,
  }));
  if (app.assignedTo && !assigneeOptions.some((o) => o.value === app.assignedTo)) {
    assigneeOptions.unshift({ value: app.assignedTo, label: `${nameOf(app.assignedTo)} (current)`, disabled: true });
  }
  const assignHint = !mayAssign ? 'Only Admin and the client\'s Partner Success Officer can assign'
    : assignees === null ? 'Loading Application Team…'
    : !canAssign ? 'You can assign applications of your own clients and leads only'
    : 'The employee is notified instantly';

  const save = async () => {
    if (!statusChanged && !assignChanged) return toast.info('No changes', note.trim() ? 'A note is saved together with a status change.' : 'Pick a different status or assignee.');
    setAssignError('');
    if (assignChanged) {
      setSaving(true);
      try {
        // Wait for the database: nothing is reported as saved until it is.
        await actions.assignApplication(app.id, assignee || null, app.assignedTo ? reason : undefined);
      } catch (e) {
        setSaving(false);
        const msg = e instanceof Error ? e.message : 'The assignment could not be saved.';
        setAssignError(msg);
        return toast.error('Assignment not saved', msg);
      }
      setSaving(false);
    }
    if (statusChanged) actions.setApplicationStatus(app.id, nextStatus, note);
    toast.success('Application updated', [statusChanged && `${app.ref} is now “${nextStatus}”. The partner sees this immediately.`, assignChanged && `${app.ref} assigned to ${nameOf(assignee || null)}.`].filter(Boolean).join(' '));
    setNote('');
    setReason('');
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete application permanently?', message: `${app.ref} for ${fullName(student)} will be permanently removed with its chat and milestones. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    if (!(await actions.removeApplication(app.id))) return;
    toast.success('Application deleted');
    onClose();
  };

  return (
    <Modal
      open
      size="wide"
      dirty={dirty}
      onClose={onClose}
      headerActions={internal && canRaiseRecordTasks(session) ? (
        // Same place in every portal (Admin, Partnerships, Senior IRM, Partner Success, Application Team …).
        // Who can be chosen is decided by the server from the employee's permissions and reporting line.
        <Button size="sm" variant="secondary" icon={ListChecks} onClick={() => setTaskOpen(true)} className="sm:-mt-1">
          Assign Task or Escalate
        </Button>
      ) : undefined}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {app.ref} <StatusBadge status={app.status} />
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-heading">{fullName(student)}</span>
          <span className="text-ink-mute">·</span>
          <span>Created {formatDate(app.appliedAt)}</span>
          {internal && partner && (
            <>
              <span className="text-ink-mute">·</span>
              <span>{partner.name}</span>
            </>
          )}
        </span>
      }
      footer={
        <>
          {internal && canDelete && (
            <Button variant="ghost" icon={Trash2} className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10" onClick={remove}>
              Delete
            </Button>
          )}
          <ChatButton applicationId={app.id} label className={internal && canDelete ? undefined : 'mr-auto'} />
          {/* On phones the header × closes; keep the footer to the main actions. */}
          <Button variant="secondary" onClick={onClose} className={internal ? 'hidden sm:inline-flex' : undefined}>
            {internal ? 'Cancel' : 'Close'}
          </Button>
          {internal && (
            <Button icon={Save} onClick={() => void save()} disabled={(!statusChanged && !assignChanged) || saving} loading={saving}>
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        {/* Progress */}
        <section className="rounded-2xl border border-line bg-canvas/60 px-4 py-5 sm:px-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h4 className="font-display text-sm font-semibold text-heading">Application progress</h4>
            <span className="text-xs font-semibold text-ink-soft">{stageProgress(app.status)}% complete</span>
          </div>
          <PipelineStepper status={app.status} />
          <p className="mt-3 text-center text-xs font-semibold text-rust sm:hidden">
            {app.status === 'Visa Refused' ? 'Visa Refused' : `Step ${PIPELINE.indexOf(app.status) + 1} of ${PIPELINE.length} · ${app.status}`}
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Left: facts + checklist */}
          <div className="min-w-0 space-y-6">
            <section className="rounded-2xl border border-line p-5">
              <h4 className="mb-4 font-display text-sm font-semibold text-heading">Application information</h4>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <Info label="Student">
                  <Link to={`${scoped.base}/students/${app.studentId}`} onClick={onClose} className="inline-flex items-center gap-1 font-semibold text-heading hover:text-rust">
                    {fullName(student)} <ExternalLink className="h-3 w-3" />
                  </Link>
                </Info>
                <Info label="Destination country">
                  {countryFlag[uni?.country ?? '']} {uni?.country ?? '—'}
                </Info>
                <Info label="University">{uni?.name ?? '—'}</Info>
                <Info label="Course">{course?.name ?? '—'}</Info>
                <Info label="Intake">{app.intake || '—'}</Info>
                <Info label="Tuition fees / yr">{course ? money(course.tuition, course.currency) : '—'}</Info>
                <Info label="Application created">{formatDateTime(app.appliedAt)}</Info>
                {internal && <Info label="Assigned to">{nameOf(app.assignedTo)}</Info>}
              </dl>
            </section>

            <section className="rounded-2xl border border-line p-5">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-display text-sm font-semibold text-heading">Document checklist</h4>
                <span className={cn('text-xs font-semibold', done === app.checklist.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-soft')}>
                  {done}/{app.checklist.length} complete
                </span>
              </div>
              <Progress value={(done / Math.max(1, app.checklist.length)) * 100} className="mb-3" />
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {app.checklist.map((c, i) => (
                  <li key={c.label}>
                    <button
                      type="button"
                      aria-pressed={c.done}
                      onClick={() => actions.toggleChecklist(app.id, i)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                        c.done ? 'border-emerald-200 bg-emerald-50/60 text-heading dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-line hover:border-brand-200',
                      )}
                    >
                      {c.done ? <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-emerald-500" /> : <Circle className="h-[18px] w-[18px] shrink-0 text-ink-mute" />}
                      <span className={cn('flex-1 font-medium', c.done && 'text-ink-soft line-through decoration-ink-mute/40')}>{c.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {docs.length > 0 && (
                <p className="mt-3 text-xs text-ink-mute">
                  {docs.length} document(s) on file for this student ·{' '}
                  <Link to={`${scoped.base}/students/${app.studentId}`} onClick={onClose} className="font-semibold text-rust hover:underline">
                    view documents
                  </Link>
                </p>
              )}
            </section>
          </div>

          {/* Right: status management + timeline */}
          <div className="min-w-0 space-y-6">
            {internal && (
              <section className="rounded-2xl border border-brand-200 bg-brand-50/50 p-5 dark:border-brand-500/30 dark:bg-brand-500/10">
                <h4 className="mb-4 font-display text-sm font-semibold text-heading">Status management</h4>
                <div className="space-y-3">
                  <Field label="Update application status">
                    <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as AppStatus)} aria-label="New status">
                      {APP_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Note (optional)" hint="Visible to the partner in the timeline">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Offer letter received" />
                  </Field>
                  <Field label="Assigned staff" hint={assignError ? undefined : assignHint} error={assignError || undefined}>
                    <SelectMenu value={assignee} onChange={(v) => { setAssignee(v); setAssignError(''); }} options={assigneeOptions} searchable
                      placeholder="Unassigned" clearable={isAdminAssigner} disabled={!canAssign} aria-label="Assigned employee" />
                  </Field>
                  {assignChanged && app.assignedTo && (
                    <Field label="Reason for reassignment (optional)">
                      <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Workload balance" />
                    </Field>
                  )}
                  {dirty && <p className="text-xs font-semibold text-rust">Unsaved changes — use “Save changes” below.</p>}
                </div>
              </section>
            )}

            {internal && canRaiseRecordTasks(session) && <RecordTaskHistory applicationId={app.id} rev={taskRev} />}

            {internal && <ApplicationCommission applicationId={app.id} partnerId={app.partnerId} universityId={app.universityId} />}

            {internal && <ApplicationMilestones applicationId={app.id} deposit={app.depositStatus} cas={app.casStatus} />}

            <section className="rounded-2xl border border-line p-5">
              <h4 className="mb-4 font-display text-sm font-semibold text-heading">Status history</h4>
              <ol className="relative space-y-4 border-l-2 border-line pl-5">
                {[...app.timeline].reverse().map((t, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[27px] top-0.5 h-3.5 w-3.5 rounded-full ring-4 ring-surface" style={{ background: appStatusColor[t.status] }} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-heading">{t.status}</span>
                      <span className="text-xs text-ink-mute">{formatDateTime(t.at)}</span>
                    </div>
                    <div className="text-xs text-ink-soft">by {t.by}</div>
                    {t.note && <div className="mt-1 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-soft">{t.note}</div>}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </div>
      {internal && canRaiseRecordTasks(session) && (
        <RecordTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} applicationId={app.id}
          recordLabel={`${app.ref} · ${fullName(student)}${uni ? ` — ${uni.name}` : ''}`} onSaved={() => setTaskRev((n) => n + 1)} />
      )}
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-mute">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-heading">{children}</dd>
    </div>
  );
}
