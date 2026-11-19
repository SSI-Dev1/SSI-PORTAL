// Log Student Activity (0056): course / university options suggested, offer follow-up, case closure
// and notes, stored under the student (and the application where it applies). Report credit happens
// on the server: options suggested, completed offer follow-ups and a case closure (once per application).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, X } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, Modal, Select, Textarea } from './ui';
import { useToast } from './feedback';
import { useStore } from '../store/store';
import { supabase } from '../auth/auth';
import { fmtDate, fmtWhen, today } from '../lib/agencies';
import { leadRpc } from '../lib/leads';
import type { Application } from '../data/types';

type Kind = 'course_options' | 'offer_followup' | 'case_closed' | 'note';
const KIND: Record<Kind, string> = { course_options: 'University / course options suggested', offer_followup: 'Offer follow-up', case_closed: 'Case closure', note: 'Note' };
const OUTCOME: Record<string, string> = { completed: 'Completed', pending: 'Pending', no_response: 'No response', withdrawn: 'Withdrawn', refused: 'Refused', deferred: 'Deferred' };
interface Row { id: number; student_id: string; application_id: string | null; kind: Kind; outcome: string | null; note: string | null; detail: { options?: { university_id: string; course_id: string | null }[] }; completed_on: string | null; employee_id: string | null; at: string }

function useStudentActivities(studentId: string) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!supabase) return setRows([]);
    const { data, error: e } = await supabase.from('student_activities').select('*').eq('student_id', studentId).order('at', { ascending: false }).limit(200);
    if (e) { setError(/student_activities|schema cache/.test(e.message) ? 'Run migration 0056 to enable student activities.' : 'Activities could not be loaded.'); return; }
    setError(''); setRows((data ?? []) as Row[]);
  }, [studentId]);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const sb = supabase;
    const ch = sb.channel(`stu-act-${studentId}-${Math.random().toString(36).slice(2, 6)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_activities', filter: `student_id=eq.${studentId}` }, () => void load()).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [load, studentId]);
  return { rows, error };
}

export function StudentActivityCard({ studentId, apps }: { studentId: string; apps: Application[] }) {
  const { db, session } = useStore();
  const { rows, error } = useStudentActivities(studentId);
  const [open, setOpen] = useState(false);
  const uni = (id: string) => db.universities.find((u) => u.id === id)?.name ?? 'University';
  const course = (id: string | null) => (id ? db.courses.find((c) => c.id === id)?.name ?? 'Course' : null);
  const staffName = (id: string | null) => (id ? db.staff.find((s) => s.id === id)?.fullName ?? (id === session?.userId ? session?.name : 'Employee') : '—');
  const appRef = (id: string | null) => (id ? apps.find((a) => a.id === id)?.ref ?? 'Application' : null);
  return (
    <Card className="lg:col-span-3">
      <CardHeader title="Student activity" subtitle="Options suggested, offer follow-ups and case closures logged by the team."
        action={<Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Log Student Activity</Button>} />
      <div className="px-5 pb-5">
        {error && <Alert tone="warning">{error}</Alert>}
        {!rows ? <p className="text-sm text-ink-soft" role="status">Loading…</p> : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nothing logged yet" description="Log the options you share with the student and offer follow-ups here." />
        ) : (
          <ol className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-heading">{KIND[r.kind]}
                  {r.outcome && <Badge tone={r.outcome === 'completed' ? 'green' : 'amber'}>{OUTCOME[r.outcome] ?? r.outcome}</Badge>}
                  {appRef(r.application_id) && <span className="text-xs text-ink-mute">{appRef(r.application_id)}</span>}</div>
                {r.detail?.options?.length ? (
                  <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">{r.detail.options.map((o, i) => <li key={i}>{uni(o.university_id)}{course(o.course_id) ? ` — ${course(o.course_id)}` : ''}</li>)}</ul>
                ) : null}
                {r.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">{r.note}</p>}
                <div className="mt-1 text-xs text-ink-mute">{staffName(r.employee_id)} · {fmtWhen(r.at)}{r.completed_on ? ` · completed ${fmtDate(r.completed_on)}` : ''}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
      {open && <LogStudentActivity studentId={studentId} apps={apps} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function LogStudentActivity({ studentId, apps, onClose }: { studentId: string; apps: Application[]; onClose: () => void }) {
  const { db } = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('course_options');
  const [app, setApp] = useState(apps[0]?.id ?? '');
  const [outcome, setOutcome] = useState('completed');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(today());
  const [opts, setOpts] = useState<{ university_id: string; course_id: string }[]>([{ university_id: '', course_id: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [req] = useState(() => crypto.randomUUID());
  const unis = useMemo(() => [...db.universities].sort((a, b) => a.name.localeCompare(b.name)), [db.universities]);
  const needsApp = kind === 'offer_followup' || kind === 'case_closed';
  const outcomes = kind === 'case_closed' ? ['completed', 'withdrawn', 'refused', 'deferred'] : ['completed', 'pending', 'no_response'];
  const save = async () => {
    setErr('');
    const options = opts.filter((o) => o.university_id);
    if (kind === 'course_options' && !options.length) return setErr('Choose at least one university.');
    if (needsApp && !app) return setErr('Choose the application.');
    if (kind === 'note' && !note.trim()) return setErr('Write the note.');
    setBusy(true);
    const r = await leadRpc('log_student_activity', { p_student: studentId, p_application: needsApp ? app : null, p_kind: kind, p_outcome: needsApp ? outcome : null,
      p_note: note || null, p_options: kind === 'course_options' ? options : null, p_completed: kind === 'note' ? null : done || null, p_request: req });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success('Activity logged', kind === 'course_options' ? 'Counted as options suggested.' : kind === 'offer_followup' && outcome === 'completed' ? 'Counted as a completed offer follow-up.' : undefined);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Log Student Activity" size="lg" dirty={!!note || opts.some((o) => o.university_id)}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} loading={busy} onClick={() => void save()}>Save</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <div className="space-y-4">
        <Field label="Activity"><Select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setOutcome('completed'); }}>
          {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</Select></Field>
        {needsApp && (apps.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Application" required><Select value={app} onChange={(e) => setApp(e.target.value)}>
              {apps.map((a) => <option key={a.id} value={a.id}>{`${a.ref} · ${a.status}`}</option>)}</Select></Field>
            <Field label="Outcome" required><Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {outcomes.map((o) => <option key={o} value={o}>{OUTCOME[o]}</option>)}</Select></Field>
          </div>
        ) : <Alert tone="info">This student has no application yet.</Alert>)}
        {kind === 'case_closed' && <p className="text-xs text-ink-mute">Records the closure of this case for the report. The application's own status is not changed.</p>}
        {kind === 'course_options' && (
          <div className="space-y-2">
            {opts.map((o, i) => {
              const courses = db.courses.filter((c) => c.universityId === o.university_id);
              return (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label={i === 0 ? 'University' : undefined}><Select searchable value={o.university_id} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { university_id: e.target.value, course_id: '' } : x)))}>
                    <option value="">Choose university…</option>{unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
                  <Field label={i === 0 ? 'Course (optional)' : undefined}><Select searchable value={o.course_id} disabled={!o.university_id} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, course_id: e.target.value } : x)))}>
                    <option value="">Any course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                  <div className="flex items-end">{opts.length > 1 && <Button size="sm" variant="ghost" icon={X} aria-label="Remove option" onClick={() => setOpts(opts.filter((_, j) => j !== i))} />}</div>
                </div>
              );
            })}
            {opts.length < 20 && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpts([...opts, { university_id: '', course_id: '' }])}>Add another option</Button>}
          </div>
        )}
        {kind !== 'note' && <Field label="Completion date"><DatePicker value={done} onChange={setDone} max={today()} /></Field>}
        <Field label={kind === 'note' ? 'Note' : 'Details'} required={kind === 'note'}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} /></Field>
      </div>
    </Modal>
  );
}
