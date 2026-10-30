// Building blocks shared by the Employee (work), Manager (team) and HR screens:
// daily report form and detail, approval queues, the punch card and small helpers.
// Every action is a database function (useHR().call) that re-checks permission and policy.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coffee,
  Download,
  FileText,
  Inbox,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  Printer,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Tabs, Textarea, TimePicker } from './ui';
import { useConfirm, useToast } from './feedback';
import { useHR, useHRLookup } from '../store/hr';
import { useStore } from '../store/store';
import { cn, formatDateTime, type Tone } from '../lib/utils';
import {
  CORRECTION_LABEL,
  companyDate,
  companyInstant,
  companyTime,
  fmtDay,
  hm,
  type AttendanceDay,
  type DailyReport,
  type ReportStatus,
  type ReportTemplate,
  type RequestStatus,
  type TemplateSection,
} from '../data/hr';

export const reportTone: Record<ReportStatus, Tone> = { Draft: 'slate', Submitted: 'blue', Reviewed: 'violet', 'Correction Requested': 'amber', Approved: 'green' };
export const requestTone: Record<RequestStatus, Tone> = { Pending: 'amber', Approved: 'green', Rejected: 'red', Cancelled: 'slate' };
export const stateTone: Record<string, Tone> = { 'Not Checked In': 'slate', 'Checked In': 'green', 'On Break': 'amber', 'Checked Out': 'navy', 'Missing Punch-out': 'red' };

// ------------------------------------------------------------------ export

/** Downloads rows as CSV (opens in Excel). */
export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const head = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${filename}-${companyDate()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ExportButtons({ filename, rows }: { filename: string; rows: () => Record<string, unknown>[] }) {
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" icon={Download} onClick={() => {
        const r = rows();
        if (!r.length) return toast.info('Nothing to export', 'No rows match the current filters.');
        exportCsv(filename, r);
        toast.success('Exported', `${r.length} row(s) downloaded for Excel.`);
      }}>Excel (CSV)</Button>
      <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button>
    </>
  );
}

// ------------------------------------------------------------------ small pieces

export function KPI({ label, value, hint, icon: Icon, tone = 'navy', onClick }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: 'navy' | 'orange' | 'green' | 'red' | 'amber'; onClick?: () => void }) {
  const tones = {
    navy: 'bg-navy-50 text-navy dark:bg-white/5 dark:text-white',
    orange: 'bg-brand-50 text-rust dark:bg-brand-500/10 dark:text-brand-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm', onClick && 'transition hover:border-brand-300')}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block font-display text-xl font-semibold leading-tight text-heading">{value}</span>
        <span className="block text-xs leading-snug text-ink-soft">{label}</span>
        {hint && <span className="block truncate text-[11px] text-ink-mute">{hint}</span>}
      </span>
    </Tag>
  );
}

/** Whole-number input for report counts (never negative, never fractional). */
function CountInput({ value, onChange, disabled, id }: { value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean; id: string }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      value={value == null ? '' : String(value)}
      disabled={disabled}
      placeholder="0"
      className="text-right tabular-nums"
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
        onChange(v === '' ? undefined : Number(v));
      }}
    />
  );
}

// ------------------------------------------------------------------ daily report form

export interface ReportDraft { metrics: Record<string, number | undefined>; notes: Record<string, string>; sources: Record<string, string> }

export function ReportForm({ template, draft, onChange, readOnly, crm }: {
  template: { sections: TemplateSection[] };
  draft: ReportDraft;
  onChange: (d: ReportDraft) => void;
  readOnly?: boolean;
  crm?: Record<string, { label: string; value: number }>;
}) {
  const set = (k: string, v: number | undefined, source?: string) => {
    const sources = { ...draft.sources };
    if (source) sources[k] = source;
    else delete sources[k];
    onChange({ ...draft, metrics: { ...draft.metrics, [k]: v }, sources });
  };
  return (
    <div className="space-y-5">
      {template.sections.map((s, si) => {
        const counts = s.fields.filter((f) => f.type === 'count');
        const texts = s.fields.filter((f) => f.type === 'text');
        return (
          <section key={s.id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <h3 className="mb-4 flex items-center gap-2 font-display text-[15px] font-semibold text-heading">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-rust dark:bg-brand-500/10">{si + 1}</span>
              {s.title}
            </h3>
            {counts.length > 0 && (
              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {counts.map((f) => {
                  const sug = crm?.[f.key];
                  const fromCrm = draft.sources[f.key] === 'crm';
                  return (
                    <div key={f.key}>
                      <label htmlFor={`f-${f.key}`} className="mb-1.5 flex items-center justify-between gap-2 text-[13px] font-semibold text-heading">
                        <span>{f.label}</span>
                        {fromCrm && <Badge tone="teal"><Sparkles className="h-3 w-3" /> CRM</Badge>}
                      </label>
                      <CountInput id={`f-${f.key}`} value={draft.metrics[f.key]} disabled={readOnly} onChange={(v) => set(f.key, v)} />
                      {sug && !readOnly && (
                        <button type="button" onClick={() => set(f.key, sug.value, 'crm')} className="mt-1 text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300" title={sug.label}>
                          From CRM: {sug.value} — use this
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {texts.length > 0 && (
              <div className={cn('grid gap-4 sm:grid-cols-2', counts.length > 0 && 'mt-4')}>
                {texts.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Textarea
                      value={draft.notes[f.key] ?? ''}
                      readOnly={readOnly}
                      maxLength={5000}
                      rows={4}
                      onChange={(e) => onChange({ ...draft, notes: { ...draft.notes, [f.key]: e.target.value } })}
                    />
                  </Field>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ report detail + review

export function ReportDetailModal({ report, onClose, canReview }: { report?: DailyReport; onClose: () => void; canReview?: boolean }) {
  const { data, call } = useHR();
  const lk = useHRLookup();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<{ action: string; at: string; actorId: string | null; comment: string | null }[]>([]);
  const live = data.reports.find((r) => r.id === report?.id) ?? report;
  const tpl: ReportTemplate | undefined = data.templates.find((t) => t.id === live?.templateId && t.version === live?.templateVersion);
  useEffect(() => {
    setComment('');
    if (!report) return;
    let alive = true;
    void import('../auth/auth').then(async ({ supabase }) => {
      if (!supabase) return;
      const { data: ev } = await supabase.from('daily_report_events').select('action, at, actor_id, comment').eq('report_id', report.id).order('at');
      if (alive) setEvents((ev ?? []).map((e) => ({ action: e.action, at: e.at, actorId: e.actor_id, comment: e.comment })));
    });
    return () => {
      alive = false;
    };
  }, [report?.id, live?.updatedAt]);
  const act = async (action: 'review' | 'approve' | 'request_correction') => {
    if (!live) return;
    setBusy(true);
    const r = await call('review_daily_report', { p_id: live.id, p_action: action, p_comment: comment || null }, {
      refresh: ['reports'], success: action === 'approve' ? 'Report approved' : action === 'review' ? 'Marked as reviewed' : 'Correction requested',
    });
    setBusy(false);
    if (r.ok) setComment('');
  };
  const st = live?.status;
  return (
    <Modal
      open={!!live}
      onClose={onClose}
      size="wide"
      title={live ? `${lk.name(live.employeeId)} · ${fmtDay(live.reportDate)}` : ''}
      subtitle={live ? `${lk.designation.get(live.designationId)?.name ?? live.designationId}${live.departmentId ? ` · ${lk.department.get(live.departmentId)?.name ?? ''}` : ''} · reports to ${lk.name(live.managerId)}` : undefined}
      footer={canReview && live && st !== 'Draft' && st !== 'Correction Requested' ? (
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Comment" className="flex-1"><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Required when requesting a correction" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => act('request_correction')}>Request correction</Button>
            {st === 'Submitted' && <Button variant="secondary" disabled={busy} onClick={() => act('review')}>Mark reviewed</Button>}
            {(st === 'Submitted' || st === 'Reviewed') && <Button disabled={busy} icon={CheckCircle2} onClick={() => act('approve')}>Approve</Button>}
          </div>
        </div>
      ) : undefined}
    >
      {live && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={reportTone[live.status]} dot>{live.status}</Badge>
            {live.submittedAt && <span className="text-ink-soft">Submitted {formatDateTime(live.submittedAt)}</span>}
            {live.reviewedAt && <span className="text-ink-soft">· {live.status === 'Correction Requested' ? 'Returned' : 'Reviewed'} by {lk.name(live.reviewedBy)}</span>}
          </div>
          {live.reviewComment && <Alert tone={live.status === 'Correction Requested' ? 'warning' : 'info'} title="Reviewer comment">{live.reviewComment}</Alert>}
          {tpl ? (
            tpl.sections.map((s) => (
              <section key={s.id} className="rounded-2xl border border-line p-4">
                <h4 className="mb-3 font-display text-sm font-semibold text-heading">{s.title}</h4>
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {s.fields.map((f) => (
                    <div key={f.key} className={cn(f.type === 'text' ? 'sm:col-span-2' : 'flex items-baseline justify-between gap-3 border-b border-dashed border-line pb-1.5')}>
                      <dt className={cn('text-[13px] text-ink-soft', f.type === 'text' && 'text-[11px] font-semibold uppercase tracking-wider text-ink-mute')}>{f.label}</dt>
                      <dd className={cn('text-heading', f.type === 'count' ? 'font-semibold tabular-nums' : 'mt-1 whitespace-pre-line text-sm')}>
                        {f.type === 'count' ? (live.metrics[f.key] ?? <span className="font-normal text-ink-mute">—</span>) : live.notes[f.key] || <span className="italic text-ink-mute">Not provided</span>}
                        {f.type === 'count' && live.sources[f.key] === 'crm' && <Badge tone="teal" className="ml-2">CRM</Badge>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))
          ) : (
            <p className="text-ink-mute">Template not available.</p>
          )}
          {events.length > 0 && (
            <section>
              <h4 className="mb-2 font-display text-sm font-semibold text-heading">History</h4>
              <ol className="space-y-1.5 text-[13px] text-ink-soft">
                {events.map((e, i) => (
                  <li key={i}><span className="font-medium text-heading">{e.action.replace(/_/g, ' ')}</span> · {lk.name(e.actorId)} · {formatDateTime(e.at)}{e.comment ? ` — ${e.comment}` : ''}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ approvals

type ApprovalKind = 'leave' | 'early' | 'corrections' | 'reports';

/** Pending requests the signed-in user may decide (database decides who sees what). */
export function ApprovalsPanel({ kinds = ['leave', 'early', 'corrections', 'reports'], onlyTeam }: { kinds?: ApprovalKind[]; onlyTeam?: boolean }) {
  const { data, call } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const confirm = useConfirm();
  const me = session?.userId;
  const hr = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('hr');
  const teamIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (m: string) => data.employees.filter((e) => e.reportingManagerId === m && !ids.has(e.id)).forEach((e) => { ids.add(e.id); walk(e.id); });
    if (me) walk(me);
    return ids;
  }, [data.employees, me]);
  const mine = (emp: string) => emp !== me && (onlyTeam ? teamIds.has(emp) : true);
  const leave = data.leaveRequests.filter((r) => r.status === 'Pending' && mine(r.employeeId));
  const early = data.earlyCheckouts.filter((r) => r.status === 'Pending' && mine(r.employeeId));
  const corr = data.corrections.filter((r) => r.status === 'Pending' && mine(r.employeeId));
  const reps = data.reports.filter((r) => (r.status === 'Submitted' || r.status === 'Reviewed') && mine(r.employeeId));
  const counts: Record<ApprovalKind, number> = { leave: leave.length, early: early.length, corrections: corr.length, reports: reps.length };
  const labels: Record<ApprovalKind, string> = { leave: 'Leave', early: 'Early checkout', corrections: 'Attendance corrections', reports: 'Daily reports' };
  const [tab, setTab] = useState<ApprovalKind>(kinds[0]);
  const [viewing, setViewing] = useState<DailyReport>();
  const [override, setOverride] = useState<{ id: string; reason: string } | null>(null);
  const usedThisMonth = (emp: string, date: string) =>
    data.earlyCheckouts.filter((x) => x.employeeId === emp && x.status === 'Approved' && x.workDate.slice(0, 7) === date.slice(0, 7)).length;
  const limit = Number((data.settings.find((s) => s.key === 'early_checkout_monthly_limit')?.value as number | undefined) ?? 2);

  const decide = async (fn: string, id: string, approve: boolean, refresh: ('leaveRequests' | 'balances' | 'earlyCheckouts' | 'corrections' | 'attendance')[], extra: Record<string, unknown> = {}) => {
    let comment: string | null = null;
    if (!approve) {
      const ok = await confirm({ title: 'Reject this request?', message: 'The employee is notified.', confirmLabel: 'Reject', danger: true });
      if (!ok) return;
      comment = 'Rejected';
    }
    await call(fn, { p_id: id, p_approve: approve, p_comment: comment, ...extra }, { refresh, success: approve ? 'Approved' : 'Rejected' });
  };

  const Row = ({ who, title, sub, children }: { who: string; title: ReactNode; sub?: ReactNode; children: ReactNode }) => (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-semibold text-heading">{lk.name(who)}</div>
        <div className="text-sm text-ink-soft">{title}</div>
        {sub && <div className="mt-0.5 text-xs text-ink-mute">{sub}</div>}
      </div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  );

  return (
    <Card className="p-5">
      <Tabs value={tab} onChange={setTab} className="mb-2" tabs={kinds.map((k) => ({ value: k, label: labels[k], count: counts[k] }))} />
      {counts[tab] === 0 ? (
        <EmptyState icon={Inbox} title="Nothing waiting" description="New requests appear here automatically." />
      ) : (
        <ul className="divide-y divide-line">
          {tab === 'leave' && leave.map((r) => (
            <Row key={r.id} who={r.employeeId} title={`${lk.leaveType.get(r.leaveType)?.name ?? r.leaveType} · ${fmtDay(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDay(r.endDate)}` : ''} · ${r.days} day(s)`}
              sub={<>{r.reason ? `Reason: ${r.reason}` : 'No reason given'}{r.managerApprovedAt ? ` · approved by manager ${lk.name(r.managerApprovedBy)}, waiting for HR` : ''}</>}>
              <Button size="sm" variant="secondary" onClick={() => decide('decide_leave', r.id, false, ['leaveRequests', 'balances'])}>Reject</Button>
              <Button size="sm" disabled={!!r.managerApprovedAt && !hr} onClick={() => decide('decide_leave', r.id, true, ['leaveRequests', 'balances'])}>Approve</Button>
            </Row>
          ))}
          {tab === 'early' && early.map((r) => {
            const used = usedThisMonth(r.employeeId, r.workDate);
            return (
              <Row key={r.id} who={r.employeeId} title={`Leave at ${companyTime(r.requestedTime)} on ${fmtDay(r.workDate)}`} sub={<>Reason: {r.reason} · {used}/{limit} used this month</>}>
                <Button size="sm" variant="secondary" onClick={() => decide('decide_early_checkout', r.id, false, ['earlyCheckouts'])}>Reject</Button>
                {used >= limit ? (
                  hr ? <Button size="sm" variant="secondary" icon={AlertTriangle} onClick={() => setOverride({ id: r.id, reason: '' })}>Exception…</Button> : <Badge tone="red">Limit reached</Badge>
                ) : (
                  <Button size="sm" onClick={() => decide('decide_early_checkout', r.id, true, ['earlyCheckouts', 'attendance'])}>Approve</Button>
                )}
              </Row>
            );
          })}
          {tab === 'corrections' && corr.map((r) => (
            <Row key={r.id} who={r.employeeId} title={`${CORRECTION_LABEL[r.correctionType]} · ${fmtDay(r.workDate)}`}
              sub={<>
                {r.requestedInAt && `In → ${companyTime(r.requestedInAt)} `}{r.requestedOutAt && `Out → ${companyTime(r.requestedOutAt)} `}
                {r.requestedBreakMinutes != null && `Break → ${r.requestedBreakMinutes} min `}· {r.reason}
                {r.original && ` · recorded: in ${companyTime(r.original.punch_in_at as string)}, out ${companyTime(r.original.punch_out_at as string)}`}
              </>}>
              <Button size="sm" variant="secondary" onClick={() => decide('decide_attendance_correction', r.id, false, ['corrections'])}>Reject</Button>
              <Button size="sm" onClick={() => decide('decide_attendance_correction', r.id, true, ['corrections', 'attendance'])}>Approve</Button>
            </Row>
          ))}
          {tab === 'reports' && reps.map((r) => (
            <Row key={r.id} who={r.employeeId} title={`${lk.designation.get(r.designationId)?.name ?? ''} · ${fmtDay(r.reportDate)}`} sub={<Badge tone={reportTone[r.status]}>{r.status}</Badge>}>
              <Button size="sm" icon={FileText} onClick={() => setViewing(r)}>Open</Button>
            </Row>
          ))}
        </ul>
      )}
      <ReportDetailModal report={viewing} onClose={() => setViewing(undefined)} canReview />
      <Modal open={!!override} onClose={() => setOverride(null)} size="sm" title="Approve beyond the monthly limit"
        subtitle="This exception is recorded in the audit log with your reason."
        footer={<><Button variant="secondary" onClick={() => setOverride(null)}>Cancel</Button>
          <Button disabled={(override?.reason.trim().length ?? 0) < 5} onClick={async () => {
            if (!override) return;
            const r = await call('decide_early_checkout', { p_id: override.id, p_approve: true, p_comment: null, p_override: true, p_override_reason: override.reason }, { refresh: ['earlyCheckouts', 'attendance'], success: 'Exception approved' });
            if (r.ok) setOverride(null);
          }}>Approve exception</Button></>}>
        <Field label="Reason for the exception" required><Textarea rows={3} value={override?.reason ?? ''} onChange={(e) => setOverride((o) => (o ? { ...o, reason: e.target.value } : o))} /></Field>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ punch card

type Loc = { status: 'captured'; latitude: number; longitude: number; accuracy: number | null; captured_at: string } | { status: 'denied' | 'unavailable' };

/** Asks the browser for the current position once (only when the employee presses a punch button). */
function captureLocation(): Promise<Loc> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ status: 'unavailable' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: 'captured', latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? null, captured_at: new Date(p.timestamp).toISOString() }),
      (e) => resolve({ status: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export function useMyToday() {
  const { data } = useHR();
  const { session } = useStore();
  const today = companyDate();
  return useMemo(() => {
    const mine = data.attendance.filter((a) => a.employeeId === session?.userId);
    return mine.find((a) => a.workDate === today) ?? mine.find((a) => a.state === 'Checked In' || a.state === 'On Break');
  }, [data.attendance, session?.userId, today]);
}

export function PunchCard({ compact }: { compact?: boolean }) {
  const { data, call, now, setting } = useHR();
  const confirm = useConfirm();
  const today = useMyToday();
  const [busy, setBusy] = useState<string | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const policy = setting<string>('location_policy', 'optional');
  const open = today && (today.state === 'Checked In' || today.state === 'On Break');
  const openBreak = useMemo(() => (today ? data.breaks.find((b) => b.sessionId === today.id && !b.endAt) : undefined), [data.breaks, today]);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [open]);
  void tick;
  // Live figures from server timestamps and the server clock offset.
  const live = useMemo(() => {
    if (!today?.effIn) return null;
    const end = today.effOut ? new Date(today.effOut) : now();
    const gross = (end.getTime() - new Date(today.effIn).getTime()) / 60000;
    const closedBreaks = data.breaks.filter((b) => b.sessionId === today.id && b.endAt).reduce((s, b) => s + (new Date(b.endAt!).getTime() - new Date(b.startAt).getTime()) / 60000, 0);
    const running = openBreak ? (now().getTime() - new Date(openBreak.startAt).getTime()) / 60000 : 0;
    const brk = today.state === 'Checked Out' ? today.breakMinutes : closedBreaks + running;
    return { gross, brk, net: Math.max(0, gross - brk), running };
  }, [today, data.breaks, openBreak, now, tick]);

  const punch = async (fn: 'punch_in' | 'punch_out') => {
    if (fn === 'punch_out' && live && today && live.net < today.requiredMinutes) {
      const hasApproval = data.earlyCheckouts.some((e) => e.employeeId === today.employeeId && e.workDate === today.workDate && e.status === 'Approved');
      const ok = await confirm({
        title: 'Punch out before completing your hours?',
        message: `You have worked ${hm(live.net)} of ${hm(today.requiredMinutes)}.${hasApproval ? ' Your early checkout is approved.' : ' This will be marked as an early checkout. Request approval first if this is an emergency.'}`,
        confirmLabel: 'Punch out',
      });
      if (!ok) return;
    }
    setBusy(fn);
    setLocMsg(null);
    const loc = await captureLocation();
    if (loc.status !== 'captured') {
      setLocMsg(loc.status === 'denied'
        ? policy === 'required' ? 'Location permission is off. Your company requires location to punch — allow it in the browser settings, or request an attendance correction.' : 'Location permission is off — punched without location' + (policy === 'approval' ? '; HR will verify this punch.' : '.')
        : 'Location is unavailable on this device — punched without location' + (policy === 'approval' ? '; HR will verify this punch.' : '.'));
    }
    const r = await call(fn, { p_location: loc }, { refresh: ['attendance', 'breaks'], success: fn === 'punch_in' ? 'Punched in' : 'Punched out', successDetail: companyTime(now()) });
    setBusy(null);
    if (!r.ok && /location/i.test(r.error)) setLocMsg(r.error);
  };
  const brk = async (fn: 'break_start' | 'break_end') => {
    setBusy(fn);
    await call(fn, {}, { refresh: ['attendance', 'breaks'], success: fn === 'break_start' ? 'Break started' : 'Break ended' });
    setBusy(null);
  };
  const state = today?.state ?? 'Not Checked In';
  const pct = live && today ? Math.min(100, (live.net / Math.max(1, today.requiredMinutes)) * 100) : 0;
  return (
    <Card className={cn('overflow-hidden', compact ? 'p-5' : 'p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-mute"><Clock className="h-3.5 w-3.5" /> Today · {fmtDay(companyDate(now()))}</div>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={stateTone[state]} dot>{state}</Badge>
            {today?.late && <Badge tone="amber">Late</Badge>}
            {today?.earlyCheckout && today.state === 'Checked Out' && <Badge tone={today.earlyCheckoutId ? 'blue' : 'red'}>{today.earlyCheckoutId ? 'Early (approved)' : 'Early checkout'}</Badge>}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl font-semibold tabular-nums text-heading">{live ? hm(live.net) : '0h 00m'}</div>
          <div className="text-xs text-ink-soft">net of {hm(today?.requiredMinutes ?? 480)} required</div>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-gradient-to-r from-brand to-rust transition-all" style={{ width: `${pct}%` }} /></div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-ink-mute">In</dt><dd className="font-semibold text-heading">{companyTime(today?.effIn)}</dd></div>
        <div><dt className="text-xs text-ink-mute">Break</dt><dd className="font-semibold text-heading">{live ? hm(live.brk) : '—'}{openBreak && <span className="ml-1 text-xs font-normal text-amber-600">running</span>}</dd></div>
        <div><dt className="text-xs text-ink-mute">Out</dt><dd className="font-semibold text-heading">{companyTime(today?.effOut)}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {state === 'Not Checked In' || state === 'Missing Punch-out' || (today && today.workDate !== companyDate(now()) && state === 'Checked Out') ? (
          <Button icon={LogIn} disabled={!!busy} onClick={() => punch('punch_in')}>{busy === 'punch_in' ? 'Punching in…' : 'Punch In'}</Button>
        ) : state === 'Checked In' ? (
          <>
            <Button variant="secondary" icon={Coffee} disabled={!!busy} onClick={() => brk('break_start')}>Start break</Button>
            <Button icon={LogOut} disabled={!!busy} onClick={() => punch('punch_out')}>{busy === 'punch_out' ? 'Punching out…' : 'Punch Out'}</Button>
          </>
        ) : state === 'On Break' ? (
          <Button icon={Coffee} disabled={!!busy} onClick={() => brk('break_end')}>End break</Button>
        ) : (
          <p className="text-sm text-ink-soft">Done for today. Use an attendance correction if something is wrong.</p>
        )}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-mute">
        {locMsg ? <MapPinOff className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" /> : <MapPin className="mt-px h-3.5 w-3.5 shrink-0" />}
        {locMsg ?? 'Your location is requested only when you punch in or out — never in the background. Times come from the server.'}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ attendance table

export function AttendanceTable({ rows, showName, onVerify }: { rows: AttendanceDay[]; showName?: boolean; onVerify?: (id: string) => void }) {
  const lk = useHRLookup();
  if (!rows.length) return <EmptyState icon={Clock} title="No attendance in this period" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
            {showName && <th className="py-2.5 pr-3">Employee</th>}
            <th className="py-2.5 pr-3">Date</th><th className="pr-3">In</th><th className="pr-3">Out</th><th className="pr-3 text-right">Gross</th>
            <th className="pr-3 text-right">Break</th><th className="pr-3 text-right">Net</th><th className="pr-3 text-right">Shortage</th><th className="pr-3">Status</th><th>Location</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((a) => (
            <tr key={a.id}>
              {showName && <td className="py-2.5 pr-3 font-medium text-heading">{lk.name(a.employeeId)}</td>}
              <td className="py-2.5 pr-3 whitespace-nowrap">{fmtDay(a.workDate)}</td>
              <td className="pr-3 tabular-nums">{companyTime(a.effIn)}{a.correctedInAt && <span title={`Recorded ${companyTime(a.punchInAt)}`} className="ml-1 text-[10px] text-teal-600">corr.</span>}</td>
              <td className="pr-3 tabular-nums">{companyTime(a.effOut)}{a.correctedOutAt && <span title={`Recorded ${companyTime(a.punchOutAt)}`} className="ml-1 text-[10px] text-teal-600">corr.</span>}</td>
              <td className="pr-3 text-right tabular-nums">{hm(a.grossMinutes)}</td>
              <td className="pr-3 text-right tabular-nums">{hm(a.breakMinutes)}</td>
              <td className="pr-3 text-right font-semibold tabular-nums text-heading">{hm(a.netMinutes)}</td>
              <td className="pr-3 text-right tabular-nums">{a.state === 'Checked Out' && (a.netMinutes ?? 0) < a.requiredMinutes ? <span className="text-red-600">{hm(a.requiredMinutes - (a.netMinutes ?? 0))}</span> : '—'}</td>
              <td className="pr-3">
                <span className="flex flex-wrap gap-1">
                  <Badge tone={stateTone[a.state]}>{a.state}</Badge>
                  {a.late && <Badge tone="amber">Late</Badge>}
                  {a.earlyCheckout && <Badge tone={a.earlyCheckoutId ? 'blue' : 'red'}>{a.earlyCheckoutId ? 'Early ✓' : 'Early'}</Badge>}
                </span>
              </td>
              <td className="text-xs text-ink-soft">
                {[a.locationStatusIn, a.locationStatusOut].every((x) => x === 'captured') ? 'Captured' : [a.locationStatusIn, a.locationStatusOut].filter(Boolean).join(' / ') || '—'}
                {onVerify && a.locationStatusIn && a.locationStatusIn !== 'captured' && !a.locationVerifiedAt && (
                  <button type="button" className="ml-2 font-semibold text-rust hover:underline" onClick={() => onVerify(a.id)}>Verify</button>
                )}
                {a.locationVerifiedAt && <span className="ml-1 text-emerald-600">verified</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ correction + early checkout requests

export function CorrectionRequestModal({ open, onClose, date }: { open: boolean; onClose: () => void; date?: string }) {
  const { call } = useHR();
  const [d, setD] = useState({ date: date ?? companyDate(), type: 'missed_punch_out' as keyof typeof CORRECTION_LABEL, inT: '', outT: '', brk: '', reason: '', details: '' });
  const initial = useRef(date);
  useEffect(() => {
    if (open) setD({ date: date ?? initial.current ?? companyDate(), type: 'missed_punch_out', inT: '', outT: '', brk: '', reason: '', details: '' });
  }, [open, date]);
  const [busy, setBusy] = useState(false);
  const needsIn = d.type === 'missed_punch_in' || d.type === 'technical';
  const needsOut = d.type === 'missed_punch_out' || d.type === 'missed_punch_in' || d.type === 'technical';
  const submit = async () => {
    setBusy(true);
    const r = await call('request_attendance_correction', {
      p_date: d.date, p_type: d.type,
      p_in: needsIn && d.inT ? companyInstant(d.date, d.inT) : null,
      p_out: needsOut && d.outT ? companyInstant(d.date, d.outT) : null,
      p_break_minutes: d.type === 'break_timing' || (d.type === 'technical' && d.brk) ? Number(d.brk || 0) : null,
      p_reason: d.reason, p_details: d.details || null,
    }, { refresh: ['corrections'], success: 'Correction requested', successDetail: 'Your manager or HR will review it.' });
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Request attendance correction" subtitle="Your recorded times are kept; the corrected times apply only after approval."
      dirty={!!(d.reason || d.inT || d.outT)} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || d.reason.trim().length < 3} onClick={submit}>Submit request</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Attendance date" required><Input type="date" value={d.date} max={companyDate()} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="Correction type" required>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(CORRECTION_LABEL) as (keyof typeof CORRECTION_LABEL)[]).map((k) => (
              <button key={k} type="button" onClick={() => setD({ ...d, type: k })} className={cn('rounded-lg border px-2 py-1.5 text-xs font-semibold transition', d.type === k ? 'border-rust bg-brand-50 text-rust dark:bg-brand-500/10' : 'border-line text-ink-soft')}>{CORRECTION_LABEL[k]}</button>
            ))}
          </div>
        </Field>
        {needsIn && <Field label="Correct punch-in time" required={d.type === 'missed_punch_in'}><TimePicker value={d.inT} onChange={(v) => setD({ ...d, inT: v })} /></Field>}
        {needsOut && <Field label="Correct punch-out time" required={d.type === 'missed_punch_out'}><TimePicker value={d.outT} onChange={(v) => setD({ ...d, outT: v })} /></Field>}
        {(d.type === 'break_timing' || d.type === 'technical') && (
          <Field label="Correct total break (minutes)" required={d.type === 'break_timing'}><Input inputMode="numeric" value={d.brk} onChange={(e) => setD({ ...d, brk: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
        )}
        <Field label="Reason" required className="sm:col-span-2"><Input value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} placeholder="e.g. Forgot to punch out after the client meeting" /></Field>
        <Field label="Supporting details (optional)" className="sm:col-span-2"><Textarea rows={3} value={d.details} onChange={(e) => setD({ ...d, details: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function EarlyCheckoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, call, now, setting } = useHR();
  const { session } = useStore();
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setTime(''); setReason(''); }
  }, [open]);
  const limit = Number(setting<number>('early_checkout_monthly_limit', 2));
  const month = companyDate(now()).slice(0, 7);
  const used = data.earlyCheckouts.filter((e) => e.employeeId === session?.userId && e.status === 'Approved' && e.workDate.slice(0, 7) === month).length;
  const left = Math.max(0, limit - used);
  const submit = async () => {
    setBusy(true);
    const r = await call('request_early_checkout', { p_time: companyInstant(companyDate(now()), time), p_reason: reason }, { refresh: ['earlyCheckouts'], success: 'Early checkout requested', successDetail: 'Your manager will review it.' });
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Request early checkout" subtitle={`Emergencies only · manager approval required · ${left} of ${limit} left this month`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !time || reason.trim().length < 5 || left === 0} onClick={submit}>Submit</Button></>}>
      {left === 0 ? (
        <Alert tone="warning" title="Monthly limit reached">You have used all {limit} early checkouts this month. Contact HR for exceptional cases.</Alert>
      ) : (
        <div className="space-y-4">
          <Field label="Leave at (today)" required><TimePicker value={time} onChange={setTime} /></Field>
          <Field label="Emergency reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}
