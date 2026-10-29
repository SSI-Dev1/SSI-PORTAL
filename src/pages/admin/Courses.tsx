// Course catalogue management (Admin / staff with the "catalogue" permission): courses,
// fees, requirements, active state and intakes. Changes save to the database and reach the
// Partner and Staff portals via Realtime.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarDays, Eye, FileSpreadsheet, MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, Pagination, SearchInput, Select, Switch, Table, Tabs, usePaged } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { useLookup, useStore } from '../../store/store';
import { CatalogueImportDialog, CourseDetails, IntakeManager, intakeLabel, intakeTone } from '../../components/catalogue';
import type { Course, StudyLevel } from '../../data/types';
import { countryFlag, matches, money } from '../../lib/utils';

const LEVELS: StudyLevel[] = ['Foundation', 'Diploma', 'Undergraduate', 'Postgraduate', 'PhD'];

export default function Courses() {
  const { db, actions, session } = useStore();
  const lk = useLookup();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const canManage = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('catalogue');
  const [q, setQ] = useState('');
  const [uni, setUni] = useState(params.get('university') ?? '');
  const [level, setLevel] = useState('');
  const [field, setField] = useState('');
  const [intake, setIntake] = useState('');
  const [state, setState] = useState('');
  const [editing, setEditing] = useState<Course | null>(null);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);

  const fields = [...new Set(db.courses.map((c) => c.field).filter(Boolean))].sort();
  const intakeOptions = [...new Set(db.courseIntakes.filter((i) => i.active).sort((a, b) => a.intakeYear - b.intakeYear || a.intakeMonth - b.intakeMonth).map(intakeLabel))];
  const rows = useMemo(
    () =>
      db.courses
        .filter((c) => matches(q, c.name, c.field, c.faculty ?? '', lk.university.get(c.universityId)?.name))
        .filter((c) => !uni || c.universityId === uni)
        .filter((c) => !level || c.level === level)
        .filter((c) => !field || c.field === field)
        .filter((c) => !intake || db.courseIntakes.some((i) => i.courseId === c.id && i.active && intakeLabel(i) === intake))
        .filter((c) => !state || (state === 'active' ? c.active !== false : c.active === false))
        .sort((a, b) => (lk.university.get(a.universityId)?.name ?? '').localeCompare(lk.university.get(b.universityId)?.name ?? '') || a.name.localeCompare(b.name)),
    [db.courses, db.courseIntakes, q, uni, level, field, intake, state, lk],
  );
  const paged = usePaged(rows, 12, `${q}${uni}${level}${field}${intake}${state}`);
  const viewed = db.courses.find((c) => c.id === viewing);

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={`${db.courses.filter((c) => c.active !== false).length} active programmes across ${db.universities.length} providers. Intakes and fees are edited here — no code changes needed.`}
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImportOpen(true)}>Import from Excel</Button>
              <Button icon={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Add Course</Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search course, faculty or provider…" className="lg:w-80" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            <FilterSelect label="All providers" value={uni} onChange={setUni} options={db.universities.map((u) => ({ value: u.id, label: u.name }))} />
            <FilterSelect label="All levels" value={level} onChange={setLevel} options={LEVELS} />
            <FilterSelect label="All categories" value={field} onChange={setField} options={fields} />
            <FilterSelect label="Any intake" value={intake} onChange={setIntake} options={intakeOptions} />
            <FilterSelect label="Active & inactive" value={state} onChange={setState} options={[{ value: 'active', label: 'Active only' }, { value: 'inactive', label: 'Inactive only' }]} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={BookOpen} title="No courses found" description={canManage ? 'Add a course or import the course catalogue from Excel.' : undefined} />
        ) : (
          <>
            <Table head={['Course', 'Provider', 'Level', 'Tuition / yr', 'Intakes', 'Status', '']}>
              {paged.rows.map((c) => {
                const u = lk.university.get(c.universityId);
                const its = db.courseIntakes.filter((i) => i.courseId === c.id && i.active).sort((a, b) => a.intakeYear - b.intakeYear || a.intakeMonth - b.intakeMonth);
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-brand-50/30" onClick={() => setViewing(c.id)}>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-heading">{c.name}</div>
                      <div className="text-xs text-ink-mute">{[c.field || c.faculty, c.duration].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-5 py-3.5 text-ink-soft">{countryFlag[u?.country ?? '']} {u?.name}</td>
                    <td className="px-5 py-3.5"><Badge tone={c.level === 'Postgraduate' ? 'navy' : c.level === 'Undergraduate' ? 'orange' : 'slate'}>{c.level}</Badge></td>
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <div className="font-semibold text-heading">{money(c.tuition, c.currency)}</div>
                      {c.scholarship && <div className="max-w-[160px] truncate text-[11px] text-emerald-600 dark:text-emerald-400">{c.scholarship}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {its.length === 0 ? <span className="text-xs text-ink-mute">None</span> : its.map((i) => <Badge key={i.id} tone={intakeTone[i.status]}>{intakeLabel(i)}</Badge>)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5"><Badge tone={c.active === false ? 'slate' : 'green'} dot>{c.active === false ? 'Inactive' : 'Active'}</Badge></td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <Menu
                        width="w-52"
                        trigger={() => (
                          <button type="button" aria-label={`Actions for ${c.name}`} className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-heading"><MoreHorizontal className="h-4 w-4" /></button>
                        )}
                        items={[
                          { label: 'View details', icon: Eye, onClick: () => setViewing(c.id) },
                          ...(canManage
                            ? [
                                { label: 'Edit course & intakes', icon: Pencil, onClick: () => { setEditing(c); setOpen(true); } },
                                { label: c.active === false ? 'Activate' : 'Deactivate', icon: Power, onClick: () => { actions.updateCourse(c.id, { active: c.active === false }); toast.success(c.active === false ? 'Course activated' : 'Course deactivated', c.name); } },
                                {
                                  label: 'Delete',
                                  icon: Trash2,
                                  danger: true,
                                  onClick: async () => {
                                    if (db.applications.some((a) => a.courseId === c.id)) return toast.error('Course has applications', 'Deactivate it instead so existing applications keep their course.');
                                    if (await confirm({ title: 'Delete course?', message: `${c.name} and its intakes will be removed. Deactivating keeps it on record.`, danger: true, confirmLabel: 'Delete' })) {
                                      actions.removeCourse(c.id);
                                      toast.success('Course deleted');
                                    }
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="courses" />
          </>
        )}
      </Card>
      <CourseDetails
        course={viewed}
        onClose={() => setViewing(undefined)}
        showInactive
        actions={canManage && viewed ? <Button icon={Pencil} onClick={() => { setEditing(viewed); setViewing(undefined); setOpen(true); }}>Edit course & intakes</Button> : undefined}
      />
      {canManage && <CourseForm open={open} onClose={() => setOpen(false)} course={editing} />}
      {canManage && <CatalogueImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
    </>
  );
}

type CourseDraft = {
  universityId: string; name: string; level: StudyLevel; field: string; faculty: string; duration: string; tuition: number; currency: string; ieltsMin: number;
  scholarship: string; tuitionAfterScholarship: string; earlyBird: string; accommodation: string; academicRequirement: string; englishRequirement: string;
  complianceRequirement: string; courseRequirement: string; documentsRequired: string; active: boolean;
};

function CourseForm({ open, onClose, course }: { open: boolean; onClose: () => void; course: Course | null }) {
  const { db, actions } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<'details' | 'requirements' | 'intakes'>('details');
  const live = course ? db.courses.find((c) => c.id === course.id) ?? course : null;
  const init = (): CourseDraft => ({
    universityId: live?.universityId ?? db.universities[0]?.id ?? '', name: live?.name ?? '', level: (live?.level as StudyLevel) ?? 'Postgraduate',
    field: live?.field ?? '', faculty: live?.faculty ?? '', duration: live?.duration ?? '', tuition: live?.tuition ?? 0, currency: live?.currency ?? 'GBP',
    ieltsMin: live?.ieltsMin ?? 0, scholarship: live?.scholarship ?? '', tuitionAfterScholarship: live?.tuitionAfterScholarship != null ? String(live.tuitionAfterScholarship) : '',
    earlyBird: live?.earlyBird ?? '', accommodation: live?.accommodation ?? '', academicRequirement: live?.academicRequirement ?? '', englishRequirement: live?.englishRequirement ?? '',
    complianceRequirement: live?.complianceRequirement ?? '', courseRequirement: live?.courseRequirement ?? '', documentsRequired: live?.documentsRequired ?? '', active: live?.active !== false,
  });
  const [d, setD] = useState<CourseDraft>(init);
  useEffect(() => {
    if (open) {
      setD(init());
      setTab('details');
    }
  }, [open, course?.id]);
  const set = <K extends keyof CourseDraft>(k: K, v: CourseDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const txt = (k: keyof CourseDraft) => (e: { target: { value: string } }) => set(k, e.target.value as never);

  const save = () => {
    if (d.name.trim().length < 3 || !d.universityId) return toast.error('Course name and provider are required');
    if (!(d.tuition > 0)) return toast.error('Enter the tuition fee');
    const opt = (v: string) => v.trim() || null;
    const patch: Partial<Course> = {
      universityId: d.universityId, name: d.name.trim(), level: d.level, field: d.field.trim(), faculty: opt(d.faculty), duration: d.duration.trim(),
      tuition: Number(d.tuition), currency: d.currency.trim().toUpperCase() || 'GBP', ieltsMin: Number(d.ieltsMin) || 0, scholarship: opt(d.scholarship),
      tuitionAfterScholarship: d.tuitionAfterScholarship ? Number(d.tuitionAfterScholarship) : null, earlyBird: opt(d.earlyBird), accommodation: opt(d.accommodation),
      academicRequirement: opt(d.academicRequirement), englishRequirement: opt(d.englishRequirement), complianceRequirement: opt(d.complianceRequirement),
      courseRequirement: opt(d.courseRequirement), documentsRequired: opt(d.documentsRequired), active: d.active,
    };
    if (live) {
      actions.updateCourse(live.id, patch);
      toast.success('Course saved', `${patch.name} · visible to partners and staff instantly.`);
      onClose();
    } else {
      actions.addCourse({ ...(patch as Omit<Course, 'id'>), intakes: [] });
      toast.success('Course added', 'Open it again to add intakes.');
      onClose();
    }
  };
  const area = (k: keyof CourseDraft, label: string, rows = 3) => (
    <Field label={label} className="sm:col-span-2">
      <textarea value={String(d[k] ?? '')} onChange={txt(k)} rows={rows} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-heading focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={live ? live.name : 'Add course'}
      subtitle={live ? 'Changes are saved to the database and synced to all portals.' : 'Create the course, then add its intakes.'}
      footer={tab === 'intakes' ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{live ? 'Save course' : 'Add course'}</Button></>}
    >
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'details', label: 'Details & fees' },
          { value: 'requirements', label: 'Requirements' },
          ...(live ? [{ value: 'intakes' as const, label: 'Intakes', count: db.courseIntakes.filter((i) => i.courseId === live.id).length }] : []),
        ]}
      />
      {tab === 'details' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course name" required className="sm:col-span-2"><Input value={d.name} onChange={txt('name')} autoFocus /></Field>
          <Field label="Provider" required>
            <Select value={d.universityId} onChange={txt('universityId')}>{db.universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </Field>
          <Field label="Study level"><Select value={d.level} onChange={(e) => set('level', e.target.value as StudyLevel)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
          <Field label="Category"><Input value={d.field} onChange={txt('field')} placeholder="e.g. Business & Management" /></Field>
          <Field label="Faculty"><Input value={d.faculty} onChange={txt('faculty')} /></Field>
          <Field label="Duration"><Input value={d.duration} onChange={txt('duration')} placeholder="e.g. 12 months" /></Field>
          <Field label="Min. IELTS"><Input type="number" step="0.5" value={d.ieltsMin} onChange={(e) => set('ieltsMin', Number(e.target.value))} /></Field>
          <Field label="Tuition fee / year" required><Input type="number" value={d.tuition} onChange={(e) => set('tuition', Number(e.target.value))} /></Field>
          <Field label="Currency"><Input value={d.currency} onChange={txt('currency')} placeholder="GBP" /></Field>
          <Field label="Scholarship"><Input value={d.scholarship} onChange={txt('scholarship')} /></Field>
          <Field label="Tuition after scholarship"><Input type="number" value={d.tuitionAfterScholarship} onChange={txt('tuitionAfterScholarship')} /></Field>
          <Field label="Early bird discount"><Input value={d.earlyBird} onChange={txt('earlyBird')} /></Field>
          <Field label="Accommodation"><Input value={d.accommodation} onChange={txt('accommodation')} /></Field>
          <div className="flex items-center gap-3 sm:col-span-2"><Switch checked={d.active} onCheckedChange={(v) => set('active', v)} label="Course active" /><span className="text-sm text-ink-soft">{d.active ? 'Active — shown in the Course Finder' : 'Inactive — hidden from the Course Finder'}</span></div>
        </div>
      )}
      {tab === 'requirements' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {area('academicRequirement', 'Academic requirement', 2)}
          {area('englishRequirement', 'English language requirement', 5)}
          {area('courseRequirement', 'Course-specific requirement')}
          {area('documentsRequired', 'Documents required', 2)}
          {area('complianceRequirement', 'Compliance requirement', 4)}
        </div>
      )}
      {tab === 'intakes' && live && (
        <>
          <p className="mb-3 flex items-center gap-2 text-sm text-ink-soft"><CalendarDays className="h-4 w-4 text-rust" />Each intake saves on its own. Closed or disabled intakes disappear from the Course Finder and application forms.</p>
          <IntakeManager course={live} />
        </>
      )}
    </Modal>
  );
}
