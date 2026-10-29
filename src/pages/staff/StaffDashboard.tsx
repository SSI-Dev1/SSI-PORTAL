// Staff Portal home: the employee's own work (assigned applications and tasks) plus the
// queues their permissions cover. Every number comes from live, RLS-filtered data.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, FileCheck2, FileStack, ListTodo, UserCheck } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { ActivityFeed } from '../../components/ActivityFeed';
import { useLookup, useStore } from '../../store/store';
import { appStatusTone, cn, daysUntil, formatDate, greeting } from '../../lib/utils';

const CLOSED = ['Visa Granted', 'Visa Refused', 'Withdrawn', 'Rejected'];

export default function StaffDashboard() {
  const { db, session } = useStore();
  const lk = useLookup();
  const navigate = useNavigate();
  const me = session?.userId;
  const perms = session?.permissions ?? [];

  const myApps = useMemo(() => db.applications.filter((a) => a.assignedTo === me && !CLOSED.includes(a.status)), [db.applications, me]);
  const myTasks = useMemo(
    () => db.tasks.filter((t) => !t.done && (t.assignedTo === me || (!t.assignedTo && perms.includes('tasks')))).sort((a, b) => a.due.localeCompare(b.due)),
    [db.tasks, me, perms],
  );
  const docsPending = db.documents.filter((d) => d.status === 'Pending').length;
  const assessPending = db.assessments.filter((a) => a.status === 'Pending' || a.status === 'In Review').length;
  const statusUpdates = db.activities.filter((a) => a.kind === 'status' || a.kind === 'document' || a.kind === 'assessment').slice(0, 8);

  const cards = [
    { label: 'Assigned to me', value: myApps.length, icon: UserCheck, to: 'applications', tone: 'orange' as const, show: true },
    { label: 'My open tasks', value: myTasks.length, icon: ListTodo, to: 'tasks', tone: 'navy' as const, show: true },
    { label: 'Documents to verify', value: docsPending, icon: FileCheck2, to: 'documents', tone: 'orange' as const, show: perms.includes('documents') },
    { label: 'Assessments pending', value: assessPending, icon: ClipboardCheck, to: 'assessments', tone: 'navy' as const, show: perms.includes('assessments') },
    { label: 'Active applications', value: db.applications.filter((a) => !CLOSED.includes(a.status)).length, icon: FileStack, to: 'applications', tone: 'green' as const, show: perms.includes('applications') },
  ].filter((c) => c.show);

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-heading">
          {greeting()}, {session?.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{session?.title} · your work and queues, updated live.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {cards.map((c, i) => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} delay={i * 40} onClick={() => navigate(`/staff/${c.to}`)} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Applications assigned to me" subtitle="Open applications you are responsible for" />
          {myApps.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing assigned right now" description="Applications assigned to you by an administrator appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {myApps.slice(0, 8).map((a) => {
                const s = lk.student.get(a.studentId);
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => navigate(`/staff/applications?open=${a.id}`)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-canvas">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-heading">{s ? `${s.firstName} ${s.lastName}` : a.ref}</span>
                        <span className="block truncate text-xs text-ink-mute">
                          {a.ref} · {lk.university.get(a.universityId)?.name} · {lk.partner.get(a.partnerId)?.name}
                        </span>
                      </span>
                      <Badge tone={appStatusTone[a.status]}>{a.status}</Badge>
                      <ChevronRight className="h-4 w-4 text-ink-mute" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="My tasks & reminders" />
          {myTasks.length === 0 ? (
            <EmptyState icon={ListTodo} title="No open tasks" />
          ) : (
            <ul className="divide-y divide-line">
              {myTasks.slice(0, 7).map((t) => {
                const d = daysUntil(t.due);
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => navigate('/staff/tasks')} className="flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-canvas">
                      <CalendarClock className={cn('mt-0.5 h-4 w-4 shrink-0', d < 0 ? 'text-red-500' : d <= 1 ? 'text-amber-500' : 'text-ink-mute')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-heading">{t.title}</span>
                        <span className={cn('text-xs', d < 0 ? 'font-semibold text-red-600' : 'text-ink-mute')}>
                          {d < 0 ? `Overdue · ${formatDate(t.due)}` : `Due ${formatDate(t.due)}`}
                        </span>
                      </span>
                      <Badge tone={t.priority === 'High' ? 'red' : t.priority === 'Medium' ? 'amber' : 'slate'}>{t.priority}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title="Application updates" subtitle="Latest status, document and assessment changes you can see" />
          <ActivityFeed items={statusUpdates} base="/staff" />
        </Card>
      </div>
    </>
  );
}
