// Daily Work Report timeline: the day's recorded work in time order (my_work_timeline, 0052). Read
// with the viewer's own permissions — an employee sees their own work, a manager / admin the team
// they may view. Manual entries ("Log work") are labelled; voided entries are shown struck through.
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Loader2, PenLine, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState } from './ui';
import { supabase } from '../auth/auth';
import { cn } from '../lib/utils';

export interface TimelineRow {
  id: number; occurred_at: string; activity_type: string; label: string; manual: boolean; entity_type: string | null; entity_id: string | null;
  entity_name: string | null; application_id: string | null; from_status: string | null; to_status: string | null; quantity: number; note: string | null; voided: boolean;
}

const timeIST = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

/** Loads the timeline; `rev` changes (e.g. live activity updates) trigger a quiet reload. */
export function useWorkTimeline(date: string, employeeId?: string, rev?: unknown) {
  const [rows, setRows] = useState<TimelineRow[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!supabase || !date) { setRows([]); return; }
    const { data, error: e } = await supabase.rpc('my_work_timeline', { p_date: date, p_emp: employeeId ?? null, p_limit: 300 });
    if (e) { setError(/my_work_timeline/.test(e.message) ? 'The activity timeline is not set up on the server yet (migration 0052).' : 'The activity timeline could not be loaded.'); setRows((r) => r ?? []); return; }
    setError(''); setRows((data ?? []) as TimelineRow[]);
  }, [date, employeeId]);
  useEffect(() => { setRows(null); }, [date, employeeId]);
  useEffect(() => { void load(); }, [load, rev]);
  return { rows, error, reload: load };
}

export function WorkTimeline({ rows, error, onRetry, title = 'Activity timeline' }: { rows: TimelineRow[] | null; error?: string; onRetry?: () => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const live = (rows ?? []).filter((r) => !r.voided);
  const shown = open ? rows ?? [] : (rows ?? []).slice(0, 8);
  return (
    <Card>
      <CardHeader title={title} subtitle={rows ? `${live.length} recorded ${live.length === 1 ? 'activity' : 'activities'} · times in IST` : undefined}
        action={onRetry ? <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRetry} aria-label="Refresh timeline">Refresh</Button> : undefined} />
      {error && <p className="px-5 pb-4 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
      {!rows ? (
        <div className="flex items-center gap-2 px-5 pb-5 text-sm text-ink-soft" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading activities…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={PenLine} title="Nothing recorded yet" description="Work you complete in SSI GLOBAL appears here automatically as you do it." />
      ) : (
        <ol className="relative mx-5 mb-5 border-l border-line pl-5">
          {shown.map((r) => (
            <li key={r.id} className={cn('relative pb-4 last:pb-0', r.voided && 'opacity-50')}>
              <span className={cn('absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface', r.manual ? 'bg-amber-500' : 'bg-rust')} aria-hidden />
              <button type="button" className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="w-[72px] shrink-0 text-xs font-semibold tabular-nums text-ink-mute">{timeIST(r.occurred_at)}</span>
                  <span className={cn('text-sm font-medium text-heading', r.voided && 'line-through')}>{r.label}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</span>
                  {r.entity_name && <span className="text-sm text-ink-soft">· {r.entity_name}</span>}
                  {r.manual && <Badge tone="amber">Manual</Badge>}
                  {r.voided && <Badge tone="slate">Removed</Badge>}
                </div>
              </button>
              {expanded === r.id && (
                <div className="ml-[80px] mt-1.5 space-y-1 text-xs text-ink-soft">
                  {(r.from_status || r.to_status) && <div className="flex items-center gap-1">Status: {r.from_status ?? '—'} <ArrowRight className="h-3 w-3" /> {r.to_status ?? '—'}</div>}
                  {r.application_id && <div>Application {r.application_id}</div>}
                  {r.note && <div className="whitespace-pre-wrap">Note: {r.note}</div>}
                  <div className="text-ink-mute">{r.activity_type === 'manual_work' ? 'Logged by the employee as work outside the CRM — never added to the report figures.' : r.manual ? 'Logged by the employee with Log work.' : 'Recorded automatically when the work was saved in SSI GLOBAL.'}</div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {(rows?.length ?? 0) > 8 && (
        <div className="border-t border-line px-5 py-2.5">
          <Button size="sm" variant="ghost" icon={open ? ChevronUp : ChevronDown} onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show all ${rows!.length}`}</Button>
        </div>
      )}
    </Card>
  );
}
