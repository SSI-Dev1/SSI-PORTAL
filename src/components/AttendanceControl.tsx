// Attendance control in the top navigation — the one place to Clock In, take a break and
// Clock Out. SSI GLOBAL colours: orange (#FBA51E → #B94A12) for starting work, navy (#06242F)
// for ending it, neutral surfaces for breaks. Wide screens show the controls inline; narrower
// screens get a compact trigger that opens the same controls in a popover.
// Everything reflects today's attendance row from the database (useClockFlow): a button only
// changes after the server has saved the action, and the timer runs on the server clock.
import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Clock3, Coffee, Loader2, LogIn, LogOut, Timer } from 'lucide-react';
import { useClockFlow } from './hr';
import { useConfirm } from './feedback';
import { useHR } from '../store/hr';
import { useStore } from '../store/store';
import { companyDate, companyTime, hm } from '../data/hr';
import { floatingPanel, stopPortalBubble, usePortalContainer } from './ds/layer';
import { cn } from '../lib/utils';

type State = 'none' | 'in' | 'break' | 'done';

const btnBase =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold transition duration-150 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface ' +
  'active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100';
const btn = {
  // Start work: brand orange
  primary: cn(btnBase, 'bg-gradient-to-r from-brand to-brand-600 text-white shadow-[0_6px_16px_-8px_rgba(185,74,18,.7)] hover:brightness-105'),
  // End work: brand navy (white on dark backgrounds for contrast)
  end: cn(btnBase, 'bg-navy text-white hover:bg-navy-600 dark:bg-white dark:text-navy dark:hover:bg-white/90'),
  // Breaks / secondary
  quiet: cn(btnBase, 'border border-line bg-surface text-heading hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-300'),
};
const dot: Record<State | 'off', string> = {
  none: 'bg-ink-mute/50',
  in: 'bg-brand shadow-[0_0_0_3px_rgba(251,165,30,.22)] animate-pulse',
  break: 'bg-brand-600 shadow-[0_0_0_3px_rgba(185,74,18,.2)]',
  done: 'bg-navy dark:bg-white/80',
  off: 'bg-navy-300',
};

function useAttendanceState() {
  const flow = useClockFlow();
  const { data, ready } = useHR();
  const { session } = useStore();
  const t = flow.today;
  const today = companyDate(flow.now());
  const state: State = !t ? 'none'
    : t.state === 'On Break' ? 'break'
    : t.state === 'Checked In' ? 'in'
    : t.workDate === today && t.state === 'Checked Out' ? 'done' : 'none';
  // Day off (holiday / Saturday off / weekly off / approved leave): checked once per day.
  const [off, setOff] = useState<{ date: string; label: string | null } | null>(null);
  const onLeave = data.leaveRequests.some((r) => r.employeeId === session?.userId && r.status === 'Approved' && r.startDate <= today && r.endDate >= today);
  useEffect(() => {
    if (state !== 'none' || !ready || off?.date === today) return;
    let alive = true;
    void flow.dayOffLabel().then((label) => alive && setOff({ date: today, label }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ready, today, off?.date, data.holidays, data.calendar]);
  const dayOff = state === 'none' ? (onLeave ? 'On leave' : off?.date === today ? off.label : null) : null;
  return { ...flow, state, dayOff, ready };
}

/** Status line + controls (used inline and inside the popover). */
function Controls({ s, stacked }: { s: ReturnType<typeof useAttendanceState>; stacked?: boolean }) {
  const confirm = useConfirm();
  const { state, dayOff, clock, punch, brk, live, ready } = s;
  const locked = !!clock.busy || clock.coolingDown || !ready;
  const spin = (k: string) => clock.busy === k && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
  const anyway = async () => {
    const ok = await confirm({ title: 'Clock in on a day off?', message: `${dayOff} — no clock-in is needed. Clock in only if you are actually working today.`, confirmLabel: 'Clock in' });
    if (ok) void punch('punch_in', { skipDayOffCheck: true });
  };
  return (
    <div className={cn('flex items-center gap-2', stacked && 'flex-wrap')}>
      {state === 'none' && !dayOff && (
        <button type="button" className={btn.primary} disabled={locked} onClick={() => void punch('punch_in')}>
          {spin('in') || <LogIn className="h-4 w-4" aria-hidden />} {clock.busy === 'in' ? 'Clocking in…' : 'Clock In'}
        </button>
      )}
      {state === 'none' && dayOff && (
        <button type="button" className={btn.quiet} disabled={locked} onClick={anyway}>
          {spin('in') || <LogIn className="h-4 w-4" aria-hidden />} Clock in anyway
        </button>
      )}
      {state === 'in' && (
        <>
          <button type="button" className={btn.quiet} disabled={locked} onClick={() => void brk('break_start')}>
            {spin('break_start') || <Coffee className="h-4 w-4" aria-hidden />} Start Break
          </button>
          <button type="button" className={btn.end} disabled={locked} onClick={() => void punch('punch_out')}>
            {spin('out') || <LogOut className="h-4 w-4" aria-hidden />} {clock.busy === 'out' ? 'Clocking out…' : 'Clock Out'}
          </button>
        </>
      )}
      {state === 'break' && (
        <button type="button" className={btn.primary} disabled={locked} onClick={() => void brk('break_end')}>
          {spin('break_end') || <Coffee className="h-4 w-4" aria-hidden />} End Break
        </button>
      )}
      {state === 'done' && (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-navy/5 px-3 text-[13px] font-semibold text-navy dark:bg-white/10 dark:text-white">
          <Clock3 className="h-4 w-4" aria-hidden /> {hm(live?.net ?? s.today?.netMinutes ?? 0)} worked
        </span>
      )}
      {clock.slow && <span className="text-[11px] text-ink-mute">Slow connection…</span>}
    </div>
  );
}

function statusText(s: ReturnType<typeof useAttendanceState>) {
  const { state, dayOff, live, today, ready } = s;
  if (!ready) return { label: 'Checking…', value: '' };
  if (state === 'in') return { label: 'Working', value: hm(live?.net) };
  if (state === 'break') return { label: 'Break in progress', value: hm(live?.running) };
  if (state === 'done') return { label: 'Checked out', value: hm(live?.net ?? today?.netMinutes) };
  if (dayOff) return { label: dayOff, value: '' };
  return { label: 'Not checked in', value: '' };
}

export function AttendanceControl() {
  const { session } = useStore();
  const s = useAttendanceState();
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  if (!session?.employee) return null; // accounts without an employee record have no attendance
  const st = statusText(s);
  const dotState = s.state === 'none' && s.dayOff ? 'off' : s.state;
  const summary = (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dot[dotState])} aria-hidden />
      <span className="truncate text-[12.5px] font-medium text-ink-soft">{st.label}</span>
      {st.value && <span className="font-display text-[13px] font-semibold tabular-nums text-heading">{st.value}</span>}
    </span>
  );
  return (
    <>
      {/* Wide screens: everything inline */}
      <div className="hidden h-11 items-center gap-3 rounded-2xl border border-line bg-surface pl-3.5 pr-1 xl:flex" role="group" aria-label="Attendance">
        {summary}
        <Controls s={s} />
      </div>
      {/* Narrower screens: compact trigger + popover with the same controls */}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Attendance: ${st.label}${st.value ? ` ${st.value}` : ''}`}
            className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-2.5 transition hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 xl:hidden"
          >
            <Timer className="h-4 w-4 text-brand-600 sm:hidden" aria-hidden />
            <span className="hidden sm:flex">{summary}</span>
            <span className={cn('h-2 w-2 rounded-full sm:hidden', dot[dotState])} aria-hidden />
            <ChevronDown className={cn('h-3.5 w-3.5 text-ink-mute transition', open && 'rotate-180')} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content onClick={stopPortalBubble} align="end" sideOffset={8} collisionPadding={12} className={cn(floatingPanel, 'w-[300px] p-4')}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Attendance</div>
                <div className="mt-1">{summary}</div>
              </div>
            </div>
            <dl className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-canvas p-2.5 text-xs">
              <div><dt className="text-ink-mute">In</dt><dd className="font-semibold text-heading">{companyTime(s.today?.effIn)}</dd></div>
              <div><dt className="text-ink-mute">Break</dt><dd className="font-semibold text-heading">{s.live ? hm(s.live.brk) : '—'}</dd></div>
              <div><dt className="text-ink-mute">Out</dt><dd className="font-semibold text-heading">{companyTime(s.today?.effOut)}</dd></div>
            </dl>
            <Controls s={s} stacked />
            {s.clock.locMsg && <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">{s.clock.locMsg}</p>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
