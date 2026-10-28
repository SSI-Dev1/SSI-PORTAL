import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Select } from '../ui';
import { useToast } from '../feedback';
import { useScoped, useStore } from '../../store/store';
import { COUNTRIES, INTAKES } from '../../data/seed';
import type { Student, StudyLevel } from '../../data/types';
import { cn, countryFlag } from '../../lib/utils';

type Draft = Omit<Student, 'id' | 'createdAt'>;

const empty = (partnerId: string): Draft => ({
  partnerId,
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dob: '',
  gender: 'Female',
  nationality: 'Indian',
  passportNo: '',
  address: '',
  qualification: '',
  institution: '',
  gpa: '',
  graduationYear: '',
  englishTest: 'IELTS',
  englishScore: '',
  preferredCountries: [],
  preferredLevel: 'Postgraduate',
  preferredIntake: INTAKES[3],
  budget: '$30k – $40k',
  status: 'Active',
});

export function StudentForm({ open, onClose, student, onSaved }: { open: boolean; onClose: () => void; student?: Student; onSaved?: (id: string) => void }) {
  const { actions } = useStore();
  const scoped = useScoped();
  const toast = useToast();
  const [d, setD] = useState<Draft>(empty(scoped.partnerId ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    setD(student ? { ...student } : empty(scoped.partnerId ?? ''));
    setErrors({});
    setStep(0);
  }, [open, student, scoped.partnerId]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!d.partnerId) e.partnerId = 'Select a partner.';
    if (!d.firstName.trim()) e.firstName = 'First name is required.';
    if (!d.lastName.trim()) e.lastName = 'Last name is required.';
    if (!/^\S+@\S+\.\S+$/.test(d.email)) e.email = 'Valid email required.';
    if (d.phone.replace(/\D/g, '').length < 8) e.phone = 'Valid phone required.';
    if (!d.dob) e.dob = 'Date of birth required.';
    setErrors(e);
    if (Object.keys(e).length) setStep(0);
    return !Object.keys(e).length;
  };

  const save = () => {
    if (!validate()) return toast.error('Please fix the highlighted fields');
    if (student) {
      actions.updateStudent(student.id, d);
      toast.success('Student updated', `${d.firstName} ${d.lastName}'s profile was saved.`);
      onSaved?.(student.id);
    } else {
      const id = actions.addStudent(d);
      toast.success('Student added', `${d.firstName} ${d.lastName} is now in your directory.`);
      onSaved?.(id);
    }
    onClose();
  };

  const steps = ['Personal', 'Education', 'Preferences'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={student ? 'Edit student' : 'Add new student'}
      subtitle="Capture the student’s profile. Fields marked * are required."
      footer={
        <>
          <Button variant="secondary" onClick={step === 0 ? onClose : () => setStep(step - 1)}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < 2 ? (
            <Button variant="navy" onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button onClick={save}>{student ? 'Save changes' : 'Add student'}</Button>
          )}
        </>
      }
    >
      <div className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <button key={s} type="button" onClick={() => setStep(i)} className="flex flex-1 items-center gap-2 text-left">
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition', i <= step ? 'bg-rust text-white' : 'bg-canvas text-ink-mute ring-1 ring-line')}>{i + 1}</span>
            <span className={cn('text-sm font-semibold', i <= step ? 'text-heading' : 'text-ink-mute')}>{s}</span>
            {i < 2 && <span className={cn('h-px flex-1', i < step ? 'bg-rust' : 'bg-line')} />}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {scoped.isAdmin && (
            <Field label="Partner workspace" required error={errors.partnerId} className="sm:col-span-2">
              <Select value={d.partnerId} onChange={(e) => set('partnerId', e.target.value)} invalid={!!errors.partnerId}>
                <option value="">Select partner…</option>
                {scoped.partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="First name" required error={errors.firstName}>
            <Input value={d.firstName} onChange={(e) => set('firstName', e.target.value)} invalid={!!errors.firstName} placeholder="e.g. Priya" autoFocus />
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            <Input value={d.lastName} onChange={(e) => set('lastName', e.target.value)} invalid={!!errors.lastName} placeholder="e.g. Nair" />
          </Field>
          <Field label="Email" required error={errors.email}>
            <Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} placeholder="student@mail.com" />
          </Field>
          <Field label="Phone" required error={errors.phone}>
            <Input value={d.phone} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} placeholder="+91 98xxx xxxxx" />
          </Field>
          <Field label="Date of birth" required error={errors.dob}>
            <Input type="date" value={d.dob} onChange={(e) => set('dob', e.target.value)} invalid={!!errors.dob} />
          </Field>
          <Field label="Gender">
            <Select value={d.gender} onChange={(e) => set('gender', e.target.value as Draft['gender'])}>
              <option>Female</option>
              <option>Male</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Nationality">
            <Input value={d.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </Field>
          <Field label="Passport number">
            <Input value={d.passportNo} onChange={(e) => set('passportNo', e.target.value.toUpperCase())} placeholder="A1234567" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={d.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, City" />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Highest qualification">
            <Input value={d.qualification} onChange={(e) => set('qualification', e.target.value)} placeholder="e.g. B.Tech Computer Science" />
          </Field>
          <Field label="Institution">
            <Input value={d.institution} onChange={(e) => set('institution', e.target.value)} placeholder="e.g. Anna University" />
          </Field>
          <Field label="GPA / Percentage">
            <Input value={d.gpa} onChange={(e) => set('gpa', e.target.value)} placeholder="e.g. 8.2 CGPA" />
          </Field>
          <Field label="Graduation year">
            <Input value={d.graduationYear} onChange={(e) => set('graduationYear', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2024" />
          </Field>
          <Field label="English test">
            <Select value={d.englishTest} onChange={(e) => set('englishTest', e.target.value as Draft['englishTest'])}>
              {['IELTS', 'PTE', 'TOEFL', 'Duolingo', 'Not taken'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Overall score">
            <Input value={d.englishScore} disabled={d.englishTest === 'Not taken'} onChange={(e) => set('englishScore', e.target.value)} placeholder="e.g. 7.0" />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred destinations" className="sm:col-span-2" hint="Select one or more countries.">
            <div className="flex flex-wrap gap-2">
              {COUNTRIES.map((c) => {
                const on = d.preferredCountries.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set('preferredCountries', on ? d.preferredCountries.filter((x) => x !== c) : [...d.preferredCountries, c])}
                    className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition', on ? 'border-rust bg-brand-50 text-rust' : 'border-line text-ink-soft hover:border-navy-200')}
                  >
                    {countryFlag[c]} {c}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Study level">
            <Select value={d.preferredLevel} onChange={(e) => set('preferredLevel', e.target.value as StudyLevel)}>
              {['Foundation', 'Diploma', 'Undergraduate', 'Postgraduate', 'PhD'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Preferred intake">
            <Select value={d.preferredIntake} onChange={(e) => set('preferredIntake', e.target.value)}>
              {INTAKES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </Select>
          </Field>
          <Field label="Annual budget">
            <Select value={d.budget} onChange={(e) => set('budget', e.target.value)}>
              {['$15k – $20k', '$20k – $30k', '$30k – $40k', '$40k+'].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </Field>
          <Field label="Student status">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
              {['Lead', 'Active', 'Enrolled', 'On Hold'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Modal>
  );
}
