import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Award,
  BadgeCheck,
  Building2,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  FilePlus2,
  FileStack,
  Megaphone,
  PlaneTakeoff,
  Receipt,
  ShieldX,
  UserPlus,
  Users,
  BellRing,
  ListTodo,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, FilterSelect, Segmented } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { StatusDonut, TopCountries, TrendChart, monthlyTrend } from '../../components/charts';
import { ActivityFeed } from '../../components/ActivityFeed';
import { useLookup, useStore } from '../../store/store';
import { cn, daysUntil, formatDate, greeting, money } from '../../lib/utils';

export default function AdminDashboard() {
  const { db, session } = useStore();
  const lk = useLookup();
  const navigate = useNavigate();
  const [partner, setPartner] = useState('');
  const [range, setRange] = useState<'3' | '6' | '12'>('6');

  const apps = useMemo(() => db.applications.filter((a) => !partner || a.partnerId === partner), [db.applications, partner]);
  const students = db.students.filter((s) => !partner || s.partnerId === partner);
  const assessments = db.assessments.filter((a) => !partner || a.partnerId === partner);
  const count = (...st: string[]) => apps.filter((a) => st.includes(a.status)).length;
  const trend = monthlyTrend(apps, 6);
  const spark = trend.map((t) => t.Applications);

  const stats = [
    { label: 'Total Clients', value: partner ? 1 : db.partners.length, icon: Building2, to: '/admin/partners', tone: 'navy' as const, delta: 4.2 },
    { label: 'Total Students', value: students.length, icon: Users, to: '/admin/students', delta: 12.5, spark: [4, 6, 5, 8, 7, 9] },
    { label: 'Total Applications', value: apps.length, icon: FileStack, to: '/admin/applications', delta: 8.3, spark },
    { label: 'Pending Assessments', value: assessments.filter((a) => a.status === 'Pending' || a.status === 'In Review').length + count('Pending Assessment'), icon: ClipboardCheck, to: '/admin/assessments', delta: 5.6 },
    { label: 'Offers Received', value: count('Conditional Offer', 'Unconditional Offer'), icon: Award, to: '/admin/applications?status=Conditional%20Offer', delta: 7.6, spark: trend.map((t) => t.Offers) },
    { label: 'Visa Lodged', value: count('Visa Lodged'), icon: PlaneTakeoff, to: '/admin/applications?status=Visa%20Lodged', tone: 'navy' as const, delta: 6.7 },
    { label: 'Visa Granted', value: count('Visa Granted'), icon: BadgeCheck, to: '/admin/applications?status=Visa%20Granted', tone: 'green' as const, delta: 8.9, spark: trend.map((t) => t.Visas) },
    { label: 'Visa Refused', value: count('Visa Refused'), icon: ShieldX, to: '/admin/applications?status=Visa%20Refused', tone: 'red' as const, delta: -1.1 },
  ];

  const deadlines = [
    ...db.tasks.filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, sub: t.assignee, due: t.due, kind: 'Task', to: '/admin/tasks' })),
    ...db.payments
      .filter((p) => p.status !== 'Paid' && (!partner || p.partnerId === partner))
      .map((p) => ({ id: p.id, title: `${p.invoiceNo} · ${money(p.amount - p.paid)}`, sub: lk.partner.get(p.partnerId)?.name ?? '', due: p.dueDate, kind: 'Payment', to: '/admin/finance' })),
  ]
    .filter((d) => daysUntil(d.due) >= -3)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 6);

  const quick = [
    { label: 'Add New Partner', icon: Building2, to: '/admin/partners?new=1' },
    { label: 'Add New Student', icon: UserPlus, to: '/admin/students?new=1' },
    { label: 'New Application', icon: FilePlus2, to: '/admin/applications?new=1' },
    { label: 'Publish Update', icon: Megaphone, to: '/admin/updates?new=1' },
    { label: 'Add Reminder', icon: BellRing, to: '/admin/tasks?new=1' },
  ];

  const activities = db.activities.filter((a) => !partner || a.partnerId === partner);

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-heading">
            {greeting()}, {session?.name.split(' ')[0]} <span className="inline-block origin-[70%_70%] animate-[float_3s_ease-in-out_infinite]">👋</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">Here’s what’s happening across your partner network today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <FilterSelect label="All partners" value={partner} onChange={setPartner} options={db.partners.map((p) => ({ value: p.id, label: p.name }))} />
          <div className="hidden h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-heading sm:flex">
            <CalendarClock className="h-4 w-4 text-ink-mute" />
            {formatDate(new Date().toISOString())}
          </div>
          <Button icon={FilePlus2} onClick={() => navigate('/admin/applications?new=1')}>
            New Application
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s, i) => (
              <StatCard key={s.label} {...s} delay={i * 50} onClick={() => navigate(s.to)} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader title="Application Overview" subtitle="Click a segment to drill in" />
              <div className="p-5">
                <StatusDonut
                  apps={apps}
                  onSelect={(g) => {
                    const map: Record<string, string> = {
                      'In Progress': 'Submitted',
                      'Offers Pending': 'Offer Pending',
                      'Offers Received': 'Conditional Offer',
                    };
                    navigate(`/admin/applications?status=${encodeURIComponent(map[g] ?? g)}`);
                  }}
                />
              </div>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader
                title="Application Trend"
                subtitle="Applications, offers and visas granted"
                action={
                  <Segmented
                    value={range}
                    onChange={setRange}
                    options={[
                      { value: '3', label: '3M' },
                      { value: '6', label: '6M' },
                      { value: '12', label: '12M' },
                    ]}
                  />
                }
              />
              <div className="flex gap-4 px-5 pt-3 text-xs font-medium text-ink-soft">
                <Legend color="#E58A0E" label="Applications" />
                <Legend color="rgb(var(--heading))" label="Offers" />
                <Legend color="#16A34A" label="Visas granted" dashed />
              </div>
              <div className="p-3 pt-1">
                <TrendChart key={range + partner} apps={apps} months={Number(range)} height={240} />
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top Destination Countries" subtitle="By number of applications" />
              <div className="p-5">
                <TopCountries apps={apps} universities={db.universities} onSelect={() => navigate('/admin/applications')} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Upcoming Deadlines" action={<button onClick={() => navigate('/admin/tasks')} className="text-xs font-semibold text-rust hover:underline">View all</button>} />
              <ul className="space-y-1 p-3">
                {deadlines.map((d) => {
                  const days = daysUntil(d.due);
                  const date = new Date(d.due);
                  return (
                    <li key={d.id}>
                      <button type="button" onClick={() => navigate(d.to)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-canvas">
                        <span className={cn('flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-center leading-none', days <= 1 ? 'bg-rust text-white' : 'bg-brand-50 text-rust')}>
                          <span className="text-sm font-bold">{date.getDate()}</span>
                          <span className="text-[9px] font-semibold uppercase">{date.toLocaleString('en-GB', { month: 'short' })}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-heading">{d.title}</span>
                          <span className="block truncate text-xs text-ink-mute">{d.sub}</span>
                        </span>
                        <Badge tone={days < 0 ? 'red' : days <= 1 ? 'orange' : 'slate'}>{days < 0 ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}</Badge>
                      </button>
                    </li>
                  );
                })}
                {deadlines.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-mute">No upcoming deadlines 🎉</li>}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHeader title="Partner Performance" subtitle="Applications and conversion per consultancy partner" action={<button onClick={() => navigate('/admin/partners')} className="text-xs font-semibold text-rust hover:underline">Manage partners</button>} />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {db.partners.map((p) => {
                const pa = db.applications.filter((a) => a.partnerId === p.id);
                const granted = pa.filter((a) => a.status === 'Visa Granted').length;
                const offers = pa.filter((a) => ['Conditional Offer', 'Unconditional Offer', 'Visa Lodged', 'Visa Granted'].includes(a.status)).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/admin/partners/${p.id}`)}
                    className={cn('rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-card', partner === p.id ? 'border-rust bg-brand-50/40' : 'border-line')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-heading">{p.name}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Mini label="Apps" value={pa.length} />
                      <Mini label="Offers" value={offers} />
                      <Mini label="Visas" value={granted} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Quick Actions" />
            <ul className="p-3">
              {quick.map((q) => (
                <li key={q.label}>
                  <button type="button" onClick={() => navigate(q.to)} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-heading transition hover:bg-brand-50/60">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-canvas text-ink-soft transition group-hover:bg-surface group-hover:text-rust">
                      <q.icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1">{q.label}</span>
                    <ChevronRight className="h-4 w-4 text-ink-mute transition group-hover:translate-x-0.5 group-hover:text-rust" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Recent Activities" subtitle="Live across all workspaces" />
            <ActivityFeed items={activities.slice(0, 8)} base="/admin" />
          </Card>
          <Card className="overflow-hidden">
            <div className="relative bg-gradient-to-br from-navy to-navy-600 p-5 text-white">
              <div className="absolute -right-6 -top-6 h-24 w-24 rotate-45 rounded-2xl bg-brand/20" />
              <ListTodo className="mb-3 h-6 w-6 text-brand" />
              <div className="font-display text-lg font-semibold">{db.tasks.filter((t) => !t.done).length} open tasks</div>
              <p className="mt-1 text-sm text-white/70">{db.tasks.filter((t) => !t.done && t.priority === 'High').length} high priority need attention today.</p>
              <Button variant="primary" size="sm" className="mt-4" onClick={() => navigate('/admin/tasks')}>
                Open tasks
              </Button>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-rust">
                <Receipt className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs text-ink-soft">Outstanding receivables</div>
                <div className="font-display text-lg font-semibold text-heading">
                  {money(db.payments.filter((p) => !partner || p.partnerId === partner).reduce((s, p) => s + p.amount - p.paid, 0))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0.5 w-4 rounded" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }} />
      {label}
    </span>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-canvas py-1.5">
      <div className="font-display text-base font-semibold text-heading">{value}</div>
      <div className="text-[10.5px] font-medium text-ink-mute">{label}</div>
    </div>
  );
}
