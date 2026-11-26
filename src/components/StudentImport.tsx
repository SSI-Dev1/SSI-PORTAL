// Import students from the student sheet (0061). The workbook is read in the browser (nothing is
// uploaded or stored as a file), grouped into one student per name / passport with every row as a
// university choice, previewed against the database (agent matching, existing students, conflicts),
// and imported only after confirmation. Re-importing the same sheet adds nothing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Alert, Badge, Button, Field, Modal, Select, Table } from './ui';
import { useToast } from './feedback';
import { useStore } from '../store/store';
import { rpc } from '../lib/agencies';
import { readStudentWorkbook, type ImportGroup, type StudentSheetParse } from '../lib/studentImport';

interface PlanRow { key: string; name: string; agent: string | null; agent_status: 'matched' | 'mapped' | 'chosen' | 'unmapped' | 'ambiguous' | 'missing';
  partner_id: string | null; partner_name: string | null; match: 'new' | 'existing' | 'review'; match_reason: string | null; prefs: number;
  primary: 'ok' | 'conflict' | 'none'; source_rows: number[]; flags: string[]; importable: boolean }
interface Result { students_created: number; students_matched: number; students_updated: number; preferences_created: number; preferences_already_imported: number;
  students_with_primary: number; priority_conflicts: number; skipped: { name: string; rows: number[]; reason: string }[] }

export function canImportStudents(s: { userRole?: string; permissions: string[] } | null) {
  return !!s && (s.userRole === 'super_admin' || (s.userRole === 'admin_staff' && s.permissions.includes('students')));
}

async function sha256(bytes: Uint8Array) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function StudentImportDialog({ onClose }: { onClose: () => void }) {
  const { db, actions } = useStore();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; sha: string } | null>(null);
  const [parse, setParse] = useState<StudentSheetParse | null>(null);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'read' | 'preview' | 'import'>('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const partners = useMemo(() => db.partners.filter((p) => !p.internal && !p.archivedAt).sort((a, b) => a.name.localeCompare(b.name)), [db.partners]);

  const read = async (f: File) => {
    setErr(''); setPlan(null); setResult(null); setBusy('read');
    try {
      if (f.size > 15 * 1024 * 1024) throw new Error('The file is larger than 15 MB.');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const p = readStudentWorkbook(bytes);
      if (p.missingColumns.length === 25) throw new Error('This does not look like the student sheet (no "Student Name" column).');
      setParse(p); setFile({ name: f.name, sha: await sha256(bytes) });
    } catch (e) { setErr((e as Error).message); setParse(null); }
    setBusy('');
  };
  // Preview again whenever the agent choices change (debounced).
  useEffect(() => {
    if (!parse) return;
    let live = true;
    const t = setTimeout(() => {
      setBusy('preview');
      void rpc<{ groups: PlanRow[] }>('preview_student_import', { p_groups: parse.groups, p_agent_map: map }).then((r) => {
        if (!live) return;
        setBusy('');
        if (!r.ok) { setErr(/does not exist|schema cache|0034/.test(r.error) ? 'Run migration 0061 to enable the student import.' : r.error); return; }
        setErr(''); setPlan(r.data.groups);
      });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [parse, map]);

  const agents = useMemo(() => {
    const m = new Map<string, PlanRow>();
    (plan ?? []).forEach((r) => { if (r.agent && !m.has(r.agent)) m.set(r.agent, r); });
    return [...m.values()].sort((a, b) => Number(a.partner_id !== null) - Number(b.partner_id !== null) || (a.agent ?? '').localeCompare(b.agent ?? ''));
  }, [plan]);
  const s = useMemo(() => {
    const p = plan ?? [];
    return {
      existing: p.filter((r) => r.match === 'existing').length, fresh: p.filter((r) => r.match === 'new').length, review: p.filter((r) => r.match === 'review').length,
      unmapped: p.filter((r) => !r.partner_id).length, importable: p.filter((r) => r.importable).length,
      importablePrefs: p.filter((r) => r.importable).reduce((n, r) => n + r.prefs, 0),
    };
  }, [plan]);
  const attention = (plan ?? []).filter((r) => !r.importable || r.primary !== 'ok' || r.flags.length);
  const groupOf = (key: string) => parse?.groups.find((g) => g.key === key) as ImportGroup | undefined;

  const apply = async () => {
    if (!parse || !file) return;
    setBusy('import'); setErr('');
    const r = await rpc<Result>('apply_student_import', { p_groups: parse.groups, p_agent_map: map, p_file_name: file.name, p_sha: file.sha });
    setBusy('');
    if (!r.ok) return setErr(r.error);
    setResult(r.data);
    void actions.reload(['students']);
    toast.success('Students imported', `${r.data.students_created} new · ${r.data.students_matched} matched · ${r.data.preferences_created} university choices`);
  };

  return (
    <Modal open onClose={onClose} size="xl" title="Import students (Excel)" subtitle="Student sheet with university choices — read in your browser, previewed before anything is saved."
      dirty={!!parse && !result}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
        {!result && <Button icon={Upload} disabled={!plan || !s.importable || !!busy} loading={busy === 'import'} onClick={() => void apply()}>
          Import {s.importable} student{s.importable === 1 ? '' : 's'} · {s.importablePrefs} choices</Button>}
      </>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
      {!parse ? (
        <button type="button" onClick={() => input.current?.click()} disabled={busy === 'read'}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-10 text-ink-soft transition hover:border-brand hover:text-rust focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
          <FileSpreadsheet className="h-8 w-8" /><span className="font-semibold">{busy === 'read' ? 'Reading…' : 'Choose the .xlsx file'}</span>
          <span className="text-xs text-ink-mute">25 columns: Sl. No., Student Name, passport number, Agent Name … Remarks</span>
        </button>
      ) : result ? (
        <div className="space-y-3">
          <Alert tone="success" title="Import finished">
            {result.students_created} students created · {result.students_matched} matched to existing students ({result.students_updated} had blank fields filled) ·
            {' '}{result.preferences_created} university choices added{result.preferences_already_imported ? ` · ${result.preferences_already_imported} already imported` : ''} ·
            {' '}{result.students_with_primary} with a primary university · {result.priority_conflicts} priority conflict{result.priority_conflicts === 1 ? '' : 's'} to review.
            No applications, emails or work activities were created.
          </Alert>
          {result.skipped.length > 0 && (
            <Alert tone="warning" title={`${result.skipped.length} not imported — review`}>
              <ul className="mt-1 space-y-0.5">{result.skipped.map((x, i) => <li key={i}>{x.name || '(no name)'} · rows {x.rows.join(', ')} — {x.reason}</li>)}</ul>
            </Alert>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft"><b className="text-heading">{file?.name}</b> · sheet “{parse.sheet}”
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => input.current?.click()}>Choose another file</Button></p>
          {parse.missingColumns.length > 0 && <Alert tone="warning">Columns not found (their values will be empty): {parse.missingColumns.join(', ')}</Alert>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {([['Source rows', parse.totalRows], ['Students', parse.groups.length], ['University choices', parse.stats.preferences], ['Multiple universities', parse.stats.multiUniversity],
               ['Existing matches', plan ? s.existing : '…'], ['New students', plan ? s.fresh : '…'], ['Review (duplicates / matches)', plan ? s.review : '…'],
               ['Agent not mapped', plan ? s.unmapped : '…'], ['Priority conflicts', parse.stats.priorityConflicts], ['Dates kept as text', parse.stats.dateIssues],
               ['Missing critical fields', parse.stats.missingCritical], ['Ready to import', plan ? s.importable : '…']] as [string, number | string][]).map(([l, v]) => (
              <div key={l} className="rounded-xl border border-line bg-surface p-3"><div className="font-display text-lg font-semibold tabular-nums text-heading">{v}</div><div className="text-[11px] text-ink-soft">{l}</div></div>
            ))}
          </div>
          {agents.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-heading">Agents</h4>
              <p className="mb-2 text-xs text-ink-mute">Each agent name is linked to an existing partner. Exact names (case and spaces ignored) and earlier choices are linked automatically; pick the partner for the rest. No partner is created.</p>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
                <Table head={['Agent name in the sheet', 'Partner', '']}>
                  {agents.map((a) => (
                    <tr key={a.agent}>
                      <td className="px-4 py-2 text-sm text-heading">{a.agent}</td>
                      <td className="px-4 py-2">
                        <Select value={map[a.agent!] ?? (a.agent_status === 'matched' || a.agent_status === 'mapped' ? a.partner_id ?? '' : '')} searchable
                          onChange={(e) => setMap((m) => ({ ...m, [a.agent!]: e.target.value }))}>
                          <option value="">Not mapped — hold these students</option>
                          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </td>
                      <td className="px-4 py-2"><Badge tone={a.partner_id ? 'green' : a.agent_status === 'ambiguous' ? 'amber' : 'red'}>
                        {a.agent_status === 'matched' ? 'Same name' : a.agent_status === 'mapped' ? 'Earlier choice' : a.agent_status === 'chosen' ? 'Chosen' : a.agent_status === 'ambiguous' ? 'Several partners' : 'Needs mapping'}</Badge></td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
          {attention.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-heading">Needs attention ({attention.length})</h4>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
                <Table head={['Student', 'Rows', 'Choices', 'Result', 'Notes']}>
                  {attention.map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2 text-sm text-heading">{r.name || '(no name)'}</td>
                      <td className="px-4 py-2 text-xs text-ink-soft">{r.source_rows.join(', ')}</td>
                      <td className="px-4 py-2 text-xs text-ink-soft">{r.prefs}</td>
                      <td className="px-4 py-2"><Badge tone={r.importable ? (r.primary === 'conflict' ? 'amber' : 'blue') : 'red'}>
                        {!r.importable ? 'Held' : r.match === 'existing' ? 'Link existing' : 'Create'}</Badge></td>
                      <td className="px-4 py-2 text-xs text-ink-soft">{[r.match_reason, !r.partner_id ? `Agent not mapped: ${r.agent ?? '(blank)'}` : null,
                        ...(groupOf(r.key)?.flags ?? [])].filter(Boolean).join(' · ')}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
          <Field label="What happens">
            <p className="text-xs text-ink-soft">Priority 1 becomes the primary university; blank rows are other options. Two Priority 1 rows import with no primary and a “Priority conflict” flag. Existing students are matched by passport and only blank fields are filled. Held students are not imported. Nothing is sent and no work activity is recorded.</p>
          </Field>
        </div>
      )}
    </Modal>
  );
}
