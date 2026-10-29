// Course catalogue building blocks shared by the Admin (Courses, Providers), Staff and Partner
// (Course Finder) screens: course details, intake editor and the Excel import dialog.
// All data comes from the live, RLS-filtered store; edits are saved through the store (RLS:
// "catalogue" permission) and reach every portal via Realtime.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  GraduationCap,
  Languages,
  MapPin,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { Alert, Badge, Button, Drawer, Field, Input, Modal, Select, Switch, Tabs } from './ui';
import { useConfirm, useToast } from './feedback';
import { useStore, type ImportSummary } from '../store/store';
import type { Course, CourseIntake, IntakeStatus, University } from '../data/types';
import { cn, formatDate, money, type Tone } from '../lib/utils';
import { MAX_IMPORT_BYTES, parseCatalogue, previewImport, readWorkbook, type ParseResult, type Preview } from '../lib/catalogueImport';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const intakeLabel = (i: Pick<CourseIntake, 'intakeMonth' | 'intakeYear'>) => `${MONTH_NAMES[i.intakeMonth - 1]} ${i.intakeYear}`;
export const intakeTone: Record<IntakeStatus, Tone> = { Available: 'green', Upcoming: 'blue', Closed: 'slate' };
const sortIntakes = (a: CourseIntake, b: CourseIntake) => a.intakeYear - b.intakeYear || a.intakeMonth - b.intakeMonth;

/** Intakes of a course as stored (not the derived label list). */
export function useCourseIntakes(courseId?: string, includeInactive = false) {
  const { db } = useStore();
  return useMemo(
    () => db.courseIntakes.filter((i) => i.courseId === courseId && (includeInactive || i.active)).sort(sortIntakes),
    [db.courseIntakes, courseId, includeInactive],
  );
}

function Detail({ label, children }: { label: string; children?: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</dt>
      <dd className="mt-1 whitespace-pre-line text-sm text-heading">{children}</dd>
    </div>
  );
}

/** Read-only course details; `actions` adds Edit / Apply buttons. */
export function CourseDetails({ course, onClose, actions, showInactive }: { course?: Course; onClose: () => void; actions?: React.ReactNode; showInactive?: boolean }) {
  const { db } = useStore();
  const uni = db.universities.find((u) => u.id === course?.universityId);
  const intakes = useCourseIntakes(course?.id, showInactive);
  return (
    <Drawer open={!!course} onClose={onClose} title={course?.name ?? ''} subtitle={uni ? `${uni.name}${uni.city ? ` · ${uni.city}` : ''}` : undefined} footer={actions}>
      {course && (
        <div className="space-y-6 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={course.level === 'Postgraduate' ? 'navy' : 'orange'}>{course.level}</Badge>
            {course.field && <Badge tone="slate">{course.field}</Badge>}
            {course.active === false && <Badge tone="red">Inactive</Badge>}
          </div>

          <section className="grid grid-cols-2 gap-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-mute"><Wallet className="h-3.5 w-3.5" /> Tuition / year</div>
              <div className="font-display text-lg font-semibold text-heading">{money(course.tuition, course.currency)}</div>
              {course.tuitionAfterScholarship != null && <div className="text-xs text-emerald-600 dark:text-emerald-400">{money(course.tuitionAfterScholarship, course.currency)} after scholarship</div>}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-mute"><Clock className="h-3.5 w-3.5" /> Duration</div>
              <div className="font-semibold text-heading">{course.duration || '—'}</div>
              {course.ieltsMin ? <div className="mt-1 flex items-center gap-1 text-xs text-ink-soft"><Languages className="h-3.5 w-3.5" /> IELTS {course.ieltsMin}+</div> : null}
            </div>
          </section>

          <section>
            <h4 className="mb-2 font-display text-sm font-semibold text-heading">Intakes</h4>
            {intakes.length === 0 ? (
              <p className="text-ink-mute">No intakes published.</p>
            ) : (
              <ul className="space-y-2">
                {intakes.map((i) => (
                  <li key={i.id} className={cn('rounded-xl border border-line p-3', !i.active && 'opacity-60')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold text-heading"><CalendarDays className="h-4 w-4 text-rust" />{intakeLabel(i)}</span>
                      <span className="flex gap-1">
                        {!i.active && <Badge tone="slate">Disabled</Badge>}
                        <Badge tone={intakeTone[i.status]} dot>{i.status}</Badge>
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft">
                      {i.inductionDate && <div>Induction: <b className="text-heading">{formatDate(i.inductionDate)}</b></div>}
                      {i.startDate && <div>Starts: <b className="text-heading">{formatDate(i.startDate)}</b></div>}
                      {i.endDate && <div>Ends: <b className="text-heading">{formatDate(i.endDate)}</b></div>}
                      {i.applicationDeadline && <div>CAS / application deadline: <b className="text-heading">{formatDate(i.applicationDeadline)}</b></div>}
                      {i.enrolmentDeadline && <div>Last enrolment: <b className="text-heading">{formatDate(i.enrolmentDeadline)}</b></div>}
                    </dl>
                    {i.notes && <p className="mt-1.5 text-xs text-ink-mute">{i.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <dl className="grid gap-4">
            <Detail label="Scholarship">{course.scholarship}</Detail>
            <Detail label="Early bird">{course.earlyBird}</Detail>
            <Detail label="Accommodation">{course.accommodation}</Detail>
            <Detail label="Academic requirement">{course.academicRequirement}</Detail>
            <Detail label="English requirement">{course.englishRequirement}</Detail>
            <Detail label="Course-specific requirement">{course.courseRequirement}</Detail>
            <Detail label="Documents required">{course.documentsRequired}</Detail>
            <Detail label="Compliance">{course.complianceRequirement}</Detail>
            <Detail label="Faculty">{course.faculty}</Detail>
          </dl>

          {uni && (uni.casDeposit || uni.paymentPlan || (uni.moiAccepted?.length ?? 0) > 0) && (
            <section className="rounded-2xl border border-line p-4">
              <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-heading"><GraduationCap className="h-4 w-4 text-rust" />{uni.name}</h4>
              <dl className="grid gap-3">
                <Detail label="Location">{[uni.city, uni.country].filter(Boolean).join(', ')}</Detail>
                <Detail label="CAS deposit">{uni.casDeposit}</Detail>
                <Detail label="Payment plan">{uni.paymentPlan}</Detail>
                {(uni.moiAccepted?.length ?? 0) > 0 && (
                  <Detail label={`MOI accepted from (${uni.moiAccepted!.length})`}>
                    <span className="text-xs text-ink-soft">{uni.moiAccepted!.join(' · ')}</span>
                  </Detail>
                )}
              </dl>
            </section>
          )}
          {course.source && <p className="text-[11px] text-ink-mute">Source: {course.source}{course.updatedAt ? ` · updated ${formatDate(course.updatedAt)}` : ''}</p>}
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ intake editor

type Draft = Omit<CourseIntake, 'id' | 'courseId'> & { id?: string };
const blank = (): Draft => {
  const d = new Date();
  return { intakeMonth: d.getMonth() + 1, intakeYear: d.getFullYear() + 1, status: 'Upcoming', active: true, inductionDate: '', startDate: '', endDate: '', applicationDeadline: '', enrolmentDeadline: '', notes: '' };
};

function IntakeRow({ draft, onSave, onRemove, busyLabel }: { draft: Draft; onSave: (d: Draft) => void; onRemove?: () => void; busyLabel: string }) {
  const [d, setD] = useState(draft);
  useEffect(() => setD(draft), [draft]);
  const dirty = JSON.stringify(d) !== JSON.stringify(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 1 + i);
  return (
    <div className={cn('rounded-2xl border p-4 transition', dirty ? 'border-brand-300 bg-brand-50/30 dark:bg-brand-500/5' : 'border-line', !d.active && 'opacity-70')}>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
        <Field label="Month">
          <Select value={String(d.intakeMonth)} onChange={(e) => set('intakeMonth', Number(e.target.value))} aria-label="Intake month">
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Year">
          <Select value={String(d.intakeYear)} onChange={(e) => set('intakeYear', Number(e.target.value))} aria-label="Intake year">
            {[...new Set([...years, d.intakeYear])].sort().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set('status', e.target.value as IntakeStatus)} aria-label="Intake status">
            <option value="Available">Available</option>
            <option value="Upcoming">Upcoming</option>
            <option value="Closed">Closed</option>
          </Select>
        </Field>
        <Field label="Enabled">
          <div className="flex h-10 items-center"><Switch checked={d.active} onCheckedChange={(v) => set('active', v)} label="Intake enabled" /></div>
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Application / CAS deadline"><Input type="date" value={d.applicationDeadline ?? ''} onChange={(e) => set('applicationDeadline', e.target.value)} /></Field>
        <Field label="Last enrolment"><Input type="date" value={d.enrolmentDeadline ?? ''} onChange={(e) => set('enrolmentDeadline', e.target.value)} /></Field>
        <Field label="Induction"><Input type="date" value={d.inductionDate ?? ''} onChange={(e) => set('inductionDate', e.target.value)} /></Field>
        <Field label="Course start"><Input type="date" value={d.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Course end"><Input type="date" value={d.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} /></Field>
        <Field label="Notes"><Input value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. End date subject to change" /></Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {onRemove && <Button size="sm" variant="ghost" icon={Trash2} onClick={onRemove}>Delete</Button>}
        <Button size="sm" icon={Save} disabled={!dirty} onClick={() => onSave(d)}>{busyLabel}</Button>
      </div>
    </div>
  );
}

const toNull = (d: Draft) => ({
  ...d,
  inductionDate: d.inductionDate || null,
  startDate: d.startDate || null,
  endDate: d.endDate || null,
  applicationDeadline: d.applicationDeadline || null,
  enrolmentDeadline: d.enrolmentDeadline || null,
  notes: d.notes?.trim() || null,
});

/** Add, edit, close, disable or delete the intakes of one course. */
export function IntakeManager({ course }: { course: Course }) {
  const { actions } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const intakes = useCourseIntakes(course.id, true);
  const [adding, setAdding] = useState(false);
  const clash = (d: Draft) => intakes.some((i) => i.id !== d.id && i.intakeMonth === d.intakeMonth && i.intakeYear === d.intakeYear);
  return (
    <div className="space-y-3">
      {intakes.length === 0 && !adding && <p className="text-sm text-ink-mute">No intakes yet. Add the next intake for this course.</p>}
      {intakes.map((i) => (
        <IntakeRow
          key={i.id}
          busyLabel="Save intake"
          draft={{ ...i, inductionDate: i.inductionDate ?? '', startDate: i.startDate ?? '', endDate: i.endDate ?? '', applicationDeadline: i.applicationDeadline ?? '', enrolmentDeadline: i.enrolmentDeadline ?? '', notes: i.notes ?? '' }}
          onSave={(d) => {
            if (clash(d)) return toast.error('Intake already exists', `${MONTH_NAMES[d.intakeMonth - 1]} ${d.intakeYear} is already listed for this course.`);
            const { id: _id, ...rest } = toNull(d);
            actions.updateIntake(i.id, rest);
            toast.success('Intake saved', `${MONTH_NAMES[d.intakeMonth - 1]} ${d.intakeYear} · visible to partners and staff instantly.`);
          }}
          onRemove={async () => {
            if (await confirm({ title: `Delete ${intakeLabel(i)}?`, message: 'To keep it on record, mark it Closed or disable it instead.', confirmLabel: 'Delete intake', danger: true })) {
              actions.removeIntake(i.id);
              toast.success('Intake deleted');
            }
          }}
        />
      ))}
      {adding ? (
        <IntakeRow
          busyLabel="Add intake"
          draft={blank()}
          onSave={(d) => {
            if (clash(d)) return toast.error('Intake already exists', `${MONTH_NAMES[d.intakeMonth - 1]} ${d.intakeYear} is already listed for this course.`);
            const { id: _id, ...rest } = toNull(d);
            actions.addIntake({ ...rest, courseId: course.id });
            setAdding(false);
            toast.success('Intake added', `${MONTH_NAMES[d.intakeMonth - 1]} ${d.intakeYear}`);
          }}
          onRemove={() => setAdding(false)}
        />
      ) : (
        <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>Add intake</Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Excel import

function List({ items, empty }: { items: Preview['newCourses']; empty: string }) {
  if (!items.length) return <p className="px-1 py-4 text-center text-sm text-ink-mute">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => (
        <li key={it.key} className="py-2.5">
          <div className="text-sm font-semibold text-heading">{it.label}</div>
          {it.sub && <div className="text-xs text-ink-mute">{it.sub}</div>}
          {it.changes?.map((c) => (
            <div key={c.field} className="mt-1 text-xs text-ink-soft">
              <b className="text-heading">{c.field}:</b>{' '}
              <span className="line-through opacity-70">{String(c.from ?? '—').slice(0, 80)}</span> → <span className="text-emerald-700 dark:text-emerald-300">{String(c.to ?? '—').slice(0, 80)}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Admin-only: upload an .xlsx, preview every change, then apply on the server. */
export function CatalogueImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, actions } = useStore();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');
  const [overwrite, setOverwrite] = useState<'update' | 'keep'>('keep');
  const [tab, setTab] = useState<'courses' | 'updates' | 'intakes' | 'universities' | 'issues'>('courses');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setParsed(null);
    setError('');
    setResult(null);
    setOverwrite('keep');
  }, [open]);

  const preview = useMemo(
    () =>
      parsed
        ? previewImport(
            parsed,
            {
              universities: db.universities.map((u) => ({ id: u.id, name: u.name, country: u.country, city: u.city, casDeposit: u.casDeposit, paymentPlan: u.paymentPlan, moiAccepted: u.moiAccepted, notes: u.notes })),
              courses: db.courses as unknown as (Record<string, unknown> & { id: string; universityId: string; name: string })[],
              intakes: db.courseIntakes,
              blacklist: db.blacklist,
            },
            overwrite === 'update',
          )
        : null,
    [parsed, db.universities, db.courses, db.courseIntakes, db.blacklist, overwrite],
  );

  const pick = async (f: File | undefined) => {
    setError('');
    setParsed(null);
    setResult(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setError('Choose an Excel .xlsx file.');
    if (f.size > MAX_IMPORT_BYTES) return setError('The file is larger than 5 MB.');
    setFile(f);
    try {
      const sheets = readWorkbook(new Uint8Array(await f.arrayBuffer()));
      setParsed(parseCatalogue(sheets, f.name.replace(/\.xlsx$/i, '')));
      setTab('courses');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    }
  };

  const apply = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const summary = await actions.importCatalogue(parsed.payload, overwrite === 'update');
      setResult(summary);
      toast.success('Catalogue updated', `${summary.courses.new} new and ${summary.courses.updated} updated courses.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed.');
    }
    setBusy(false);
  };

  const changes = preview ? preview.newUniversities.length + preview.updatedUniversities.length + preview.newCourses.length + preview.updatedCourses.length + preview.newIntakes.length + preview.changedIntakes.length + preview.newBlacklist : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={!!parsed && !result}
      title="Import courses from Excel"
      subtitle="Review every change before it is saved. Nothing is deleted by an import."
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button icon={CheckCircle2} onClick={() => void apply()} loading={busy} disabled={!parsed || changes === 0}>
              {changes ? `Apply ${changes} change${changes === 1 ? '' : 's'}` : 'Nothing to apply'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {result ? (
          <div className="space-y-3">
            <Alert tone="success" title="Import complete">The catalogue now reflects the file. Partners and staff see the changes immediately.</Alert>
            <div className="grid gap-3 sm:grid-cols-4">
              {(['universities', 'courses', 'intakes'] as const).map((k) => (
                <div key={k} className="rounded-xl bg-canvas p-3 ring-1 ring-line">
                  <div className="text-xs capitalize text-ink-mute">{k}</div>
                  <div className="text-sm text-heading"><b>{result[k].new}</b> new · <b>{result[k].updated}</b> updated · {result[k].unchanged} unchanged</div>
                </div>
              ))}
              <div className="rounded-xl bg-canvas p-3 ring-1 ring-line">
                <div className="text-xs text-ink-mute">Blacklist</div>
                <div className="text-sm text-heading"><b>{result.blacklist.new}</b> new · {result.blacklist.unchanged} existing</div>
              </div>
            </div>
            {result.invalid.length > 0 && (
              <Alert tone="warning" title={`${result.invalid.length} record(s) not imported`}>
                <ul className="mt-1 list-disc pl-4">{result.invalid.map((x, i) => <li key={i}>{x.name}: {x.reason}</li>)}</ul>
              </Alert>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void pick(e.dataTransfer.files[0]);
              }}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-canvas/50 px-6 py-8 text-center transition hover:border-rust focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-rust"><FileSpreadsheet className="h-5 w-5" /></span>
              <span className="text-sm font-semibold text-heading">{file ? file.name : 'Choose or drop an .xlsx file'}</span>
              <span className="text-xs text-ink-mute">Partner toolkit format, or one row per course with University, Course and Tuition columns · max 5 MB</span>
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-rust"><Upload className="h-3.5 w-3.5" /> Browse files</span>
            </button>
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />

            {parsed && preview && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={cn('flex cursor-pointer gap-3 rounded-xl border p-3', overwrite === 'keep' ? 'border-rust bg-brand-50/40 dark:bg-brand-500/10' : 'border-line')}>
                    <input type="radio" className="sr-only" checked={overwrite === 'keep'} onChange={() => setOverwrite('keep')} />
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-rust" />
                    <span><span className="block text-sm font-semibold text-heading">Keep manual edits</span><span className="text-xs text-ink-mute">Add new records and fill empty fields only.</span></span>
                  </label>
                  <label className={cn('flex cursor-pointer gap-3 rounded-xl border p-3', overwrite === 'update' ? 'border-rust bg-brand-50/40 dark:bg-brand-500/10' : 'border-line')}>
                    <input type="radio" className="sr-only" checked={overwrite === 'update'} onChange={() => setOverwrite('update')} />
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <span><span className="block text-sm font-semibold text-heading">Update from the file</span><span className="text-xs text-ink-mute">Values in the file replace current values (fees, requirements, dates).</span></span>
                  </label>
                </div>
                {parsed.notes.length > 0 && (
                  <Alert tone="info" title="How this file was read">
                    <ul className="list-disc pl-4">{parsed.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </Alert>
                )}
                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: 'courses', label: 'New courses', count: preview.newCourses.length },
                    { value: 'updates', label: 'Updated courses', count: preview.updatedCourses.length },
                    { value: 'intakes', label: 'Intakes', count: preview.newIntakes.length + preview.changedIntakes.length },
                    { value: 'universities', label: 'Universities', count: preview.newUniversities.length + preview.updatedUniversities.length },
                    { value: 'issues', label: 'Duplicates & invalid', count: preview.duplicates.length + preview.invalid.length },
                  ]}
                />
                <div className="max-h-[320px] overflow-y-auto rounded-xl border border-line px-4">
                  {tab === 'courses' && <List items={preview.newCourses} empty="No new courses." />}
                  {tab === 'updates' && <List items={preview.updatedCourses} empty={`No changes to existing courses (${preview.unchangedCourses} unchanged).`} />}
                  {tab === 'intakes' && <List items={[...preview.newIntakes.map((x) => ({ ...x, label: `New: ${x.label}` })), ...preview.changedIntakes]} empty="No intake changes." />}
                  {tab === 'universities' && (
                    <>
                      <List items={[...preview.newUniversities.map((x) => ({ ...x, label: `New: ${x.label}` })), ...preview.updatedUniversities]} empty="No university changes." />
                      {preview.newBlacklist > 0 && <p className="border-t border-line py-2.5 text-xs text-ink-soft">+ {preview.newBlacklist} blacklisted institution(s)</p>}
                    </>
                  )}
                  {tab === 'issues' &&
                    (preview.duplicates.length + preview.invalid.length === 0 ? (
                      <p className="py-4 text-center text-sm text-ink-mute">No duplicates or invalid records.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {preview.duplicates.map((d) => <li key={d.key} className="py-2.5 text-sm"><Badge tone="amber">Duplicate</Badge> <b className="text-heading">{d.label}</b> <span className="text-xs text-ink-mute">{d.sub} — listed more than once; only the first is used</span></li>)}
                        {preview.invalid.map((x, i) => <li key={i} className="py-2.5 text-sm"><Badge tone="red">Invalid</Badge> <b className="text-heading">{x.where}</b> <span className="text-xs text-ink-mute">— {x.reason}</span></li>)}
                      </ul>
                    ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** University edit form (Admin). */
export function UniversityForm({ open, university, onClose }: { open: boolean; university?: University; onClose: () => void }) {
  const { actions } = useStore();
  const toast = useToast();
  const empty = { name: '', country: 'United Kingdom', city: '', website: '', type: 'Public' as University['type'], ranking: 0, partnerSince: String(new Date().getFullYear()), casDeposit: '', paymentPlan: '', moi: '', notes: '', active: true };
  const [d, setD] = useState(empty);
  useEffect(() => {
    if (!open) return;
    setD(
      university
        ? { ...empty, ...university, city: university.city ?? '', website: university.website ?? '', casDeposit: university.casDeposit ?? '', paymentPlan: university.paymentPlan ?? '', moi: (university.moiAccepted ?? []).join('\n'), notes: university.notes ?? '', active: university.active !== false }
        : empty,
    );
  }, [open, university]);
  const save = () => {
    if (d.name.trim().length < 3 || !d.country.trim()) return toast.error('Name and country are required');
    const patch = {
      name: d.name.trim(), country: d.country.trim(), city: d.city.trim(), website: d.website.trim(), type: d.type, ranking: Number(d.ranking) || 0,
      partnerSince: d.partnerSince, casDeposit: d.casDeposit.trim() || null, paymentPlan: d.paymentPlan.trim() || null,
      moiAccepted: d.moi.split('\n').map((x) => x.trim()).filter(Boolean), notes: d.notes.trim() || null, active: d.active,
    };
    if (university) actions.updateUniversity(university.id, patch);
    else actions.addUniversity(patch);
    toast.success(university ? 'Provider updated' : 'Provider added', patch.name);
    onClose();
  };
  const s = <K extends keyof typeof d>(k: K) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={university ? 'Edit provider' : 'Add provider'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>{university ? 'Save changes' : 'Add provider'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="University name" required className="sm:col-span-2"><Input value={d.name} onChange={s('name')} autoFocus /></Field>
        <Field label="Country" required><Input value={d.country} onChange={s('country')} /></Field>
        <Field label="City / location"><Input icon={MapPin} value={d.city} onChange={s('city')} /></Field>
        <Field label="Website"><Input value={d.website} onChange={s('website')} /></Field>
        <Field label="Type">
          <Select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as University['type'] })}>
            <option>Public</option>
            <option>Private</option>
          </Select>
        </Field>
        <Field label="CAS deposit" className="sm:col-span-2"><Input value={d.casDeposit} onChange={s('casDeposit')} placeholder="e.g. CAS Deposit: 50% · Balance by end of Term 1: 25%" /></Field>
        <Field label="Payment plan" className="sm:col-span-2"><Input value={d.paymentPlan} onChange={s('paymentPlan')} /></Field>
        <Field label="MOI accepted universities" hint="One per line" className="sm:col-span-2">
          <textarea value={d.moi} onChange={s('moi')} rows={5} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-heading focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={d.notes} onChange={s('notes')} /></Field>
        <div className="flex items-center gap-3 sm:col-span-2"><Switch checked={d.active} onCheckedChange={(v) => setD({ ...d, active: v })} label="Active" /><span className="text-sm text-ink-soft">{d.active ? 'Active — shown in the Course Finder' : 'Inactive — hidden from the Course Finder'}</span></div>
      </div>
    </Modal>
  );
}
