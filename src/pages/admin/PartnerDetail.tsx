import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarDays, ExternalLink, Globe, LogIn, Mail, MapPin, Pencil, Percent, Phone, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Progress, Table, Tabs } from '../../components/ui';
import { StatusDonut, TrendChart } from '../../components/charts';
import { ApplicationDrawer, StatusBadge, stageProgress } from '../../components/ApplicationDrawer';
import { ActivityFeed } from '../../components/ActivityFeed';
import { useToast } from '../../components/feedback';
import { useLookup, useStore } from '../../store/store';
import { partnerPreviewSession } from '../../data/demo';
import { avatarColor, countryFlag, formatDate, fullName, initials, money } from '../../lib/utils';
import { PartnerForm, partnerStatusTone, tierTone } from './Partners';
import { studentTone } from '../shared/Students';

type Tab = 'overview' | 'students' | 'applications' | 'finance';

export default function PartnerDetail() {
  const { id } = useParams();
  const { db, session, actions } = useStore();
  const lk = useLookup();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [edit, setEdit] = useState(false);
  const [openApp, setOpenApp] = useState<string>();

  const p = db.partners.find((x) => x.id === id);
  if (!p)
    return (
      <Card>
        <EmptyState icon={Building2} title="Partner not found" action={<Button onClick={() => navigate('/admin/partners')}>Back to partners</Button>} />
      </Card>
    );

  const students = db.students.filter((s) => s.partnerId === p.id);
  const apps = db.applications.filter((a) => a.partnerId === p.id);
  const payments = db.payments.filter((x) => x.partnerId === p.id);
  const docs = db.documents.filter((d) => d.partnerId === p.id);
  const offers = apps.filter((a) => ['Conditional Offer', 'Unconditional Offer'].includes(a.status)).length;
  const visas = apps.filter((a) => a.status === 'Visa Granted').length;
  const outstanding = payments.reduce((s, x) => s + x.amount - x.paid, 0);

  const viewAs = () => {
    actions.login(partnerPreviewSession(p, session!), false);
    toast.info(`Previewing ${p.name}`, 'Use “Exit preview” to return to the Admin Portal.');
    navigate('/client/dashboard');
  };

  return (
    <>
      <Link to="/admin/partners" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-rust">
        <ArrowLeft className="h-4 w-4" /> All partners
      </Link>

      <Card className="relative mb-6 overflow-hidden">
        <div className="relative bg-gradient-to-br from-navy via-navy-700 to-navy-500 px-6 pb-16 pt-6 text-white">
          <div className="absolute -right-16 -top-20 h-64 w-64 rotate-45 rounded-[48px] bg-brand/15" />
          <div className="absolute right-40 top-10 h-24 w-24 rotate-45 rounded-3xl bg-rust/25" />
          <div className="relative flex flex-wrap items-center gap-2">
            <Badge tone={partnerStatusTone[p.status]} dot>{p.status}</Badge>
            <Badge tone={tierTone[p.tier]}>{p.tier} Partner</Badge>
            <span className="text-xs text-white/60">Code {p.code}</span>
          </div>
        </div>
        <div className="relative -mt-8 flex flex-col gap-5 px-6 pb-6 lg:flex-row lg:items-end">
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl font-display text-3xl font-semibold text-white shadow-lift ring-4 ring-surface" style={{ background: avatarColor(p.name) }}>
            {initials(p.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold text-heading">{p.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{p.contactName}</span>
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{p.email}</span>
              <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{p.phone}</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{p.city}, {countryFlag[p.country]} {p.country}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>
            <Button variant="navy" icon={LogIn} onClick={viewAs}>Preview portal</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Students', students.length],
            ['Applications', apps.length],
            ['Offers', offers],
            ['Visas granted', visas],
            ['Documents', docs.length],
            ['Outstanding', money(outstanding)],
          ].map(([l, v]) => (
            <div key={l as string} className="border-b border-r border-line px-5 py-4 last:border-r-0 lg:border-b-0">
              <div className="text-xs font-medium text-ink-mute">{l}</div>
              <div className="font-display text-xl font-semibold text-heading">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'students', label: 'Students', count: students.length },
          { value: 'applications', label: 'Applications', count: apps.length },
          { value: 'finance', label: 'Finance', count: payments.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Application trend" subtitle="Last 6 months" />
            <div className="p-3">
              <TrendChart apps={apps} months={6} height={240} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Workspace details" />
            <dl className="space-y-3.5 p-5 text-sm">
              <Row icon={CalendarDays} label="Partner since" value={formatDate(p.joinedAt)} />
              <Row icon={Building2} label="Branches" value={p.branches.join(', ')} />
              <Row icon={Percent} label="Commission rate" value={`${p.commissionRate}%`} />
              <Row icon={Globe} label="Website" value={p.website ? <a className="inline-flex items-center gap-1 text-rust hover:underline" href={`https://${p.website}`} target="_blank" rel="noreferrer">{p.website}<ExternalLink className="h-3 w-3" /></a> : '—'} />
            </dl>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Application overview" />
            <div className="p-5">
              <StatusDonut apps={apps} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent activity" />
            <ActivityFeed items={db.activities.filter((a) => a.partnerId === p.id).slice(0, 6)} base="/admin" />
          </Card>
        </div>
      )}

      {tab === 'students' && (
        <Card>
          {students.length === 0 ? (
            <EmptyState icon={Users} title="No students yet" description="This partner hasn’t added any students." />
          ) : (
            <Table head={['Student', 'Destinations', 'Level', 'Applications', 'Status', 'Added']}>
              {students.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-brand-50/30" onClick={() => navigate(`/admin/students/${s.id}`)}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={fullName(s)} size={32} />
                      <div>
                        <div className="font-semibold text-heading">{fullName(s)}</div>
                        <div className="text-xs text-ink-mute">{s.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-ink-soft">{s.preferredCountries.map((c) => countryFlag[c]).join(' ')}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{s.preferredLevel}</td>
                  <td className="px-5 py-3.5 font-semibold text-heading">{apps.filter((a) => a.studentId === s.id).length}</td>
                  <td className="px-5 py-3.5"><Badge tone={studentTone[s.status]} dot>{s.status}</Badge></td>
                  <td className="px-5 py-3.5 text-ink-soft">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'applications' && (
        <Card>
          {apps.length === 0 ? (
            <EmptyState icon={Users} title="No applications yet" />
          ) : (
            <Table head={['Student', 'University', 'Intake', 'Progress', 'Status']}>
              {apps.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-brand-50/30" onClick={() => setOpenApp(a.id)}>
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-heading">{fullName(lk.student.get(a.studentId))}</div>
                    <div className="text-xs text-ink-mute">{a.ref}</div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="text-heading">{lk.university.get(a.universityId)?.name}</div>
                    <div className="text-xs text-ink-mute">{lk.course.get(a.courseId)?.name}</div>
                  </td>
                  <td className="px-5 py-3.5 text-ink-soft">{a.intake}</td>
                  <td className="w-32 px-5 py-3.5"><Progress value={stageProgress(a.status)} /></td>
                  <td className="px-5 py-3.5"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'finance' && (
        <Card>
          <Table head={['Invoice', 'Description', 'Amount', 'Paid', 'Due', 'Status']}>
            {payments.map((x) => (
              <tr key={x.id}>
                <td className="px-5 py-3.5 font-semibold text-heading">{x.invoiceNo}</td>
                <td className="px-5 py-3.5 text-ink-soft">{x.description}</td>
                <td className="px-5 py-3.5 font-semibold text-heading">{money(x.amount)}</td>
                <td className="px-5 py-3.5 text-ink-soft">{money(x.paid)}</td>
                <td className="px-5 py-3.5 text-ink-soft">{formatDate(x.dueDate)}</td>
                <td className="px-5 py-3.5"><Badge tone={x.status === 'Paid' ? 'green' : x.status === 'Overdue' ? 'red' : x.status === 'Partially Paid' ? 'blue' : 'amber'} dot>{x.status}</Badge></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <PartnerForm open={edit} onClose={() => setEdit(false)} partner={p} />
      <ApplicationDrawer app={apps.find((a) => a.id === openApp)} onClose={() => setOpenApp(undefined)} />
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-ink-mute" />
      <div>
        <dt className="text-xs text-ink-mute">{label}</dt>
        <dd className="font-medium text-heading">{value}</dd>
      </div>
    </div>
  );
}
