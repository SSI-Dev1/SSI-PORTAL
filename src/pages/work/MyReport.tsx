// Daily work report for the employee's designation(s). Figures are generated on the server from
// recorded work (CRM actions + Quick Log) and current workload, and refresh live; the employee
// only writes the summaries and submits. Submitted reports are frozen snapshots.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Lock, PenLine, Save, Send } from 'lucide-react';
import { Alert, Badge, Button, Card, DatePicker, EmptyState, Field, PageHeader, Segmented } from '../../components/ui';
import { MetricActivitiesModal, QuickLogModal, ReportForm, reportTone, type ReportDraft } from '../../components/hr';
import { useConfirm } from '../../components/feedback';
import { useHR } from '../../store/hr';
import { useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDay, type MetricValue } from '../../data/hr';
import { chosenDesignation } from '../../layouts/Sidebar';

const blank = (): ReportDraft => ({ notes: {} });

export default function MyReport() {
  const { data, call, now } = useHR();
  const { session, db } = useStore();
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
  const inFlight = useRef(false);
  const [live, setLive] = useState<Record<string, MetricValue>>({});
  const [showing, setShowing] = useState<{ key: string; label: string } | null>(null);
  const [logFor, setLogFor] = useState<string[] | null>(null);

  // Load the stored summaries when the report (or its server version) changes — never while typing.
  const loadedKey = useRef('');
  useEffect(() => {
    const key = `${templateId}|${date}|${existing?.id ?? 'new'}|${existing?.updatedAt ?? ''}`;
    if (key === loadedKey.current) return;
    loadedKey.current = key;
    const d: ReportDraft = existing ? { notes: { ...existing.notes } } : blank();
    setDraft(d);
    setSaved(JSON.stringify(d));
  }, [templateId, date, existing]);

  // Live figures from the server; re-read whenever recorded work or the CRM changes.
  const refresh = useCallback(async () => {
    if (!supabase || !templateId || !editable) return;
    const { data: m } = await supabase.rpc('report_metrics', { p_template: templateId, p_date: date });
    setLive((m ?? {}) as Record<string, MetricValue>);
  }, [templateId, date, editable]);
  useEffect(() => {
    void refresh();
  }, [refresh, data.activities, db.applications]);

  const metrics: Record<string, MetricValue | number | undefined> = editable ? live : (existing?.metricDetails && Object.keys(existing.metricDetails).length ? existing.metricDetails : existing?.metrics ?? {});
  const dirty = editable && JSON.stringify(draft) !== saved;
  const total = Object.values(metrics).reduce<number>((s, m) => s + (typeof m === 'number' ? m : m?.value ?? 0), 0);

  const save = async (submit: boolean) => {
    if (inFlight.current) return;
    if (submit) {
      const ok = await confirm({
        title: 'Submit this daily report?',
        message: `${fmtDay(date)} · The figures are taken from your recorded work at the moment you submit. After submitting, the report is locked unless your manager requests a correction.`,
        confirmLabel: 'Submit report',
      });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy(true);
    const r = await call('save_daily_report', {
      p_template: templateId, p_date: date, p_metrics: {}, p_notes: draft.notes, p_sources: {}, p_submit: submit,
      p_expected_updated_at: existing?.updatedAt ?? null, p_request_id: crypto.randomUUID(),
    }, { refresh: ['reports'], success: submit ? 'Daily report submitted' : 'Draft saved', successDetail: submit ? 'Your manager can now review it.' : undefined });
    setBusy(false);
    inFlight.current = false;
    if (r.ok) setSaved(JSON.stringify(draft));
  };

  const set = (k: 'template' | 'date', v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    if (k === 'template' && !p.get('date')) p.set('date', date);
    setParams(p, { replace: true });
  };
  const options = useMemo(() => data.myTemplates.map((t) => ({ value: t.id, label: t.designation })), [data.myTemplates]);
  const loggableFor = (fieldKey: string) =>
    (data.metricSources.find((x) => x.templateId === templateId && x.fieldKey === fieldKey)?.activityTypes ?? [])
      .filter((t) => data.activityTypes.find((a) => a.id === t)?.source === 'logged');
  const allLoggable = [...new Set(data.metricSources.filter((x) => x.templateId === templateId).flatMap((x) => x.activityTypes))]
    .filter((t) => data.activityTypes.find((a) => a.id === t)?.source === 'logged');

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
        actions={<>
          {editable && date === today && <Button variant="secondary" icon={PenLine} onClick={() => setLogFor(allLoggable)}>Log work</Button>}
          <Button variant="secondary" onClick={() => navigate(`/${session?.role === 'admin' ? 'admin' : 'staff'}/work/reports`)}>Report history</Button>
        </>}
      />
      <Card className="mb-5 flex flex-wrap items-end gap-4 p-4">
        {options.length > 1 && <Field label="Designation"><Segmented options={options} value={templateId} onChange={(v) => set('template', v)} /></Field>}
        <Field label="Report date"><DatePicker value={date} max={today} clearable={false} onChange={(v) => v && set('date', v)} /></Field>
        <div className="ml-auto flex items-center gap-2">
          {existing ? <Badge tone={reportTone[existing.status]} dot>{existing.status}</Badge> : <Badge tone="slate">Not started</Badge>}
          {dirty && <span className="text-xs text-amber-600">Unsaved summary</span>}
        </div>
      </Card>
      {existing?.status === 'Correction Requested' && existing.reviewComment && (
        <Alert tone="warning" title="Correction requested" className="mb-5">{existing.reviewComment}</Alert>
      )}
      {!editable ? (
        <Alert tone="info" title="Submitted report" className="mb-5"><span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> These are the figures as submitted. Later changes in the CRM do not alter them.</span></Alert>
      ) : (
        <Alert tone="info" className="mb-5">
          Figures fill in automatically from your work in the CRM and anything you log. {total === 0 ? 'Nothing is recorded for this day yet — you can still submit.' : 'Click a figure to see the work behind it.'}
        </Alert>
      )}
      {template ? (
        <ReportForm template={template} draft={draft} onChange={setDraft} readOnly={!editable} metrics={metrics} sources={data.metricSources}
          onShow={(key, label) => setShowing({ key, label })} onLog={date === today ? (key) => setLogFor(loggableFor(key)) : undefined} />
      ) : (
        <Card><EmptyState icon={ClipboardList} title="Choose a report" /></Card>
      )}
      {editable && template && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex justify-end gap-2 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <Button variant="secondary" icon={Save} disabled={busy || !dirty} onClick={() => save(false)}>Save Draft</Button>
          <Button icon={Send} disabled={busy} onClick={() => save(true)}>{busy ? 'Submitting…' : 'Submit Daily Report'}</Button>
        </div>
      )}
      <MetricActivitiesModal open={!!showing} onClose={() => setShowing(null)} label={showing?.label ?? ''} canVoid={editable}
        metric={showing ? (typeof metrics[showing.key] === 'number' ? { value: metrics[showing.key] as number, kind: 'activity' } : (metrics[showing.key] as MetricValue | undefined)) : undefined} />
      <QuickLogModal open={!!logFor} onClose={() => setLogFor(null)} types={logFor ?? []} />
    </>
  );
}
