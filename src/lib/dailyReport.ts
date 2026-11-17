// One Daily Work Report data model for every view of a report: the employee's report screen, the
// manager / admin report view and the PDF. Figures always come from the server (compute_report_metrics
// while a report is open, the frozen metric_details once submitted); the timeline and pending work come
// from the live queries while open and from the snapshot stored at submission (0055) afterwards — so
// the screen and the PDF of the same report can never differ.
import type { MetricValue, ReportTemplate } from '../data/hr';
import type { PendingWork } from './agencies';
import { TASK_KIND, fmtDate, fmtTime } from './agencies';

export interface ReportTimelineRow {
  id: number; occurred_at: string; activity_type: string; label: string; manual: boolean; entity_type: string | null; entity_id: string | null;
  entity_name: string | null; application_id: string | null; from_status: string | null; to_status: string | null; quantity: number; note: string | null; voided: boolean;
}
export interface ReportCount { key: string; label: string; value: number; kind: 'activity' | 'workload' | 'pending' }
export interface ReportText { key: string; label: string; value: string }
export interface ReportSection { id: string; title: string; counts: ReportCount[]; texts: ReportText[] }
export interface PendingItem { title: string; when: string; overdue: boolean }

export interface ReportView {
  employee: string;
  designation: string;
  department: string | null;
  date: string;
  templateName: string;
  status: string;
  submittedAt: string | null;
  /** true = live figures of a report not yet submitted; false = the submitted snapshot. */
  live: boolean;
  sections: ReportSection[];
  completed: number;
  openWork: number;
  timeline: ReportTimelineRow[];
  /** null when the employee has no agency work queue (the report heads still show open counts). */
  pending: PendingItem[] | null;
  pendingNotes: string[];
}

const valueOf = (m: MetricValue | number | undefined) => (typeof m === 'number' ? m : m?.value ?? 0);
const kindOf = (m: MetricValue | number | undefined): ReportCount['kind'] => (typeof m === 'number' ? 'activity' : m?.kind ?? 'activity');

export function pendingItems(pw: PendingWork | null | undefined, date: string): { items: PendingItem[] | null; notes: string[] } {
  if (!pw) return { items: null, notes: [] };
  const items: PendingItem[] = [
    ...(pw.tasks ?? []).filter((t) => t.due_date <= date).map((t) => ({ title: `${TASK_KIND[t.kind]} · ${t.agency}`, when: `${fmtDate(t.due_date)}${t.due_time ? ` ${fmtTime(t.due_time)}` : ''}`, overdue: !!t.overdue })),
    ...(pw.linkedin ?? []).map((l) => ({ title: `LinkedIn follow-up · ${l.name}`, when: fmtDate(l.due_date), overdue: !!l.overdue })),
  ];
  const notes = [
    ...(pw.not_connected ? [`${pw.not_connected} agenc${pw.not_connected === 1 ? 'y' : 'ies'} not connected yet`] : []),
    ...(pw.open_attempts ? [`${pw.open_attempts} open contact attempt${pw.open_attempts === 1 ? '' : 's'}`] : []),
    ...(pw.linkedin_pending_contacts ? [`${pw.linkedin_pending_contacts} LinkedIn contact${pw.linkedin_pending_contacts === 1 ? '' : 's'} not attempted yet`] : []),
  ];
  return { items, notes };
}

export function buildReportView(a: {
  template: ReportTemplate; metrics: Record<string, MetricValue | number | undefined>; notes: Record<string, string>;
  employee: string; designation: string; department: string | null; date: string; status: string; submittedAt: string | null; live: boolean;
  timeline: ReportTimelineRow[] | null | undefined; pending: PendingWork | null | undefined;
}): ReportView {
  const sections: ReportSection[] = a.template.sections.map((s) => ({
    id: s.id,
    title: s.title,
    counts: s.fields.filter((f) => f.type === 'count').map((f) => ({ key: f.key, label: f.label, value: valueOf(a.metrics[f.key]), kind: kindOf(a.metrics[f.key]) })),
    texts: s.fields.filter((f) => f.type === 'text').map((f) => ({ key: f.key, label: f.label, value: (a.notes[f.key] ?? '').trim() })),
  }));
  const counts = sections.flatMap((s) => s.counts);
  const p = pendingItems(a.pending, a.date);
  return {
    employee: a.employee, designation: a.designation, department: a.department, date: a.date, templateName: a.template.name, status: a.status,
    submittedAt: a.submittedAt, live: a.live, sections,
    completed: counts.filter((c) => c.kind === 'activity').reduce((n, c) => n + c.value, 0),
    openWork: counts.filter((c) => c.kind !== 'activity').reduce((n, c) => n + c.value, 0),
    timeline: (a.timeline ?? []).filter((r) => !r.voided),
    pending: p.items, pendingNotes: p.notes,
  };
}
