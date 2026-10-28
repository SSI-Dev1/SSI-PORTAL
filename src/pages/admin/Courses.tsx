import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, Table, usePaged } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { useLookup, useStore } from '../../store/store';
import { INTAKES } from '../../data/seed';
import type { Course, StudyLevel } from '../../data/types';
import { cn, countryFlag, matches, money } from '../../lib/utils';

const LEVELS: StudyLevel[] = ['Foundation', 'Diploma', 'Undergraduate', 'Postgraduate', 'PhD'];

export default function Courses() {
  const { db, actions } = useStore();
  const lk = useLookup();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [uni, setUni] = useState(params.get('university') ?? '');
  const [level, setLevel] = useState('');
  const [field, setField] = useState('');
  const [editing, setEditing] = useState<Course | null>(null);
  const [open, setOpen] = useState(false);

  const fields = [...new Set(db.courses.map((c) => c.field))].sort();
  const rows = useMemo(
    () =>
      db.courses
        .filter((c) => matches(q, c.name, c.field, lk.university.get(c.universityId)?.name))
        .filter((c) => !uni || c.universityId === uni)
        .filter((c) => !level || c.level === level)
        .filter((c) => !field || c.field === field),
    [db.courses, q, uni, level, field, lk],
  );
  const paged = usePaged(rows, 12, `${q}${uni}${level}${field}`);

  return (
    <>
      <PageHeader title="Courses" subtitle={`${db.courses.length} programmes across ${db.universities.length} providers.`} actions={<Button icon={Plus} onClick={() => { setEditing(null); setOpen(true); }}>Add Course</Button>} />
      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search courses…" className="lg:w-80" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            <FilterSelect label="All providers" value={uni} onChange={setUni} options={db.universities.map((u) => ({ value: u.id, label: u.name }))} />
            <FilterSelect label="All levels" value={level} onChange={setLevel} options={LEVELS} />
            <FilterSelect label="All fields" value={field} onChange={setField} options={fields} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={BookOpen} title="No courses found" />
        ) : (
          <>
            <Table head={['Course', 'Provider', 'Level', 'Duration', 'Tuition / yr', 'Intakes', 'Min. IELTS', '']}>
              {paged.rows.map((c) => {
                const u = lk.university.get(c.universityId);
                return (
                  <tr key={c.id} className="hover:bg-brand-50/30">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-heading">{c.name}</div>
                      <div className="text-xs text-ink-mute">{c.field}</div>
                    </td>
                    <td className="px-5 py-3.5 text-ink-soft">{countryFlag[u?.country ?? '']} {u?.name}</td>
                    <td className="px-5 py-3.5"><Badge tone={c.level === 'Postgraduate' ? 'navy' : c.level === 'Undergraduate' ? 'orange' : 'slate'}>{c.level}</Badge></td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{c.duration}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-semibold text-heading">{money(c.tuition, c.currency)}</td>
                    <td className="px-5 py-3.5 text-xs text-ink-soft">{c.intakes.join(', ')}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{c.ieltsMin}</td>
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <button type="button" aria-label="Edit course" onClick={() => { setEditing(c); setOpen(true); }} className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-heading"><Pencil className="h-4 w-4" /></button>
                      <button
                        type="button"
                        aria-label="Delete course"
                        onClick={async () => {
                          if (await confirm({ title: 'Delete course?', message: c.name, danger: true, confirmLabel: 'Delete' })) {
                            actions.removeCourse(c.id);
                            toast.success('Course deleted');
                          }
                        }}
                        className="rounded-lg p-1.5 text-ink-mute hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="courses" />
          </>
        )}
      </Card>
      <CourseForm open={open} onClose={() => setOpen(false)} course={editing} />
    </>
  );
}

function CourseForm({ open, onClose, course }: { open: boolean; onClose: () => void; course: Course | null }) {
  const { db, actions } = useStore();
  const toast = useToast();
  const init = (): Omit<Course, 'id'> =>
    course ?? { universityId: db.universities[0]?.id ?? '', name: '', level: 'Postgraduate', field: 'Business & Management', duration: '2 years', tuition: 30000, currency: 'AUD', intakes: ['Jul 2026'], ieltsMin: 6.5 };
  const [d, setD] = useState(init);
  useEffect(() => {
    if (open) setD(init());
  }, [open, course]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (d.name.trim().length < 3 || !d.universityId || d.tuition <= 0 || !d.intakes.length) return toast.error('Name, provider, tuition and at least one intake are required');
    if (course) actions.updateCourse(course.id, d);
    else actions.addCourse(d);
    toast.success(course ? 'Course updated' : 'Course added', d.name);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={course ? 'Edit course' : 'Add course'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save course</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course name" required className="sm:col-span-2"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Provider" required>
          <Select value={d.universityId} onChange={(e) => setD({ ...d, universityId: e.target.value })}>{db.universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        </Field>
        <Field label="Level"><Select value={d.level} onChange={(e) => setD({ ...d, level: e.target.value as StudyLevel })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
        <Field label="Field of study"><Input value={d.field} onChange={(e) => setD({ ...d, field: e.target.value })} /></Field>
        <Field label="Duration"><Input value={d.duration} onChange={(e) => setD({ ...d, duration: e.target.value })} /></Field>
        <Field label="Tuition / year" required><Input type="number" value={d.tuition} onChange={(e) => setD({ ...d, tuition: Number(e.target.value) })} /></Field>
        <Field label="Currency"><Select value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value })}>{['AUD', 'GBP', 'CAD', 'USD', 'NZD', 'EUR'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Min. IELTS"><Input type="number" step="0.5" value={d.ieltsMin} onChange={(e) => setD({ ...d, ieltsMin: Number(e.target.value) })} /></Field>
        <Field label="Intakes" required className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {INTAKES.map((i) => {
              const on = d.intakes.includes(i);
              return (
                <button key={i} type="button" onClick={() => setD({ ...d, intakes: on ? d.intakes.filter((x) => x !== i) : [...d.intakes, i] })} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', on ? 'border-rust bg-brand-50 text-rust' : 'border-line text-ink-soft')}>
                  {i}
                </button>
              );
            })}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
