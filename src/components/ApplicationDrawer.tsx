import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, Circle, ExternalLink, Trash2 } from 'lucide-react';
import { Badge, Button, Drawer, Field, Input, Progress, Select } from './ui';
import { useConfirm, useToast } from './feedback';
import { useLookup, useScoped, useStore } from '../store/store';
import { APP_STATUSES, type AppStatus, type Application } from '../data/types';
import { appStatusColor, appStatusTone, cn, countryFlag, formatDate, formatDateTime, fullName, money } from '../lib/utils';

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

export function ApplicationDrawer({ app, onClose }: { app?: Application; onClose: () => void }) {
  const { actions, db, session } = useStore();
  const scoped = useScoped();
  const lk = useLookup();
  const toast = useToast();
  const confirm = useConfirm();
  const [nextStatus, setNextStatus] = useState<AppStatus>('Draft');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (app) {
      setNextStatus(app.status);
      setNote('');
    }
  }, [app?.id, app?.status]);

  if (!app) return null;
  const student = lk.student.get(app.studentId);
  const uni = lk.university.get(app.universityId);
  const course = lk.course.get(app.courseId);
  const partner = lk.partner.get(app.partnerId);
  const docs = scoped.documents.filter((d) => d.studentId === app.studentId);
  const done = app.checklist.filter((c) => c.done).length;

  const applyStatus = () => {
    if (nextStatus === app.status) return toast.info('No change', 'Pick a different status to update.');
    actions.setApplicationStatus(app.id, nextStatus, note);
    toast.success('Status updated', `${app.ref} is now “${nextStatus}”. The partner can see this immediately.`);
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete application?', message: `${app.ref} for ${fullName(student)} will be permanently removed.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    actions.removeApplication(app.id);
    toast.success('Application deleted');
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {app.ref} <StatusBadge status={app.status} />
        </span>
      }
      subtitle={`Created ${formatDate(app.appliedAt)}${scoped.isAdmin && partner ? ` · ${partner.name}` : ''}`}
      footer={
        scoped.isAdmin ? (
          <Button variant="ghost" icon={Trash2} className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" onClick={remove}>
            Delete
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-line bg-canvas/60 p-4">
          <PipelineStepper status={app.status} />
        </div>

        <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Info label="Student">
            <Link to={`${scoped.base}/students/${app.studentId}`} className="inline-flex items-center gap-1 font-semibold text-heading hover:text-rust">
              {fullName(student)} <ExternalLink className="h-3 w-3" />
            </Link>
          </Info>
          <Info label="Country">
            {countryFlag[uni?.country ?? '']} {uni?.country}
          </Info>
          <Info label="University">{uni?.name}</Info>
          <Info label="Course">{course?.name}</Info>
          <Info label="Intake">{app.intake}</Info>
          <Info label="Tuition / yr">{course ? money(course.tuition, course.currency) : '—'}</Info>
        </section>

        {scoped.isAdmin && (
          <section className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4">
            <h4 className="mb-3 font-display text-sm font-semibold text-heading">Update status</h4>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as AppStatus)} aria-label="New status">
                {APP_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              <Button onClick={applyStatus} disabled={nextStatus === app.status}>
                Update status
              </Button>
            </div>
            <Field className="mt-3">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note visible to the partner…" />
            </Field>
            <Field label="Assigned to" hint="The employee is notified instantly" className="mt-3">
              <Select
                value={app.assignedTo ?? ''}
                onChange={(e) => actions.updateApplication(app.id, { assignedTo: e.target.value || null })}
                aria-label="Assigned employee"
                disabled={session?.role !== 'admin'}
              >
                <option value="">Unassigned</option>
                {db.staff.map((m) => (
                  <option key={m.id} value={m.id}>{m.fullName}{m.department ? ` · ${m.department}` : ''}</option>
                ))}
              </Select>
            </Field>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-display text-sm font-semibold text-heading">Document checklist</h4>
            <span className="text-xs font-semibold text-ink-soft">
              {done}/{app.checklist.length} complete
            </span>
          </div>
          <Progress value={(done / app.checklist.length) * 100} className="mb-3" />
          <ul className="space-y-1.5">
            {app.checklist.map((c, i) => (
              <li key={c.label}>
                <button
                  type="button"
                  onClick={() => actions.toggleChecklist(app.id, i)}
                  className={cn('flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition', c.done ? 'border-emerald-100 bg-emerald-50/60 text-heading' : 'border-line hover:border-brand-200')}
                >
                  {c.done ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500" /> : <Circle className="h-[18px] w-[18px] text-ink-mute" />}
                  <span className={cn('flex-1 font-medium', c.done && 'text-ink-soft line-through decoration-ink-mute/40')}>{c.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {docs.length > 0 && <p className="mt-2 text-xs text-ink-mute">{docs.length} document(s) on file for this student.</p>}
        </section>

        <section>
          <h4 className="mb-3 font-display text-sm font-semibold text-heading">Application timeline</h4>
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
    </Drawer>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-mute">{label}</div>
      <div className="mt-0.5 font-medium text-heading">{children}</div>
    </div>
  );
}
