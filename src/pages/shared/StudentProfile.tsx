import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarDays,
  FilePlus2,
  FileText,
  FileUp,
  Globe2,
  GraduationCap,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Trash2,
  User,
  Wallet,
} from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Progress, Tabs } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { StudentForm } from '../../components/forms/StudentForm';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { DocumentUpload } from '../../components/forms/DocumentUpload';
import { ApplicationDrawer, StatusBadge, stageProgress } from '../../components/ApplicationDrawer';
import { useLookup, useScoped, useStore } from '../../store/store';
import { countryFlag, fileSize, formatDate, fullName, timeAgo } from '../../lib/utils';
import { studentTone } from './Students';
import { docTone } from './Documents';

type Tab = 'overview' | 'applications' | 'documents';

export default function StudentProfile() {
  const { id } = useParams();
  const scoped = useScoped();
  const lk = useLookup();
  const { actions } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('overview');
  const [edit, setEdit] = useState(false);
  const [newApp, setNewApp] = useState(false);
  const [upload, setUpload] = useState(false);
  const [openApp, setOpenApp] = useState<string>();

  const s = scoped.students.find((x) => x.id === id);
  if (!s)
    return (
      <Card>
        <EmptyState
          icon={User}
          title="Student not found"
          description="This student may have been removed, or belongs to another workspace."
          action={<Button onClick={() => navigate(`${scoped.base}/students`)}>Back to students</Button>}
        />
      </Card>
    );

  const apps = scoped.applications.filter((a) => a.studentId === s.id);
  const docs = scoped.documents.filter((d) => d.studentId === s.id);
  const partner = lk.partner.get(s.partnerId);

  const remove = async () => {
    const ok = await confirm({ title: 'Delete student?', message: `${fullName(s)} and all related records will be permanently removed.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    actions.removeStudent(s.id);
    toast.success('Student deleted');
    navigate(`${scoped.base}/students`);
  };

  return (
    <>
      <Link to={`${scoped.base}/students`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-rust">
        <ArrowLeft className="h-4 w-4" /> All students
      </Link>

      <Card className="relative mb-6 overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-navy via-navy-600 to-navy-500">
          <div className="absolute right-10 top-[-60px] h-40 w-40 rotate-45 rounded-[32px] bg-brand/25" />
          <div className="absolute right-36 top-[-30px] h-28 w-28 rotate-45 rounded-[24px] bg-rust/30" />
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <Avatar name={fullName(s)} size={84} className="-mt-6 ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold text-heading">{fullName(s)}</h1>
              <Badge tone={studentTone[s.status]} dot>
                {s.status}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{s.email}</span>
              <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{s.phone}</span>
              {scoped.isAdmin && (
                <Link to={`/admin/partners/${s.partnerId}`} className="flex items-center gap-1.5 hover:text-rust">
                  <Building2 className="h-3.5 w-3.5" />
                  {partner?.name}
                </Link>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>
              Edit
            </Button>
            <Button variant="secondary" icon={FileUp} onClick={() => setUpload(true)}>
              Upload
            </Button>
            <Button icon={FilePlus2} onClick={() => setNewApp(true)}>
              New Application
            </Button>
          </div>
        </div>
      </Card>

      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'applications', label: 'Applications', count: apps.length },
          { value: 'documents', label: 'Documents', count: docs.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Personal details" />
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <Detail icon={CalendarDays} label="Date of birth" value={formatDate(s.dob)} />
              <Detail icon={User} label="Gender" value={s.gender} />
              <Detail icon={Globe2} label="Nationality" value={s.nationality} />
              <Detail icon={FileText} label="Passport no." value={s.passportNo || '—'} />
              <Detail icon={MapPin} label="Address" value={s.address || '—'} wide />
            </dl>
            <div className="border-t border-line" />
            <CardHeader title="Education" />
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <Detail icon={GraduationCap} label="Qualification" value={s.qualification || '—'} />
              <Detail icon={Building2} label="Institution" value={s.institution || '—'} />
              <Detail icon={BookOpen} label="GPA / Percentage" value={s.gpa || '—'} />
              <Detail icon={CalendarDays} label="Graduation year" value={s.graduationYear || '—'} />
              <Detail icon={Globe2} label="English proficiency" value={s.englishTest === 'Not taken' ? 'Not taken yet' : `${s.englishTest} · ${s.englishScore || 'score pending'}`} />
            </dl>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Destination preferences" />
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap gap-2">
                  {s.preferredCountries.length ? (
                    s.preferredCountries.map((c) => (
                      <span key={c} className="rounded-xl border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-heading">
                        {countryFlag[c]} {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-ink-mute">No preferences recorded</span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <Detail icon={GraduationCap} label="Level" value={s.preferredLevel} />
                  <Detail icon={CalendarDays} label="Intake" value={s.preferredIntake} />
                  <Detail icon={Wallet} label="Budget" value={s.budget} />
                  <Detail icon={CalendarDays} label="Added" value={formatDate(s.createdAt)} />
                </dl>
              </div>
            </Card>
            <Card>
              <CardHeader title="Applications" action={<button className="text-xs font-semibold text-rust hover:underline" onClick={() => setTab('applications')}>View all</button>} />
              <div className="space-y-3 p-5">
                {apps.length === 0 && <p className="text-sm text-ink-mute">No applications yet.</p>}
                {apps.slice(0, 3).map((a) => (
                  <button key={a.id} type="button" onClick={() => setOpenApp(a.id)} className="w-full rounded-xl border border-line p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-heading">{lk.university.get(a.universityId)?.name}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <Progress value={stageProgress(a.status)} className="mt-2.5" />
                  </button>
                ))}
              </div>
            </Card>
            <Button variant="ghost" icon={Trash2} className="w-full text-red-600 hover:bg-red-50 hover:text-red-700" onClick={remove}>
              Delete student
            </Button>
          </div>
        </div>
      )}

      {tab === 'applications' && (
        <Card>
          {apps.length === 0 ? (
            <EmptyState icon={FilePlus2} title="No applications yet" description="Create the first application for this student." action={<Button icon={FilePlus2} onClick={() => setNewApp(true)}>New Application</Button>} />
          ) : (
            <div className="divide-y divide-line">
              {apps.map((a) => {
                const uni = lk.university.get(a.universityId);
                return (
                  <button key={a.id} type="button" onClick={() => setOpenApp(a.id)} className="flex w-full flex-col gap-3 p-5 text-left transition hover:bg-brand-50/30 sm:flex-row sm:items-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canvas text-xl">{countryFlag[uni?.country ?? '']}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-heading">{lk.course.get(a.courseId)?.name}</span>
                      <span className="block text-sm text-ink-soft">
                        {uni?.name} · {a.intake} · {a.ref}
                      </span>
                    </span>
                    <span className="w-full sm:w-48">
                      <Progress value={stageProgress(a.status)} />
                    </span>
                    <StatusBadge status={a.status} />
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <Card>
          {docs.length === 0 ? (
            <EmptyState icon={FileText} title="No documents uploaded" description="Upload passports, transcripts and test results." action={<Button icon={FileUp} onClick={() => setUpload(true)}>Upload documents</Button>} />
          ) : (
            <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
              {docs.map((d) => (
                <div key={d.id} className="flex items-start gap-3 rounded-2xl border border-line p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-rust">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-heading">{d.type}</div>
                    <div className="truncate text-xs text-ink-mute">
                      {d.fileName} · {fileSize(d.size)}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <Badge tone={docTone[d.status]} dot>
                        {d.status}
                      </Badge>
                      <span className="text-[11px] text-ink-mute">{timeAgo(d.uploadedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <StudentForm open={edit} onClose={() => setEdit(false)} student={s} />
      <ApplicationForm open={newApp} onClose={() => setNewApp(false)} studentId={s.id} onSaved={(aid) => { setTab('applications'); setOpenApp(aid); }} />
      <DocumentUpload open={upload} onClose={() => { setUpload(false); }} studentId={s.id} />
      <ApplicationDrawer app={scoped.applications.find((a) => a.id === openApp)} onClose={() => setOpenApp(undefined)} />
    </>
  );
}

function Detail({ icon: Icon, label, value, wide }: { icon: typeof User; label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-mute">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-heading">{value}</dd>
    </div>
  );
}
