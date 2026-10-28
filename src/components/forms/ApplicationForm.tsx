import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock, GraduationCap, MapPin } from 'lucide-react';
import { Button, Field, Modal, Select } from '../ui';
import { useToast } from '../feedback';
import { useScoped, useStore } from '../../store/store';
import { checklistTemplate } from '../../data/seed';
import type { AppStatus } from '../../data/types';
import { countryFlag, fullName, money } from '../../lib/utils';

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
  const toast = useToast();
  const [student, setStudent] = useState('');
  const [country, setCountry] = useState('');
  const [uni, setUni] = useState('');
  const [course, setCourse] = useState('');
  const [intake, setIntake] = useState('');
  const [status, setStatus] = useState<AppStatus>('Pending Assessment');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const c = scoped.courses.find((x) => x.id === courseId);
    const u = c && scoped.universities.find((x) => x.id === c.universityId);
    setStudent(studentId ?? '');
    setCountry(u?.country ?? '');
    setUni(u?.id ?? '');
    setCourse(c?.id ?? '');
    setIntake(c?.intakes[0] ?? '');
    setStatus('Pending Assessment');
    setErrors({});
  }, [open, studentId, courseId, scoped.courses, scoped.universities]);

  const countries = useMemo(() => [...new Set(scoped.universities.map((u) => u.country))].sort(), [scoped.universities]);
  const unis = scoped.universities.filter((u) => !country || u.country === country);
  const courses = scoped.courses.filter((c) => c.universityId === uni);
  const selectedCourse = scoped.courses.find((c) => c.id === course);
  const selectedUni = scoped.universities.find((u) => u.id === uni);
  const selectedStudent = scoped.students.find((s) => s.id === student);

  const save = () => {
    const e: Record<string, string> = {};
    if (!student) e.student = 'Select a student.';
    if (!uni) e.uni = 'Select a university.';
    if (!course) e.course = 'Select a course.';
    if (!intake) e.intake = 'Select an intake.';
    setErrors(e);
    if (Object.keys(e).length) return toast.error('Please complete the application details');
    const id = actions.addApplication({
      studentId: student,
      partnerId: selectedStudent!.partnerId,
      universityId: uni,
      courseId: course,
      intake,
      status,
      checklist: checklistTemplate(),
    });
    toast.success('Application created', `${fullName(selectedStudent)} → ${selectedUni?.name}`);
    onSaved?.(id);
    onClose();
  };

  const initialStatuses: AppStatus[] = scoped.isAdmin ? ['Draft', 'Pending Assessment', 'Submitted'] : ['Draft', 'Pending Assessment'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create application"
      subtitle="Choose a student, then a university, course and intake."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Create application</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student" required error={errors.student} className="sm:col-span-2">
          <Select value={student} onChange={(e) => setStudent(e.target.value)} invalid={!!errors.student}>
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
        <Field label="Destination country">
          <Select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setUni('');
              setCourse('');
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
            <option value="">Select intake…</option>
            {selectedCourse?.intakes.map((i) => (
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
      </div>

      {selectedCourse && selectedUni && (
        <div className="mt-5 animate-fade-up rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-xl shadow-sm">{countryFlag[selectedUni.country]}</span>
            <div className="min-w-0 flex-1">
              <div className="font-display font-semibold text-heading">{selectedCourse.name}</div>
              <div className="text-sm text-ink-soft">{selectedUni.name}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{selectedUni.city}</span>
                <span className="flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" />{selectedCourse.level}</span>
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{selectedCourse.duration}</span>
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{selectedCourse.intakes.join(', ')}</span>
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
  );
}
