import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, FilePlus2, Plus, Search, XCircle } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, SearchInput, Select, Tabs, Textarea } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { useLookup, useScoped, useStore } from '../../store/store';
import type { Assessment, AssessmentStatus } from '../../data/types';
import { countryFlag, formatDate, fullName, matches, timeAgo, type Tone } from '../../lib/utils';

const tone: Record<AssessmentStatus, Tone> = { Pending: 'amber', 'In Review': 'blue', Eligible: 'green', 'Not Eligible': 'red' };

export default function Assessments() {
  const scoped = useScoped();
  const lk = useLookup();
  const { actions } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<'all' | AssessmentStatus>('all');
  const [q, setQ] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [review, setReview] = useState<Assessment>();
  const [appFor, setAppFor] = useState<Assessment>();

  const rows = useMemo(
    () =>
      scoped.assessments
        .filter((a) => tab === 'all' || a.status === tab)
        .filter((a) => matches(q, fullName(lk.student.get(a.studentId)), lk.course.get(a.courseId)?.name))
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    [scoped.assessments, tab, q, lk],
  );
  const count = (s: AssessmentStatus) => scoped.assessments.filter((a) => a.status === s).length;

  return (
    <>
      <PageHeader
        title="Assessments"
        subtitle={scoped.isAdmin ? 'Review eligibility requests from partners before applications are lodged.' : 'Request an eligibility check before applying.'}
        actions={<Button icon={Plus} onClick={() => setRequestOpen(true)}>Request Assessment</Button>}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: scoped.assessments.length },
          { value: 'Pending', label: 'Pending', count: count('Pending') },
          { value: 'In Review', label: 'In Review', count: count('In Review') },
          { value: 'Eligible', label: 'Eligible', count: count('Eligible') },
          { value: 'Not Eligible', label: 'Not Eligible', count: count('Not Eligible') },
        ]}
      />
      <div className="mb-5 max-w-md">
        <SearchInput value={q} onChange={setQ} placeholder="Search student or course…" />
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardCheck} title="No assessments here" description="Request an assessment to check a student’s eligibility." action={<Button icon={Plus} onClick={() => setRequestOpen(true)}>Request Assessment</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => {
            const s = lk.student.get(a.studentId);
            const c = lk.course.get(a.courseId);
            const u = c && lk.university.get(c.universityId);
            return (
              <Card key={a.id} hover className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={fullName(s)} size={40} />
                  <div className="min-w-0 flex-1">
                    <Link to={`${scoped.base}/students/${a.studentId}`} className="block truncate font-semibold text-heading hover:text-rust">
                      {fullName(s)}
                    </Link>
                    <div className="text-xs text-ink-mute">
                      Requested {timeAgo(a.requestedAt)}
                      {scoped.isAdmin && ` · ${lk.partner.get(a.partnerId)?.code}`}
                    </div>
                  </div>
                  <Badge tone={tone[a.status]} dot>
                    {a.status}
                  </Badge>
                </div>
                <div className="mt-4 rounded-xl bg-canvas p-3">
                  <div className="truncate text-sm font-semibold text-heading">{c?.name}</div>
                  <div className="truncate text-xs text-ink-soft">
                    {countryFlag[u?.country ?? '']} {u?.name}
                  </div>
                  <div className="mt-1.5 text-xs text-ink-mute">
                    Min. IELTS {c?.ieltsMin} · Student: {s?.englishTest} {s?.englishScore || '—'}
                  </div>
                </div>
                {a.notes && <p className="mt-3 text-[13px] text-ink-soft">“{a.notes}”</p>}
                <div className="mt-auto flex gap-2 pt-4">
                  {scoped.isAdmin && (a.status === 'Pending' || a.status === 'In Review') && (
                    <Button size="sm" variant="navy" icon={Search} onClick={() => setReview(a)} className="flex-1">
                      Review
                    </Button>
                  )}
                  {a.status === 'Eligible' && (
                    <Button size="sm" icon={FilePlus2} onClick={() => setAppFor(a)} className="flex-1">
                      Create application
                    </Button>
                  )}
                  {!scoped.isAdmin && (a.status === 'Pending' || a.status === 'In Review') && (
                    <span className="text-xs text-ink-mute">SSI Admissions is reviewing this request.</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
      <ReviewModal assessment={review} onClose={() => setReview(undefined)} onDone={(s) => { actions.setAssessmentStatus(review!.id, s.status, s.notes); toast.success(`Marked ${s.status}`, fullName(lk.student.get(review!.studentId))); setReview(undefined); }} />
      <ApplicationForm open={!!appFor} onClose={() => setAppFor(undefined)} studentId={appFor?.studentId} courseId={appFor?.courseId} />
    </>
  );
}

function RequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scoped = useScoped();
  const { actions } = useStore();
  const toast = useToast();
  const [student, setStudent] = useState('');
  const [course, setCourse] = useState('');
  const submit = () => {
    if (!student || !course) return toast.error('Select a student and a course');
    const s = scoped.students.find((x) => x.id === student)!;
    actions.addAssessment({ studentId: student, partnerId: s.partnerId, courseId: course });
    toast.success('Assessment requested', 'SSI Admissions will review shortly.');
    setStudent('');
    setCourse('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Request assessment" subtitle="Check eligibility for a specific course." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Submit request</Button></>}>
      <div className="space-y-4">
        <Field label="Student" required>
          <Select value={student} onChange={(e) => setStudent(e.target.value)}>
            <option value="">Select student…</option>
            {scoped.students.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Course" required>
          <Select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">Select course…</option>
            {scoped.universities.map((u) => (
              <optgroup key={u.id} label={`${u.name} (${u.country})`}>
                {scoped.courses
                  .filter((c) => c.universityId === u.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function ReviewModal({ assessment, onClose, onDone }: { assessment?: Assessment; onClose: () => void; onDone: (r: { status: AssessmentStatus; notes: string }) => void }) {
  const lk = useLookup();
  const [notes, setNotes] = useState('');
  if (!assessment) return null;
  const s = lk.student.get(assessment.studentId);
  const c = lk.course.get(assessment.courseId);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Review — ${fullName(s)}`}
      subtitle={c?.name}
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone({ status: 'In Review', notes })}>
            Mark in review
          </Button>
          <Button variant="danger" icon={XCircle} onClick={() => onDone({ status: 'Not Eligible', notes: notes || 'Does not meet entry requirements.' })}>
            Not eligible
          </Button>
          <Button icon={CheckCircle2} onClick={() => onDone({ status: 'Eligible', notes: notes || 'Meets academic and English requirements.' })}>
            Eligible
          </Button>
        </>
      }
    >
      <dl className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-canvas p-4 text-sm">
        <div><dt className="text-xs text-ink-mute">Qualification</dt><dd className="font-medium text-heading">{s?.qualification}</dd></div>
        <div><dt className="text-xs text-ink-mute">GPA</dt><dd className="font-medium text-heading">{s?.gpa}</dd></div>
        <div><dt className="text-xs text-ink-mute">English</dt><dd className="font-medium text-heading">{s?.englishTest} {s?.englishScore}</dd></div>
        <div><dt className="text-xs text-ink-mute">Course min. IELTS</dt><dd className="font-medium text-heading">{c?.ieltsMin}</dd></div>
        <div><dt className="text-xs text-ink-mute">Requested</dt><dd className="font-medium text-heading">{formatDate(assessment.requestedAt)}</dd></div>
      </dl>
      <Field label="Assessment notes" hint="Shared with the partner.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Eligible with 6.5 IELTS; submit final transcripts." />
      </Field>
    </Modal>
  );
}
