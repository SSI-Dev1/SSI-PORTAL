// Daily work report for the employee's designation(s). Figures are generated on the server from
// recorded work (CRM actions + Quick Log) and current workload, and refresh live; the employee
// only writes the summaries and submits. Submitted reports are frozen snapshots.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ClipboardList, FileDown, Hourglass, Lock, PenLine, Send, Sparkles } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, PageHeader, Segmented } from '../../components/ui';
import { WorkTimeline, useWorkTimeline } from '../../components/WorkTimeline';
import { printReportPdf } from '../../lib/reportPdf';
import { MetricActivitiesModal, QuickLogModal, reportTone, type ReportDraft } from '../../components/hr';
import { useConfirm } from '../../components/feedback';
import { useHR } from '../../store/hr';
import { useStore } from '../../store/store';
import { rpc } from '../../lib/agencies';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDay, type MetricValue } from '../../data/hr';
import { chosenDesignation } from '../../layouts/Sidebar';
import { TASK_KIND, agencyAccess, fmtDate, fmtTime, type PendingWork } from '../../lib/agencies';

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
  // Completed work (activities) and open work (pending / workload) are never added together.
  const kindOf = (m: MetricValue | number | undefined) => (typeof m === 'number' ? 'activity' : m?.kind ?? 'activity');
  const valueOf = (m: MetricValue | number | undefined) => (typeof m === 'number' ? m : m?.value ?? 0);
  const completed = Object.values(metrics).filter((m) => kindOf(m) === 'activity').reduce<number>((n, m) => n + valueOf(m), 0);
  const openWork = Object.values(metrics).filter((m) => kindOf(m) !== 'activity').reduce<number>((n, m) => n + valueOf(m), 0);
  const labelOf = (key: string) => template?.sections.flatMap((x) => x.fields).find((f) => f.key === key)?.label ?? key;
  const top = Object.entries(metrics).filter(([, m]) => kindOf(m) === 'activity' && valueOf(m) > 0).sort((a, b) => valueOf(b[1]) - valueOf(a[1])).slice(0, 3);
  const timeline = useWorkTimeline(date, undefined, data.activities);
  const manualCount = (timeline.rows ?? []).filter((r) => r.manual && !r.voided).length;
  const me = data.directory.find((d) => d.id === session?.userId);
  const department = data.departments.find((d) => d.id === me?.departmentId)?.name;

  // The full report (every figure, the timeline, pending work and any written summary) as a PDF.
  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async () => {
    if (!template) return;
    setPdfBusy(true);
    let pending: PendingWork | null = null;
    if (agencyAccess(session ?? null) && supabase) {
      const { data: w } = await supabase.rpc('my_pending_work', { p_date: date });
      pending = (w ?? null) as PendingWork | null;
    }
    printReportPdf({
      employee: session?.name ?? 'Employee', designation: options.find((o) => o.value === templateId)?.label ?? template.name, department: department ?? null,
      date, dateLabel: fmtDay(date), status: existing?.status ?? 'Not submitted', submittedAt: existing?.submittedAt ?? null, templateName: template.name,
      sections: template.sections.map((sec) => ({
        title: sec.title,
        counts: sec.fields.filter((f) => f.type === 'count').map((f) => ({ label: f.label, value: valueOf(metrics[f.key]), kind: kindOf(metrics[f.key]) })),
        texts: sec.fields.filter((f) => f.type === 'text').map((f) => ({ label: f.label, value: (editable ? draft.notes[f.key] : existing?.notes?.[f.key]) ?? '' })),
      })),
      completed, openWork,
      timeline: (timeline.rows ?? []).filter((r) => !r.voided),
      pending: pending ? [
        ...pending.tasks.filter((t) => t.due_date <= date).map((t) => ({ title: `${TASK_KIND[t.kind]} · ${t.agency}`, when: fmtDate(t.due_date), overdue: t.overdue })),
        ...pending.linkedin.map((l) => ({ title: `LinkedIn follow-up · ${l.name}`, when: fmtDate(l.due_date), overdue: l.overdue })),
      ] : [],
    });
    setPdfBusy(false);
  };

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
        title="Daily Work Report"
        subtitle={template?.name}
        actions={<>
          {editable && date === today && <Button variant="secondary" icon={PenLine} onClick={() => setLogFor([...allLoggable, 'manual_work'])}>Add manual activity</Button>}
          <Button variant="secondary" icon={FileDown} disabled={!template || pdfBusy} loading={pdfBusy} onClick={() => void downloadPdf()}>Download PDF</Button>
          <Button variant="secondary" onClick={() => navigate(`/${session?.role === 'admin' ? 'admin' : 'staff'}/work/reports`)}>Report history</Button>
        </>}
      />
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 border-b border-line bg-gradient-to-r from-navy to-[#0b3445] px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold">{session?.name ?? 'Employee'}</div>
            <div className="text-sm text-white/75">{[options.find((o) => o.value === templateId)?.label ?? template?.name, department].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {existing ? <Badge tone={reportTone[existing.status]} dot>{existing.status}</Badge> : <Badge tone="slate">Not submitted</Badge>}
            {dirty && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200">Unsaved summary</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4 p-4">
          {options.length > 1 && <Field label="Designation"><Segmented options={options} value={templateId} onChange={(v) => set('template', v)} /></Field>}
          <Field label="Reporting date"><DatePicker value={date} max={today} clearable={false} onChange={(v) => v && set('date', v)} /></Field>
          <p className="ml-auto max-w-sm text-xs text-ink-mute">{fmtDay(date)} · Asia/Kolkata. Work counts on the day it was done, never on the day it was imported or edited.</p>
        </div>
      </Card>

      <section aria-label="Today's work summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat icon={CheckCircle2} tone="green" label="Activities completed" value={completed} hint="Your recorded work on this day" />
        <SummaryStat icon={Hourglass} tone="amber" label="Open / pending work" value={openWork} hint="Current queue — not completed work" />
        <SummaryStat icon={CalendarClock} tone="navy" label="Timeline entries" value={(timeline.rows ?? []).filter((r) => !r.voided).length} hint={manualCount ? `${manualCount} manual` : 'All automatic'} />
        <SummaryStat icon={Sparkles} tone="orange" label={top[0] ? labelOf(top[0][0]) : 'Top activity'} value={top[0] ? valueOf(top[0][1]) : 0}
          hint={top.slice(1).map(([k, m]) => `${labelOf(k)} ${valueOf(m)}`).join(' · ') || 'Nothing recorded yet'} />
      </section>
      {session?.permissions.includes('partner_success') && <PortfolioDay date={date} />}
      {existing?.status === 'Correction Requested' && existing.reviewComment && (
        <Alert tone="warning" title="Correction requested" className="mb-5">{existing.reviewComment}</Alert>
      )}
      {!editable ? (
        <Alert tone="info" title="Submitted report" className="mb-5"><span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> These are the figures as submitted. Later changes in the CRM do not alter them.</span></Alert>
      ) : (
        <Alert tone="info" className="mb-5">
          Your report fills in automatically from your work in the CRM and anything you log. {total === 0 ? 'Nothing is recorded for this day yet — you can still submit.' : 'Download PDF gives the full report with every figure.'}
        </Alert>
      )}
      <div className="mb-5 grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3"><WorkTimeline rows={timeline.rows} error={timeline.error} onRetry={() => void timeline.reload()} /></div>
        <div className="xl:col-span-2">{agencyAccess(session ?? null) ? <PendingWorkCard date={date} rev={data.activities} /> : (
          <Card><CardHeader title="Pending work" subtitle="Open items count in the report heads below; they are not completed work." />
            <p className="px-5 pb-5 text-sm text-ink-soft">{openWork ? `${openWork} open item${openWork === 1 ? '' : 's'} in your queue.` : 'Nothing pending.'}</p></Card>
        )}</div>
      </div>

      {editable && template && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex justify-end gap-2 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <Button icon={Send} disabled={busy} onClick={() => save(true)}>{busy ? 'Submitting…' : 'Submit Daily Report'}</Button>
        </div>
      )}
      <MetricActivitiesModal open={!!showing} onClose={() => setShowing(null)} label={showing?.label ?? ''} canVoid={editable}
        metric={showing ? (typeof metrics[showing.key] === 'number' ? { value: metrics[showing.key] as number, kind: 'activity' } : (metrics[showing.key] as MetricValue | undefined)) : undefined} />
      <QuickLogModal open={!!logFor} onClose={() => setLogFor(null)} types={logFor ?? []} />
    </>
  );
}

/** Partner Success: outcomes through the officer's clients on this day — not personal work, not part of the report figures. */
function PortfolioDay({ date }: { date: string }) {
  const [d, setD] = useState<{ agencies: number; applications: number; offers: number } | null>(null);
  useEffect(() => {
    let live = true;
    void rpc<{ agencies: number; applications: number; offers: number }>('portfolio_day', { p_date: date }).then((r) => { if (live) setD(r.ok ? r.data : null); });
    return () => { live = false; };
  }, [date]);
  if (!d) return null;
  return (
    <Card className="mb-5 p-4">
      <div className="text-sm font-semibold text-heading">Through my assigned clients · {date}</div>
      <p className="text-xs text-ink-mute">Applications and first offers at the clients you are Sub Officer for. Shown for information — they are not your personal work and are not added to the report figures below.</p>
      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <span><b className="text-lg text-heading">{d.agencies}</b> assigned clients</span>
        <span><b className="text-lg text-heading">{d.applications}</b> applications created</span>
        <span><b className="text-lg text-heading">{d.offers}</b> offers received</span>
      </div>
    </Card>
  );
}

function SummaryStat({ icon: Icon, label, value, hint, tone }: { icon: typeof CheckCircle2; label: string; value: number; hint?: string; tone: 'green' | 'amber' | 'navy' | 'orange' }) {
  const tones = { green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    navy: 'bg-navy/5 text-navy dark:bg-white/10 dark:text-white', orange: 'bg-orange-50 text-rust dark:bg-orange-500/10 dark:text-orange-300' };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <div className="font-display text-2xl font-semibold tabular-nums text-heading">{value}</div>
          <div className="truncate text-xs font-medium text-ink-soft" title={label}>{label}</div>
        </div>
      </div>
      {hint && <div className="mt-2 truncate text-[11px] text-ink-mute" title={hint}>{hint}</div>}
    </Card>
  );
}

/** Open agency follow-ups, meetings, visits and LinkedIn follow-ups — carried forward until done, never counted as completed. */
function PendingWorkCard({ date, rev }: { date: string; rev: unknown }) {
  const [w, setW] = useState<PendingWork | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!supabase) return;
    void supabase.rpc('my_pending_work', { p_date: date }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setFailed(true); return; }
      setFailed(false); setW((data ?? null) as PendingWork | null);
    });
    return () => { alive = false; };
  }, [date, rev]);
  const items = w ? [
    ...w.tasks.filter((t) => t.due_date <= date).map((t) => ({ key: `t${t.id}`, title: `${TASK_KIND[t.kind]} · ${t.agency}`, when: `${fmtDate(t.due_date)}${t.due_time ? ` ${fmtTime(t.due_time)}` : ''}`, overdue: t.overdue })),
    ...w.linkedin.map((l) => ({ key: `l${l.id}`, title: `LinkedIn follow-up · ${l.name}`, when: fmtDate(l.due_date), overdue: l.overdue })),
  ] : [];
  return (
    <Card>
      <CardHeader title="Pending work" subtitle="Carried forward with the original due date until completed" />
      <div className="px-5 pb-5">
        {failed ? <p className="text-sm text-amber-700 dark:text-amber-300">Pending work could not be loaded.</p>
          : !w ? <p className="text-sm text-ink-soft" role="status">Loading…</p>
          : items.length === 0 && !w.not_connected && !w.open_attempts ? <p className="text-sm text-ink-soft">Nothing pending. </p>
          : (
            <ul className="space-y-2 text-sm">
              {items.slice(0, 12).map((i) => (
                <li key={i.key} className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="text-heading">{i.title}</span>
                  <span className={`shrink-0 text-xs ${i.overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-ink-mute'}`}>{i.overdue ? 'Overdue · ' : ''}{i.when}</span>
                </li>
              ))}
              {items.length > 12 && <li className="text-xs text-ink-mute">+ {items.length - 12} more</li>}
              {!!w.not_connected && <li className="text-xs text-ink-soft">{w.not_connected} agenc{w.not_connected === 1 ? 'y' : 'ies'} not connected yet</li>}
              {!!w.open_attempts && <li className="text-xs text-ink-soft">{w.open_attempts} open contact attempt{w.open_attempts === 1 ? '' : 's'}</li>}
            </ul>
          )}
      </div>
    </Card>
  );
}
