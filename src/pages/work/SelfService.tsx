// Employee self-service: My Documents and My Team Members.
// * My Documents: documents HR shared with the employee plus the employee's own uploads (sent to
//   HR as "Pending Review"). Files are private; opening one records the download on the server and
//   uses a 60-second link. The history shows only this employee's own documents (RLS, 0028).
// * My Team Members: department colleagues, manager, peers and own team from my_team_members() —
//   no salaries, documents, leave types or reasons. Managers also see their team's attendance today.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Download, FileText, History, Mail, Palmtree, Sun, Sunset, Upload, Users, XCircle } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, SearchInput, Select, Table, Tabs } from '../../components/ui';
import { KPI, stateTone } from '../../components/hr';
import { useToast } from '../../components/feedback';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { prepareUpload } from '../../lib/files';
import { usePhotoUrls } from '../../lib/photos';
import { openHRDocument } from '../hr/HRWork';
import { EMPLOYEE_UPLOAD_CATEGORIES, fmtDay, serverMessage, type EmployeeDocument, type TeamMember } from '../../data/hr';
import { matches } from '../../lib/utils';

const HR_BUCKET = 'hr-documents';
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const reviewTone = { 'Pending Review': 'amber', Verified: 'green', Rejected: 'red' } as const;
const EVENT: Record<string, string> = { uploaded: 'Uploaded', downloaded: 'Opened / downloaded', shared: 'Shared with you by HR', unshared: 'Sharing stopped', archived: 'Archived', restored: 'Restored', edited: 'Details edited by HR', verified: 'Verified by HR', rejected: 'Rejected by HR' };

export function docStatus(d: EmployeeDocument): { label: string; tone: 'amber' | 'green' | 'red' | 'blue' } {
  if (d.source === 'employee' && d.reviewStatus) return { label: d.reviewStatus, tone: reviewTone[d.reviewStatus] };
  return { label: 'Shared by HR', tone: 'blue' };
}

// ------------------------------------------------------------------ my documents

export function MyDocuments() {
  const { data } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const toast = useToast();
  const me = session?.userId ?? '';
  const [tab, setTab] = useState<'all' | 'hr' | 'mine' | 'history'>('all');
  const [uploading, setUploading] = useState(false);
  const docs = data.documents.filter((d) => d.employeeId === me && d.status === 'Active' && d.visibleToEmployee);
  const shown = docs.filter((d) => tab === 'all' || (tab === 'hr' ? d.source !== 'employee' : d.source === 'employee'));
  const [events, setEvents] = useState<{ id: string; documentId: string; at: string; actor: string | null; action: string }[] | null>(null);
  const key = docs.map((d) => `${d.id}:${d.reviewStatus ?? ''}`).join('|');
  useEffect(() => {
    if (tab !== 'history' || !supabase) return;
    let alive = true;
    void supabase.from('employee_document_events').select('id, document_id, at, actor, action').eq('employee_id', me).order('at', { ascending: false }).limit(200).then(({ data: r }) => {
      if (alive) setEvents(((r ?? []) as { id: number; document_id: string; at: string; actor: string | null; action: string }[]).map((x) => ({ id: String(x.id), documentId: x.document_id, at: x.at, actor: x.actor, action: x.action })));
    });
    return () => { alive = false; };
  }, [tab, me, key]);
  const open = (id: string) => void openHRDocument(id).catch((e) => toast.error('Could not open the document', e instanceof Error ? e.message : undefined));
  const pending = docs.filter((d) => d.reviewStatus === 'Pending Review').length;

  return (
    <>
      <PageHeader title="My Documents" subtitle="Documents HR has shared with you and the documents you have sent to HR. Stored privately — only you and HR can open them."
        actions={<Button icon={Upload} onClick={() => setUploading(true)}>Upload a document</Button>} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KPI icon={FileText} label="Shared by HR" value={docs.filter((d) => d.source !== 'employee').length} onClick={() => setTab('hr')} />
        <KPI icon={Clock} tone="amber" label="Waiting for HR review" value={pending} onClick={() => setTab('mine')} />
        <KPI icon={CheckCircle2} tone="green" label="Verified uploads" value={docs.filter((d) => d.reviewStatus === 'Verified').length} onClick={() => setTab('mine')} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'all', label: 'All', count: docs.length },
        { value: 'hr', label: 'From HR' },
        { value: 'mine', label: 'My uploads', count: pending || undefined },
        { value: 'history', label: 'History' },
      ]} />
      {tab === 'history' ? (
        <Card>
          {events === null ? <p className="p-5 text-sm text-ink-soft">Loading…</p> : events.length === 0 ? <EmptyState icon={History} title="No history yet" /> : (
            <ol className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                  <span><b className="text-heading">{EVENT[e.action] ?? e.action}</b> · <span className="text-ink-soft">{docs.find((d) => d.id === e.documentId)?.title ?? 'Document'}</span></span>
                  <span className="text-xs text-ink-mute">{e.actor === me ? 'You' : e.actor ? lk.name(e.actor) : 'System'} · {new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : shown.length === 0 ? (
        <Card><EmptyState icon={FileText} title={tab === 'mine' ? 'You have not uploaded anything yet' : 'No documents yet'} description={tab === 'mine' ? 'Upload ID proof, certificates or a medical certificate for HR.' : 'Documents HR shares with you appear here.'} /></Card>
      ) : (
        <Card>
          <Table className="hr-table" head={['Document', 'Category', 'Status', 'Added', '']}>
            {shown.map((d) => {
              const st = docStatus(d);
              return (
                <tr key={d.id}>
                  <td className="min-w-[200px]">
                    <div className="font-medium text-heading">{d.title}</div>
                    <div className="text-xs text-ink-mute">{d.fileName} · {kb(d.size)}{d.expiresOn ? ` · expires ${fmtDay(d.expiresOn)}` : ''}</div>
                    {d.reviewStatus === 'Rejected' && d.reviewNote && <div className="mt-0.5 text-xs text-red-600">HR: {d.reviewNote}</div>}
                  </td>
                  <td>{d.category}</td>
                  <td><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td className="whitespace-nowrap">{fmtDay(d.uploadedAt.slice(0, 10))}<div className="text-xs text-ink-mute">{d.source === 'employee' ? 'by you' : 'by HR'}</div></td>
                  <td className="text-right"><Button size="sm" variant="secondary" icon={Download} onClick={() => open(d.id)}>Open</Button></td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
      <SelfUploadModal open={uploading} onClose={() => setUploading(false)} />
    </>
  );
}

function SelfUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { load } = useHR();
  const { session } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ category: 'Identity', title: '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ category: 'Identity', title: '' }); setFile(null); setErr(null); } }, [open]);
  const me = session?.userId;
  const ready = !!me && f.title.trim().length >= 2 && !!file && !busy;
  const submit = async () => {
    if (!ready || !file || !supabase || !me) return;
    setBusy(true);
    setErr(null);
    try {
      const prepared = await prepareUpload(file);
      const id = crypto.randomUUID();
      const path = `${me}/${id}.${prepared.ext}`;
      const up = await supabase.storage.from(HR_BUCKET).upload(path, file, { contentType: prepared.mime, upsert: false });
      if (up.error) throw new Error('The upload was rejected by the server.');
      const res = await supabase.from('employee_documents').insert({
        id, employee_id: me, category: f.category, title: f.title.trim(), file_name: prepared.safeName, size: file.size, mime: prepared.mime,
        storage_path: path, source: 'employee', visible_to_employee: true,
      });
      if (res.error) {
        await supabase.storage.from(HR_BUCKET).remove([path]);
        throw new Error(serverMessage(res.error));
      }
      toast.success('Sent to HR', 'HR will verify it. You are notified of the result.');
      void load(['documents']);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The document could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Upload a document" subtitle="PDF, Word, JPG or PNG up to 10 MB. Only you and HR can see it." dirty={!!file}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Upload} disabled={!ready} onClick={submit}>{busy ? 'Uploading…' : 'Send to HR'}</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Category" required>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {EMPLOYEE_UPLOAD_CATEGORIES.map((c) => <option key={c} value={c}>{c === 'Medical' ? 'Medical certificate' : c}</option>)}
          </Select>
        </Field>
        <Field label="Title" required><Input maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Passport (front page)" /></Field>
        <Field label="File" required>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-4 text-sm text-ink-soft transition hover:border-brand-300 focus-within:ring-2 focus-within:ring-brand-300">
            <Upload className="h-5 w-5 text-rust" />
            <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${kb(file.size)}` : 'Choose a file…'}</span>
            <input type="file" className="sr-only" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} />
          </label>
        </Field>
        <p className="text-xs text-ink-mute">Once sent, a document cannot be changed or deleted by you. If HR rejects it, upload a corrected copy.</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ my team members

const AVAIL: Record<TeamMember['availability'], { label: string; tone: 'green' | 'red' | 'amber'; icon: typeof Sun }> = {
  available: { label: 'Available today', tone: 'green', icon: CheckCircle2 },
  full_leave: { label: 'On leave today', tone: 'red', icon: Palmtree },
  morning_leave: { label: 'Morning leave', tone: 'amber', icon: Sun },
  afternoon_leave: { label: 'Afternoon leave', tone: 'amber', icon: Sunset },
};
const RELATION: Record<TeamMember['relation'], string> = { you: 'You', manager: 'Your manager', 'my team': 'Reports to you', peer: 'Same manager', department: 'Same department' };

export function MyTeamMembers() {
  const { data } = useHR();
  const lk = useHRLookup();
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [view, setView] = useState('');
  const hr = useHR();
  // The dev-only HR harness supplies sample rows instead of calling the server.
  const demo = (hr as { demoTeam?: () => TeamMember[] }).demoTeam;
  const load = useCallback(async () => {
    if (demo) { setRows(demo()); return; }
    if (!supabase) { setRows([]); return; }
    const { data: r, error: e } = await supabase.rpc('my_team_members');
    if (e) { setError(true); setRows([]); return; }
    setError(false);
    setRows(((r ?? []) as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, fullName: x.full_name as string, employeeCode: x.employee_code as string, designationId: x.designation_id as string,
      departmentId: (x.department_id as string | null) ?? null, reportingManagerId: (x.reporting_manager_id as string | null) ?? null,
      managerName: (x.manager_name as string | null) ?? null, workEmail: (x.work_email as string | null) ?? null, photoPath: (x.photo_path as string | null) ?? null,
      relation: x.relation as TeamMember['relation'], availability: x.availability as TeamMember['availability'], attendanceState: (x.attendance_state as TeamMember['attendanceState']) ?? null,
    })));
  }, [demo]);
  // Re-read when leave, attendance or the employee list changes (realtime through the HR store).
  const key = `${data.leaveRequests.map((r) => r.status).join('')}:${data.attendance.length}:${data.attendance[0]?.updatedAt ?? ''}:${data.employees.length}:${data.employees.map((e) => e.updatedAt).join('')}`;
  useEffect(() => { void load(); }, [load, key]);
  const photos = usePhotoUrls((rows ?? []).map((r) => r.photoPath));
  const others = (rows ?? []).filter((r) => r.relation !== 'you');
  const out = others.filter((r) => r.availability !== 'available');
  const reports = others.filter((r) => r.relation === 'my team');
  const shown = useMemo(() => others.filter((r) => matches(q, r.fullName, lk.designation.get(r.designationId)?.name, lk.department.get(r.departmentId ?? '')?.name)
    && (!view || (view === 'out' ? r.availability !== 'available' : r.relation === view))), [others, q, view, lk]);

  const Member = ({ m }: { m: TeamMember }) => {
    const a = AVAIL[m.availability];
    return (
      <Card className="flex flex-col p-4">
        <div className="flex items-start gap-3">
          <Avatar name={m.fullName} size={48} src={m.photoPath ? photos[m.photoPath] : null} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-heading">{m.fullName}</div>
            <div className="truncate text-xs text-ink-soft">{lk.designation.get(m.designationId)?.name ?? m.designationId}</div>
            <div className="truncate text-xs text-ink-mute">{lk.department.get(m.departmentId ?? '')?.name ?? 'No department'}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={a.tone}><a.icon className="h-3 w-3" aria-hidden /> {a.label}</Badge>
          {m.attendanceState && <Badge tone={stateTone[m.attendanceState]}>{m.attendanceState}</Badge>}
          <Badge tone="slate">{RELATION[m.relation]}</Badge>
        </div>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
          <div className="flex items-center gap-1.5 text-ink-soft"><Mail className="h-3.5 w-3.5 shrink-0" />{m.workEmail ? <a className="truncate hover:text-rust hover:underline" href={`mailto:${m.workEmail}`}>{m.workEmail}</a> : '—'}</div>
          <div className="flex items-center gap-1.5 text-ink-soft"><Users className="h-3.5 w-3.5 shrink-0" />Reports to {m.managerName ?? '—'}</div>
        </dl>
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="My Team Members" subtitle="Your department colleagues, your manager and your team, and who is away today. Leave types and reasons are never shown." />
      {error && <Alert tone="warning" className="mb-4">Team members could not be loaded. (Needs migration 0028 on the server.)</Alert>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI icon={Users} label="Team members" value={others.length} onClick={() => setView('')} />
        <KPI icon={CheckCircle2} tone="green" label="Available today" value={others.filter((r) => r.availability === 'available').length} />
        <KPI icon={Palmtree} tone="red" label="Full-day leave" value={others.filter((r) => r.availability === 'full_leave').length} onClick={() => setView('out')} />
        <KPI icon={Sun} tone="amber" label="Half-day leave" value={others.filter((r) => r.availability === 'morning_leave' || r.availability === 'afternoon_leave').length} onClick={() => setView('out')} />
      </div>
      {out.length > 0 && !view && !q && (
        <Card className="mb-5">
          <CardHeader title="Away today" />
          <ul className="flex flex-wrap gap-2 px-5 pb-5">
            {out.map((m) => {
              const a = AVAIL[m.availability];
              return <li key={m.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas py-1 pl-1 pr-3 text-sm"><Avatar name={m.fullName} size={24} src={m.photoPath ? photos[m.photoPath] : null} /><span className="font-medium text-heading">{m.fullName}</span><span className="text-xs text-ink-soft">· {a.label}</span></li>;
            })}
          </ul>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, designation or department…" className="w-full sm:w-72" />
        <FilterSelect label="Show" value={view} onChange={setView} options={[{ value: '', label: 'Everyone' }, { value: 'out', label: 'Away today' }, { value: 'manager', label: 'My manager' },
          ...(reports.length ? [{ value: 'my team', label: 'Reports to me' }] : []), { value: 'peer', label: 'Same manager' }, { value: 'department', label: 'Same department' }]} />
      </div>
      {rows === null ? <Card className="p-6 text-sm text-ink-soft">Loading…</Card> : shown.length === 0 ? <Card><EmptyState icon={Users} title={others.length ? 'Nobody matches' : 'No team members yet'} description={others.length ? undefined : 'Ask HR to set your department and reporting manager.'} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((m) => <Member key={m.id} m={m} />)}</div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ HR: review an employee upload

export function ReviewDocumentModal({ doc, onClose }: { doc: EmployeeDocument | null; onClose: () => void }) {
  const { call } = useHR();
  const lk = useHRLookup();
  const toast = useToast();
  const [note, setNote] = useState('');
  useEffect(() => { if (doc) setNote(''); }, [doc]);
  const decide = async (status: 'Verified' | 'Rejected') => {
    if (!doc) return;
    const r = await call('review_employee_document', { p_id: doc.id, p_status: status, p_note: note.trim() || null }, { refresh: ['documents'], success: status === 'Verified' ? 'Document verified' : 'Document rejected', successDetail: 'The employee was notified.' });
    if (r.ok) onClose();
  };
  return (
    <Modal open={!!doc} onClose={onClose} title="Review document" subtitle={doc ? `${doc.title} · ${lk.name(doc.employeeId)} · ${doc.category}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" icon={XCircle} disabled={note.trim().length < 3} onClick={() => void decide('Rejected')}>Reject</Button>
        <Button icon={CheckCircle2} onClick={() => void decide('Verified')}>Verify</Button></>}>
      <div className="space-y-4">
        <Button variant="secondary" icon={Download} onClick={() => doc && void openHRDocument(doc.id).catch((e) => toast.error('Could not open the document', e instanceof Error ? e.message : undefined))}>Open the file</Button>
        <Field label="Note to the employee" hint="Required when rejecting — say what to correct."><Input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Scan is unreadable, please upload a clearer copy" /></Field>
      </div>
    </Modal>
  );
}
