// Daily work report for the employee's designation(s). Everything the PDF contains is on this screen:
// header, KPI summary, every report head (activity breakdown), the activity timeline, pending work and
// the daily summary. Screen and PDF are both built from one ReportView (lib/dailyReport): live
// server figures while the report is open, the snapshot frozen at submission afterwards.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ChevronDown, ClipboardList, FileDown, History, Hourglass, Lock, PenLine, Save, Send, Sparkles } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, PageHeader, Segmented, Textarea } from '../../components/ui';
import { WorkTimeline, useWorkTimeline, type TimelineRow } from '../../components/WorkTimeline';
import { downloadReportPdf } from '../../lib/reportPdf';
import { buildReportView, type ReportView } from '../../lib/dailyReport';
import { MetricActivitiesModal, QuickLogModal, reportTone, type ReportDraft } from '../../components/hr';
import { useConfirm, useToast } from '../../components/feedback';
import { useHR } from '../../store/hr';
import { useStore } from '../../store/store';
import { rpc } from '../../lib/agencies';
import { supabase } from '../../auth/auth';
import { companyDate, fmtDay, type MetricValue } from '../../data/hr';
import { chosenDesignation } from '../../layouts/Sidebar';
import { agencyAccess, type PendingWork } from '../../lib/agencies';
import { cn } from '../../lib/utils';

const blank = (): ReportDraft => ({ notes: {} });

/** The employee's open agency work queue (live). */
function usePendingWork(date: string, enabled: boolean, rev: unknown) {
  const [w, setW] = useState<PendingWork | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || !supabase) { setW(null); return; }
    let alive = true;
    void supabase.rpc('my_pending_work', { p_date: date }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setFailed(true); setW(null); return; }
      setFailed(false); setW((data ?? null) as PendingWork | null);
    });
    return () => { alive = false; };
  }, [date, enabled, rev]);
  return { pending: w, failed };
}

export default function MyReport() {
  const { data, call, now } = useHR();
  const { session, db } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
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
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const inFlight = useRef(false);
  const [live, setLive] = useState<Record<string, MetricValue>>({});
  const [showing, setShowing] = useState<{ key: string; label: string } | null>(null);
  const [logFor, setLogFor] = useState<string[] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

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
  useEffect(() => { void refresh(); }, [refresh, data.activities, db.applications]);

  const metrics: Record<string, MetricValue | number | undefined> = editable ? live : (existing?.metricDetails && Object.keys(existing.metricDetails).length ? existing.metricDetails : existing?.metrics ?? {});
  const dirty = editable && JSON.stringify(draft) !== saved;
  const liveTimeline = useWorkTimeline(date, undefined, data.activities);
  const snapshotTimeline = !editable && Array.isArray(existing?.timelineSnapshot) ? (existing!.timelineSnapshot as TimelineRow[]) : null;
  const timelineRows = snapshotTimeline ?? liveTimeline.rows;
  const hasQueue = agencyAccess(session ?? null);
  const livePending = usePendingWork(date, editable && hasQueue, data.activities);
  const pending = editable ? livePending.pending : ((existing?.pendingSnapshot ?? null) as PendingWork | null);
  const options = useMemo(() => data.myTemplates.map((t) => ({ value: t.id, label: t.designation })), [data.myTemplates]);
  const me = data.directory.find((d) => d.id === session?.userId);
  const department = data.departments.find((d) => d.id === me?.departmentId)?.name ?? null;
  const designation = options.find((o) => o.value === templateId)?.label ?? data.designations.find((d) => d.id === existing?.designationId)?.name ?? template?.name ?? '';

  // One view of the report for the screen and the PDF.
  const view: ReportView | null = template ? buildReportView({
    template, metrics, notes: editable ? draft.notes : existing?.notes ?? {}, employee: session?.name ?? 'Employee', designation, department, date,
    status: existing?.status ?? 'Not submitted', submittedAt: existing?.submittedAt ?? null, live: editable, timeline: timelineRows, pending,
  }) : null;

  const downloadPdf = async () => {
    if (!view) return;
    setPdfBusy(true);
    try {
      await downloadReportPdf(view);
    } catch {
      toast.error('The PDF could not be created', 'Please try again. If it keeps failing, use another browser.');
    }
    setPdfBusy(false);
  };

  const save = async (submit: boolean) => {
    if (inFlight.current || !view) return;
    if (submit) {
      const ok = await confirm({
        title: 'Review and submit this daily report?',
        message: `${fmtDay(date)} · ${view.completed} activit${view.completed === 1 ? 'y' : 'ies'} completed, ${view.timeline.length} timeline entr${view.timeline.length === 1 ? 'y' : 'ies'}, ${view.openWork} open item${view.openWork === 1 ? '' : 's'}. The figures are frozen at the moment you submit; afterwards the report is locked unless your manager requests a correction.`,
        confirmLabel: 'Submit report',
      });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy(submit ? 'submit' : 'save');
    const r = await call('save_daily_report', {
      p_template: templateId, p_date: date, p_metrics: {}, p_notes: draft.notes, p_sources: {}, p_submit: submit,
      p_expected_updated_at: existing?.updatedAt ?? null, p_request_id: crypto.randomUUID(),
    }, { refresh: ['reports'], success: submit ? 'Daily report submitted' : 'Draft saved', successDetail: submit ? 'Your manager can now review it.' : undefined });
    setBusy(null);
    inFlight.current = false;
    if (r.ok) setSaved(JSON.stringify(draft));
  };

  const set = (k: 'template' | 'date', v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    if (k === 'template' && !p.get('date')) p.set('date', date);
    setParams(p, { replace: true });
  };
  const allLoggable = [...new Set(data.metricSources.filter((x) => x.templateId === templateId).flatMap((x) => x.activityTypes))]
    .filter((t) => data.activityTypes.find((a) => a.id === t)?.source === 'logged');
  const history = () => navigate(`/${session?.role === 'admin' ? 'admin' : 'staff'}/work/reports`);

  if (!data.myTemplates.length && !existing) {
    return (
      <>
        <PageHeader title="My Daily Work Report" />
        <Card><EmptyState icon={ClipboardList} title="No report template for your designation" description="Ask HR or Admin to assign your designation." /></Card>
      </>
    );
  }
  const top = (view?.sections.flatMap((s) => s.counts) ?? []).filter((x) => x.kind === 'activity' && x.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);
  const manualCount = (view?.timeline ?? []).filter((r) => r.manual).length;

  return (
    <>
      <PageHeader
        title="Daily Work Report"
        subtitle={template?.name}
        actions={<>
          {editable && date === today && <Button variant="secondary" icon={PenLine} onClick={() => setLogFor([...allLoggable, 'manual_work'])}>Add manual activity</Button>}
          <Button variant="secondary" icon={FileDown} disabled={!view || pdfBusy} loading={pdfBusy} onClick={() => void downloadPdf()}>Download PDF</Button>
          <Button variant="secondary" icon={History} onClick={history}>View history</Button>
        </>}
      />

      {/* Report header */}
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 border-b border-line bg-gradient-to-r from-navy to-[#0b3445] px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="truncate font-display text-lg font-semibold">{session?.name ?? 'Employee'}</div>
            <div className="text-sm text-white/75">{[designation, department].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {existing ? <Badge tone={reportTone[existing.status]} dot>{existing.status}</Badge> : <Badge tone="slate">Not submitted</Badge>}
            {existing?.submittedAt && <span className="text-xs text-white/70">Submitted {new Date(existing.submittedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            {dirty && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200">Unsaved summary</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4 p-4">
          {options.length > 1 && <Field label="Designation"><Segmented options={options} value={templateId} onChange={(v) => set('template', v)} /></Field>}
          <Field label="Reporting date"><DatePicker value={date} max={today} clearable={false} onChange={(v) => v && set('date', v)} /></Field>
          <p className="ml-auto max-w-sm text-xs text-ink-mute">{fmtDay(date)} · Asia/Kolkata. Work counts on the day it was done, never on the day it was imported or edited.</p>
        </div>
      </Card>

      {/* Work summary */}
      <section aria-label="Work summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat icon={CheckCircle2} tone="green" label="Activities completed" value={view?.completed ?? 0} hint="Your recorded work on this day" />
        <SummaryStat icon={Hourglass} tone="amber" label="Open / pending work" value={view?.openWork ?? 0} hint="Current queue — not completed work" />
        <SummaryStat icon={CalendarClock} tone="navy" label="Timeline entries" value={view?.timeline.length ?? 0} hint={manualCount ? `${manualCount} manual` : 'All automatic'} />
        <SummaryStat icon={Sparkles} tone="orange" label={top[0]?.label ?? 'Top activity'} value={top[0]?.value ?? 0}
          hint={top.slice(1).map((x) => `${x.label} ${x.value}`).join(' · ') || 'Nothing recorded yet'} />
      </section>
      {session?.permissions.includes('partner_success') && <PortfolioDay date={date} />}
      {existing?.status === 'Correction Requested' && existing.reviewComment && (
        <Alert tone="warning" title="Correction requested" className="mb-5">{existing.reviewComment}</Alert>
      )}
      {!editable ? (
        <Alert tone="info" title="Submitted report" className="mb-5"><span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" />
          {snapshotTimeline ? 'Everything below is the report as submitted — later changes in the CRM do not alter it.' : 'Figures are as submitted. This report was submitted before timelines were stored, so its timeline shows the current records for that day.'}</span></Alert>
      ) : (
        <Alert tone="info" className="mb-5">Your report fills in automatically from your work in the CRM and anything you log. This screen and the PDF show the same report.</Alert>
      )}

      {/* Activity breakdown */}
      {view && <ActivityBreakdown view={view} onShow={(key, label) => setShowing({ key, label })} />}

      {/* Timeline + pending */}
      <div className="mb-5 grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3"><WorkTimeline rows={timelineRows} error={snapshotTimeline ? undefined : liveTimeline.error} onRetry={snapshotTimeline ? undefined : () => void liveTimeline.reload()}
          title={snapshotTimeline ? 'Activity timeline (as submitted)' : 'Activity timeline'} /></div>
        <div className="xl:col-span-2"><PendingCard view={view} loading={editable && hasQueue && livePending.pending === undefined} failed={editable && livePending.failed} hasQueue={hasQueue} /></div>
      </div>

      {/* Daily summary */}
      {view && view.sections.some((s) => s.texts.length) && (
        <Card className="mb-5">
          <CardHeader title="Daily summary" subtitle={editable ? 'Written by you — saved with the report and included in the PDF.' : 'As submitted.'} />
          <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
            {view.sections.flatMap((s) => s.texts).map((t) => editable ? (
              <Field key={t.key} label={t.label}>
                <Textarea rows={3} maxLength={5000} value={draft.notes[t.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, notes: { ...d.notes, [t.key]: e.target.value } }))} />
              </Field>
            ) : (
              <div key={t.key}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{t.label}</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-heading">{t.value || <span className="text-ink-mute">—</span>}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Report actions */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <Button variant="ghost" icon={History} onClick={history}>View history</Button>
        <Button variant="secondary" icon={FileDown} disabled={!view || pdfBusy} loading={pdfBusy} onClick={() => void downloadPdf()}>Download PDF</Button>
        {editable && template && <>
          <Button variant="secondary" icon={Save} disabled={!!busy || !dirty} loading={busy === 'save'} onClick={() => void save(false)}>Save draft</Button>
          <Button icon={Send} disabled={!!busy} loading={busy === 'submit'} onClick={() => void save(true)}>Review &amp; Submit</Button>
        </>}
      </div>
      <MetricActivitiesModal open={!!showing} onClose={() => setShowing(null)} label={showing?.label ?? ''} canVoid={editable}
        metric={showing ? (typeof metrics[showing.key] === 'number' ? { value: metrics[showing.key] as number, kind: 'activity' } : (metrics[showing.key] as MetricValue | undefined)) : undefined} />
      <QuickLogModal open={!!logFor} onClose={() => setLogFor(null)} types={logFor ?? []} />
    </>
  );
}

/** Every report head, grouped as in the template; open counts are labelled; tap a figure to see its work. */
export function ActivityBreakdown({ view, onShow }: { view: ReportView; onShow?: (key: string, label: string) => void }) {
  const sections = view.sections.filter((s) => s.counts.length);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!sections.length) return null;
  return (
    <Card className="mb-5">
      <CardHeader title="Activity breakdown" subtitle="Every figure of your report, as in the PDF" />
      <div className="space-y-3 px-5 pb-5">
        {sections.map((s) => {
          const total = s.counts.filter((c) => c.kind === 'activity').reduce((n, c) => n + c.value, 0);
          const isOpen = open[s.id] ?? true;
          return (
            <section key={s.id} className="rounded-xl border border-line">
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))}>
                <span className="font-semibold text-heading">{s.title}</span>
                <span className="flex items-center gap-2 text-xs text-ink-mute">{total} completed<ChevronDown className={cn('h-4 w-4 transition', isOpen && 'rotate-180')} /></span>
              </button>
              {isOpen && (
                <ul className="grid gap-x-6 border-t border-line px-4 py-2 sm:grid-cols-2">
                  {s.counts.map((c) => (
                    <li key={c.key} className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0 sm:[&:nth-last-child(2)]:border-0">
                      <span className="min-w-0 text-sm text-ink-soft">{c.label}{c.kind !== 'activity' && <Badge tone="slate" className="ml-1.5">open now</Badge>}</span>
                      {onShow && c.kind === 'activity' && c.value > 0
                        ? <button type="button" className="rounded-md px-1.5 font-display text-lg font-semibold tabular-nums text-heading hover:bg-brand-50 hover:text-rust dark:hover:bg-brand-500/10" title="See the work behind this figure" onClick={() => onShow(c.key, c.label)}>{c.value}</button>
                        : <span className={cn('px-1.5 font-display text-lg font-semibold tabular-nums', c.value ? 'text-heading' : 'text-ink-mute')}>{c.value}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function PendingCard({ view, loading, failed, hasQueue }: { view: ReportView | null; loading: boolean; failed: boolean; hasQueue: boolean }) {
  const items = view?.pending ?? [];
  return (
    <Card>
      <CardHeader title="Pending work" subtitle={hasQueue ? 'Carried forward with the original due date until completed' : 'Open items are counted in the report heads; they are not completed work.'} />
      <div className="px-5 pb-5">
        {failed ? <p className="text-sm text-amber-700 dark:text-amber-300">Pending work could not be loaded.</p>
          : loading ? <p className="text-sm text-ink-soft" role="status">Loading…</p>
          : !hasQueue && view?.pending === null ? <p className="text-sm text-ink-soft">{view?.openWork ? `${view.openWork} open item${view.openWork === 1 ? '' : 's'} in your queue.` : 'Nothing pending.'}</p>
          : items.length === 0 && !view?.pendingNotes.length ? <p className="text-sm text-ink-soft">Nothing pending.</p>
          : (
            <ul className="space-y-2 text-sm">
              {items.map((i, n) => (
                <li key={n} className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="min-w-0 break-words text-heading">{i.title}</span>
                  <span className={`shrink-0 text-xs ${i.overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-ink-mute'}`}>{i.overdue ? 'Overdue · ' : ''}{i.when}</span>
                </li>
              ))}
              {view?.pendingNotes.map((n) => <li key={n} className="text-xs text-ink-soft">{n}</li>)}
            </ul>
          )}
      </div>
    </Card>
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
      <p className="text-xs text-ink-mute">Applications and first offers at the clients you are Sub Officer for. Shown for information — they are not your personal work and are not added to the report figures.</p>
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
