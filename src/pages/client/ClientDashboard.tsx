import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, ChevronRight, ClipboardCheck, FilePlus2, FileStack, FileUp, Megaphone, PlaneTakeoff, Sparkles, UserPlus, Users } from 'lucide-react';
import { Avatar, Button, Card, CardHeader, Progress } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { StatusDonut } from '../../components/charts';
import { ActivityFeed } from '../../components/ActivityFeed';
import { StatusBadge, stageProgress, ApplicationDrawer } from '../../components/ApplicationDrawer';
import { categoryMeta, priorityTone } from '../../components/UpdateCard';
import { Badge } from '../../components/ui';
import { StudentForm } from '../../components/forms/StudentForm';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { DocumentUpload } from '../../components/forms/DocumentUpload';
import { useLookup, useScoped, useStore } from '../../store/store';
import { countryFlag, fullName, greeting, timeAgo, updateStatus } from '../../lib/utils';

export default function ClientDashboard() {
  const { session } = useStore();
  const scoped = useScoped();
  const lk = useLookup();
  const navigate = useNavigate();
  const [addStudent, setAddStudent] = useState(false);
  const [newApp, setNewApp] = useState(false);
  const [upload, setUpload] = useState(false);
  const [openApp, setOpenApp] = useState<string>();

  const apps = scoped.applications;
  const active = apps.filter((a) => !['Draft', 'Visa Granted', 'Visa Refused'].includes(a.status));
  const pendingAssess = scoped.assessments.filter((a) => a.status === 'Pending' || a.status === 'In Review').length + apps.filter((a) => a.status === 'Pending Assessment').length;
  const offers = apps.filter((a) => ['Conditional Offer', 'Unconditional Offer'].includes(a.status)).length;
  const visa = apps.filter((a) => a.status === 'Visa Lodged').length;
  const granted = apps.filter((a) => a.status === 'Visa Granted').length;
  const announcements = scoped.announcements.filter((a) => updateStatus(a) === 'Active').sort((a, b) => b.publishAt.localeCompare(a.publishAt));
  const recentApps = [...apps].sort((a, b) => b.timeline[b.timeline.length - 1].at.localeCompare(a.timeline[a.timeline.length - 1].at)).slice(0, 5);

  const stats = [
    { label: 'Total Students', value: scoped.students.length, icon: Users, to: 'students' },
    { label: 'Active Applications', value: active.length, icon: FileStack, to: 'applications' },
    { label: 'Pending Assessments', value: pendingAssess, icon: ClipboardCheck, to: 'assessments' },
    { label: 'Offers Received', value: offers, icon: Award, to: 'applications?status=Conditional%20Offer', tone: 'green' as const },
    { label: 'Visa Processing', value: visa, icon: PlaneTakeoff, to: 'applications?status=Visa%20Lodged', tone: 'navy' as const },
  ];

  const quick = [
    { label: 'Add Student', icon: UserPlus, onClick: () => setAddStudent(true) },
    { label: 'New Application', icon: FilePlus2, onClick: () => setNewApp(true) },
    { label: 'Find Courses', icon: Sparkles, onClick: () => navigate('/client/course-finder') },
    { label: 'Upload Document', icon: FileUp, onClick: () => setUpload(true) },
  ];

  return (
    <>
      <Card className="relative mb-6 overflow-hidden border-0 bg-gradient-to-br from-navy via-navy-700 to-navy-500 text-white">
        <div className="absolute -right-20 -top-24 h-72 w-72 rotate-45 rounded-[56px] bg-brand/20" />
        <div className="absolute -bottom-24 right-40 h-48 w-48 rotate-45 rounded-[40px] bg-rust/25" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-300">{scoped.partner?.name}</div>
            <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight">
              {greeting()}, {session?.name.split(' ')[0]} 👋
            </h1>
            <p className="mt-1.5 max-w-lg text-sm text-white/70">
              You have <b className="text-white">{active.length} active applications</b> and <b className="text-white">{granted} visas granted</b>. Here’s your workspace at a glance.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:w-[460px]">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={q.onClick}
                className="group flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-3 py-4 text-center text-xs font-semibold backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/20"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-[#06242F] transition group-hover:scale-110">
                  <q.icon className="h-5 w-5" />
                </span>
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {stats.map((s, i) => (
          <StatCard key={s.label} {...s} delay={i * 60} onClick={() => navigate(`/client/${s.to}`)} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Application Progress" subtitle="Latest movement across your applications" action={<button onClick={() => navigate('/client/applications')} className="text-xs font-semibold text-rust hover:underline">View all</button>} />
            <ul className="divide-y divide-line p-2">
              {recentApps.length === 0 && (
                <li className="px-4 py-10 text-center">
                  <p className="text-sm text-ink-mute">No applications yet.</p>
                  <Button className="mt-3" size="sm" icon={FilePlus2} onClick={() => setNewApp(true)}>Create first application</Button>
                </li>
              )}
              {recentApps.map((a) => {
                const s = lk.student.get(a.studentId);
                const u = lk.university.get(a.universityId);
                const last = a.timeline[a.timeline.length - 1];
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => setOpenApp(a.id)} className="flex w-full flex-col gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-canvas sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={fullName(s)} size={38} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-heading">{fullName(s)}</div>
                          <div className="truncate text-xs text-ink-mute">
                            {countryFlag[u?.country ?? '']} {u?.name} · {a.intake}
                          </div>
                        </div>
                      </div>
                      <div className="w-full sm:w-44">
                        <Progress value={stageProgress(a.status)} color={a.status === 'Visa Refused' ? 'bg-red-500' : undefined} />
                        <div className="mt-1 text-[11px] text-ink-mute">Updated {timeAgo(last.at)}</div>
                      </div>
                      <div className="sm:w-40 sm:text-right">
                        <StatusBadge status={a.status} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Applications by stage" />
              <div className="p-5">
                <StatusDonut apps={apps} onSelect={() => navigate('/client/applications')} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Recent Activities" />
              <ActivityFeed items={scoped.activities.slice(0, 6)} base="/client" />
            </Card>
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-rust" /> Important Announcements
              </span>
            }
            subtitle="From SSI GLOBAL"
            action={<button onClick={() => navigate('/client/updates')} className="text-xs font-semibold text-rust hover:underline">View all</button>}
          />
          <ul className="space-y-3 p-4">
            {announcements.length === 0 && <li className="py-8 text-center text-sm text-ink-mute">No active announcements.</li>}
            {announcements.slice(0, 4).map((a) => {
              const m = categoryMeta[a.category];
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => navigate('/client/updates')} className="group flex w-full gap-3 rounded-2xl border border-line p-3.5 text-left transition hover:border-brand-200 hover:shadow-card">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${m.bg}`}>
                      <m.icon className={`h-5 w-5 ${m.fg}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-heading group-hover:text-rust">{a.title}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-ink-soft">{a.body}</span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <Badge tone={priorityTone[a.priority]}>{a.priority}</Badge>
                        <span className="text-[11px] text-ink-mute">{timeAgo(a.publishAt)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl bg-brand-50 p-4">
            <Sparkles className="h-8 w-8 shrink-0 text-rust" />
            <div className="flex-1 text-xs text-ink-soft">
              <b className="block text-sm text-heading">Find the right course</b>
              Filter {scoped.courses.length}+ programmes by country, level and intake.
            </div>
            <button type="button" aria-label="Open course finder" onClick={() => navigate('/client/course-finder')} className="rounded-lg bg-surface p-2 text-rust shadow-sm hover:bg-brand-100">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </Card>
      </div>

      <StudentForm open={addStudent} onClose={() => setAddStudent(false)} onSaved={(id) => navigate(`/client/students/${id}`)} />
      <ApplicationForm open={newApp} onClose={() => setNewApp(false)} onSaved={(id) => setOpenApp(id)} />
      <DocumentUpload open={upload} onClose={() => setUpload(false)} />
      <ApplicationDrawer app={apps.find((a) => a.id === openApp)} onClose={() => setOpenApp(undefined)} />
    </>
  );
}
