import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Clock, Eye, FileStack, GraduationCap, MapPin } from 'lucide-react';
import { Badge, Button, Field, Modal, Select } from '../ui';
import { useToast } from '../feedback';
import { useLookup, useScoped, useStore } from '../../store/store';
import { checklistTemplate } from '../../data/seed';
import type { Application, AppStatus } from '../../data/types';
import { appStatusTone, countryFlag, fullName, money } from '../../lib/utils';

const isOpen = (a: Application) => a.status !== 'Visa Refused';
const sameIntake = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function ApplicationForm({
  open,
  onClose,
  studentId,
  courseId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  studentId?: string;
  courseId?: string;
  onSaved?: (id: string) => void;
}) {
  const { actions } = useStore();
  const scoped = useScoped();
  const lk = useLookup();
  const toast = useToast();
  const navigate = useNavigate();
  const [student, setStudent] = useState('');
  const [country, setCountry] = useState('');
  const [uni, setUni] = useState('');
  const [course, setCourse] = useState('');
  const [intake, setIntake] = useState('');
  const [status, setStatus] = useState<AppStatus>('Pending Assessment');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [existingFor, setExistingFor] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; ref: string } | null>(null);
  // One id per creation attempt: a retried or double-clicked request reuses it, so the
  // database can only ever create one row for it.
  const requestId = useRef('');
  // Synchronous guard: state updates land after a re-render, so rapid clicks need a ref.
  const inFlight = useRef(false);
  const initial = useRef({ student: '', uni: '', course: '', intake: '' });

  // Reset ONLY when the form opens (or is opened for a different student/course). Background
  // re-syncs replace the course and university lists with new arrays; depending on them here
  // used to wipe the form every time live data arrived (the "page refresh" partners saw).
  const listsRef = useRef({ courses: scoped.courses, universities: scoped.universities });
  listsRef.current = { courses: scoped.courses, universities: scoped.universities };
  useEffect(() => {
    if (!open) return;
    const c = listsRef.current.courses.find((x) => x.id === courseId);
    const u = c && listsRef.current.universities.find((x) => x.id === c.universityId);
    setStudent(studentId ?? '');
    setCountry(u?.country ?? '');
    setUni(u?.id ?? '');
    setCourse(c?.id ?? '');
    setIntake(c?.intakes[0] ?? '');
    setStatus('Pending Assessment');
    setErrors({});
    setSaving(false);
    inFlight.current = false;
    setExistingFor(null);
    setDuplicate(null);
    requestId.current = crypto.randomUUID();
    initial.current = { student: studentId ?? '', uni: u?.id ?? '', course: c?.id ?? '', intake: c?.intakes[0] ?? '' };
  }, [open, studentId, courseId]);

  const universities = useMemo(() => scoped.universities.filter((u) => u.active !== false || u.id === uni), [scoped.universities, uni]);
  const countries = useMemo(() => [...new Set(universities.map((u) => u.country))].sort(), [universities]);
  const unis = universities.filter((u) => !country || u.country === country);
  const courses = scoped.courses.filter((c) => c.universityId === uni && (c.active !== false || c.id === course));
  const selectedCourse = scoped.courses.find((c) => c.id === course);
  const selectedUni = scoped.universities.find((u) => u.id === uni);
  const selectedStudent = scoped.students.find((s) => s.id === student);
  const studentApps = useMemo(() => scoped.applications.filter((a) => a.studentId === student), [scoped.applications, student]);
  // Intakes from the live catalogue; keep the chosen one listed even if it was just closed.
  const intakeOptions = selectedCourse ? [...new Set([...selectedCourse.intakes, ...(intake ? [intake] : [])])] : [];

  const dirty =
    student !== initial.current.student || uni !== initial.current.uni || course !== initial.current.course || intake !== initial.current.intake;

  const chooseStudent = (id: string) => {
    setStudent(id);
    // Tell the user up front when this student already has applications (allowed, just visible).
    if (id && scoped.applications.some((a) => a.studentId === id)) setExistingFor(id);
  };

  const save = async () => {
    if (inFlight.current) return;
    const e: Record<string, string> = {};
    if (!student) e.student = 'Select a student.';
    if (!uni) e.uni = 'Select a university.';
    if (!course) e.course = 'Select a course.';
    if (!intake) e.intake = 'Select an intake.';
    setErrors(e);
    if (Object.keys(e).length) return toast.error('Please complete the application details');
    const dup = scoped.applications.find((a) => isOpen(a) && a.studentId === student && a.universityId === uni && a.courseId === course && sameIntake(a.intake, intake));
    if (dup) return setDuplicate({ id: dup.id, ref: dup.ref });

    inFlight.current = true;
    setSaving(true);
    const res = await actions.createApplication(
      { studentId: student, partnerId: selectedStudent!.partnerId, universityId: uni, courseId: course, intake, status, checklist: checklistTemplate() },
      requestId.current,
    );
    inFlight.current = false;
    setSaving(false);
    if (res.ok) {
      toast.success('Application created', `${fullName(selectedStudent)} → ${selectedUni?.name}`);
      requestId.current = crypto.randomUUID();
      onSaved?.(res.id);
      onClose();
    } else if (res.reason === 'duplicate') {
      setDuplicate({ id: res.existingId, ref: res.existingRef });
    } else {
      toast.error('Application not created', res.message);
    }
  };

  const initialStatuses: AppStatus[] = scoped.isAdmin ? ['Draft', 'Pending Assessment', 'Submitted'] : ['Draft', 'Pending Assessment'];
  const leaveTo = (path: string) => {
    setExistingFor(null);
    setDuplicate(null);
    onClose();
    navigate(path);
  };

  return (
    <>
      <Modal
        dirty={dirty}
        open={open}
        onClose={onClose}
        size="lg"
        title="Create application"
        subtitle="Choose a student, then a university, course and intake."
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={saving}>
              Create application
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            // Never let the browser submit (that would reload the page).
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Student" required error={errors.student} className="sm:col-span-2">
            <Select value={student} onChange={(e) => chooseStudent(e.target.value)} invalid={!!errors.student}>
              <option value="">Select student…</option>
              {scoped.students
                .slice()
                .sort((a, b) => fullName(a).localeCompare(fullName(b)))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s)} — {s.email}
                  </option>
                ))}
            </Select>
          </Field>
          {student && studentApps.length > 0 && (
            <p className="-mt-2 flex items-center gap-1.5 text-xs text-ink-soft sm:col-span-2">
              <FileStack className="h-3.5 w-3.5 text-rust" />
              {studentApps.length} existing application{studentApps.length === 1 ? '' : 's'} for this student.
              <button type="button" onClick={() => setExistingFor(student)} className="font-semibold text-rust hover:underline">
                Review
              </button>
            </p>
          )}
          <Field label="Destination country">
            <Select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                // Only clear choices that no longer fit the new country.
                const u = scoped.universities.find((x) => x.id === uni);
                if (u && e.target.value && u.country !== e.target.value) {
                  setUni('');
                  setCourse('');
                  setIntake('');
                }
              }}
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {countryFlag[c]} {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="University" required error={errors.uni}>
            <Select
              value={uni}
              invalid={!!errors.uni}
              onChange={(e) => {
                if (e.target.value === uni) return;
                setUni(e.target.value);
                setCourse('');
                setIntake('');
              }}
            >
              <option value="">Select university…</option>
              {unis.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Course" required error={errors.course}>
            <Select
              value={course}
              invalid={!!errors.course}
              disabled={!uni}
              onChange={(e) => {
                if (e.target.value === course) return;
                setCourse(e.target.value);
                const c = scoped.courses.find((x) => x.id === e.target.value);
                setIntake(c?.intakes[0] ?? '');
              }}
            >
              <option value="">{uni ? 'Select course…' : 'Choose a university first'}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Intake" required error={errors.intake}>
            <Select value={intake} onChange={(e) => setIntake(e.target.value)} disabled={!selectedCourse} invalid={!!errors.intake}>
              <option value="">{selectedCourse && !intakeOptions.length ? 'No open intake' : 'Select intake…'}</option>
              {intakeOptions.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </Select>
          </Field>
          <Field label="Initial status" className="sm:col-span-2" hint={scoped.isAdmin ? undefined : 'SSI Admissions will review and progress the application.'}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as AppStatus)}>
              {initialStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </form>

        {selectedCourse && selectedUni && (
          <div className="mt-5 animate-fade-up rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-4 dark:border-brand-500/30">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-xl shadow-sm">{countryFlag[selectedUni.country]}</span>
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold text-heading">{selectedCourse.name}</div>
                <div className="text-sm text-ink-soft">{selectedUni.name}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                  {selectedUni.city && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{selectedUni.city}</span>}
                  <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" />{selectedCourse.level}</span>
                  {selectedCourse.duration && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{selectedCourse.duration}</span>}
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{intake || selectedCourse.intakes.join(', ')}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium text-ink-mute">Tuition / yr</div>
                <div className="font-display font-semibold text-rust">{money(selectedCourse.tuition, selectedCourse.currency)}</div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Existing applications (informational: more applications are allowed). */}
      <Modal
        open={!!existingFor && open}
        onClose={() => setExistingFor(null)}
        size="md"
        title="Existing Applications Found"
        subtitle="This student already has an application in the system. Would you like to create another application for this student?"
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => { setStudent(initial.current.student); setExistingFor(null); }}>
              Cancel
            </Button>
            <Button variant="secondary" icon={Eye} onClick={() => existingFor && leaveTo(`${scoped.base}/students/${existingFor}`)}>
              View Existing Applications
            </Button>
            <Button onClick={() => setExistingFor(null)}>Continue with New Application</Button>
          </>
        }
      >
        <ul className="space-y-2">
          {scoped.applications
            .filter((a) => a.studentId === existingFor)
            .map((a) => (
              <li key={a.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-heading">{lk.university.get(a.universityId)?.name ?? '—'}</span>
                  <Badge tone={appStatusTone[a.status]} dot>{a.status}</Badge>
                </div>
                <div className="mt-1 text-sm text-ink-soft">{lk.course.get(a.courseId)?.name ?? '—'}</div>
                <div className="mt-1 text-xs text-ink-mute">{a.ref} · Intake {a.intake}</div>
              </li>
            ))}
        </ul>
      </Modal>

      {/* Exact duplicate (blocked). */}
      <Modal
        open={!!duplicate && open}
        onClose={() => setDuplicate(null)}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Possible Duplicate Application
          </span>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicate(null)}>Cancel</Button>
            <Button icon={Eye} onClick={() => duplicate && leaveTo(`${scoped.base}/applications?open=${duplicate.id}`)}>View Existing Application</Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          An application for this student, university, course and intake already exists{duplicate?.ref ? ` (${duplicate.ref})` : ''}. Please review the existing
          application before continuing.
        </p>
        <p className="mt-3 text-xs text-ink-mute">
          To apply again for the same intake, ask SSI GLOBAL to close the existing application first. Applications to another course, university or intake are allowed.
        </p>
      </Modal>
    </>
  );
}
