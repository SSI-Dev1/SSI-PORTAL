// Daily work report for the employee's designation(s): pick the template and date, fill the
// sections, save a draft or submit. Submitted reports are locked unless a reviewer returns them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Lock, Save, Send } from 'lucide-react';
import { Alert, Badge, Button, Card, DatePicker, EmptyState, Field, PageHeader, Segmented } from '../../components/ui';
import { ReportForm, reportTone, type ReportDraft } from '../../components/hr';
import { useConfirm } from '../../components/feedback';
import { useHR } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDay } from '../../data/hr';
import { chosenDesignation } from '../../layouts/Sidebar';

const blank = (): ReportDraft => ({ metrics: {}, notes: {}, sources: {} });

export default function MyReport() {
  const { data, call, now } = useHR();
  const { session } = useStore();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = companyDate(now());
  const preferred = data.myTemplates.find((t) => t.designationId === chosenDesignation(session ?? null));
  const templateId = params.get('template') ?? preferred?.id ?? data.myTemplates[0]?.id ?? '';
  const date = params.get('date') ?? today;
  const existing = data.reports.find((r) => r.employeeId === session?.userId && r.templateId === templateId && r.reportDate === date);
  // An existing report keeps the template version it was created with.
  const template = existing
    ? data.templates.find((t) => t.id === existing.templateId && t.version === existing.templateVersion)
    : data.myTemplates.find((t) => t.id === templateId);
  const editable = !existing || existing.status === 'Draft' || existing.status === 'Correction Requested';
  const [draft, setDraft] = useState<ReportDraft>(blank);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [crm, setCrm] = useState<Record<string, { label: string; value: number }>>({});
  // Load the stored values when the report (or its server version) changes — never while typing.
  const loadedKey = useRef('');
  useEffect(() => {
    const key = `${templateId}|${date}|${existing?.id ?? 'new'}|${existing?.updatedAt ?? ''}`;
    if (key === loadedKey.current) return;
    loadedKey.current = key;
    const d: ReportDraft = existing ? { metrics: { ...existing.metrics }, notes: { ...existing.notes }, sources: { ...existing.sources } } : blank();
    setDraft(d);
    setSaved(JSON.stringify(d));
  }, [templateId, date, existing]);
  useEffect(() => {
    if (!supabase || !templateId || !editable) return;
    let alive = true;
    void supabase.rpc('report_crm_metrics', { p_template: templateId, p_date: date }).then(({ data: m }) => {
      if (alive) setCrm((m ?? {}) as Record<string, { label: string; value: number }>);
    });
    return () => {
      alive = false;
    };
  }, [templateId, date, editable]);
  const dirty = editable && JSON.stringify(draft) !== saved;

  const save = async (submit: boolean) => {
    if (submit) {
      const ok = await confirm({ title: 'Submit this daily report?', message: `${fmtDay(date)} · After submitting, the report is locked unless your manager requests a correction.`, confirmLabel: 'Submit report' });
      if (!ok) return;
    }
    setBusy(true);
    const metrics = Object.fromEntries(Object.entries(draft.metrics).filter(([, v]) => v != null));
    const r = await call('save_daily_report', {
      p_template: templateId, p_date: date, p_metrics: metrics, p_notes: draft.notes, p_sources: draft.sources, p_submit: submit,
      p_expected_updated_at: existing?.updatedAt ?? null,
    }, { refresh: ['reports'], success: submit ? 'Daily report submitted' : 'Draft saved', successDetail: submit ? 'Your manager can now review it.' : undefined });
    setBusy(false);
    if (r.ok) setSaved(JSON.stringify(draft));
  };

  const set = (k: 'template' | 'date', v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    if (k === 'template' && !p.get('date')) p.set('date', date);
    setParams(p, { replace: true });
  };

  const options = useMemo(() => data.myTemplates.map((t) => ({ value: t.id, label: t.designation })), [data.myTemplates]);
  if (!data.myTemplates.length && !existing) {
    return (
      <>
        <PageHeader title="My Daily Work Report" />
        <Card><EmptyState icon={ClipboardList} title="No report template for your designation" description="Ask HR or Admin to assign your designation." /></Card>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="My Daily Work Report"
        subtitle={template?.name}
        actions={<Button variant="secondary" onClick={() => navigate(`/${session?.role === 'admin' ? 'admin' : 'staff'}/work/reports`)}>Report history</Button>}
      />
      <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
        {options.length > 1 && <Field label="Designation"><Segmented options={options} value={templateId} onChange={(v) => set('template', v)} /></Field>}
        <Field label="Report date"><DatePicker value={date} max={today} clearable={false} onChange={(v) => v && set('date', v)} /></Field>
        <div className="ml-auto flex items-center gap-2">
          {existing ? <Badge tone={reportTone[existing.status]} dot>{existing.status}</Badge> : <Badge tone="slate">New</Badge>}
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>
      </Card>
      {existing?.status === 'Correction Requested' && existing.reviewComment && (
        <Alert tone="warning" title="Correction requested" className="mb-5">{existing.reviewComment}</Alert>
      )}
      {!editable && (
        <Alert tone="info" title="Submitted report" className="mb-5"><span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> This report is locked. Your manager can return it for correction.</span></Alert>
      )}
      {template ? (
        <ReportForm template={template} draft={draft} onChange={setDraft} readOnly={!editable} crm={editable ? crm : undefined} />
      ) : (
        <Card><EmptyState icon={ClipboardList} title="Choose a report" /></Card>
      )}
      {editable && template && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex justify-end gap-2 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <Button variant="secondary" icon={Save} disabled={busy || !dirty} onClick={() => save(false)}>Save Draft</Button>
          <Button icon={Send} disabled={busy} onClick={() => save(true)}>Submit Daily Report</Button>
        </div>
      )}
    </>
  );
}
