// Header Clock In / Clock Out — the same pill Broken English Studio shows in its top header
// (Production-Suite/be-shell.js "Header clock pill"): markup, class names, states and CSS are
// taken from there (src/styles/be-clockpill.css). Phones get BE's round top-bar button.
//
// Unlike BE, which mirrors a hidden attendance card, the pill reads today's attendance row from
// the database (useClockFlow) and acts through the same clock_action as every other control,
// so it only changes after the server has saved the action.
import { useEffect, useState } from 'react';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '../styles/be-clockpill.css';
import { useClockFlow } from './hr';
import { useConfirm } from './feedback';
import { useHR } from '../store/hr';
import { useStore } from '../store/store';
import { companyDate } from '../data/hr';

const IC_IN = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></svg>
);
const IC_OUT = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);
const IC_DONE = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

/** "09:20 AM" in the company timezone (BE shows 12-hour times). */
const t12 = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)) : '';
/** BE's worked(): clock-in to clock-out, "8h 05m". */
const worked = (a: string | null, b: string | null) => {
  if (!a || !b) return '';
  const d = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return d < 0 ? '' : `${Math.floor(d / 60)}h ${String(d % 60).padStart(2, '0')}m`;
};

type Mode = { state: 'none' | 'in' | 'done'; dayOff: string | null };

function useClockMode() {
  const flow = useClockFlow();
  const { data, ready } = useHR();
  const { session } = useStore();
  const today = companyDate(flow.now());
  const t = flow.today;
  const state: Mode['state'] = t && (t.state === 'Checked In' || t.state === 'On Break') ? 'in' : t && t.workDate === today && t.state === 'Checked Out' ? 'done' : 'none';
  // Day off (holiday / Saturday off / weekly off / full-day approved leave), checked once a day.
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
  return { ...flow, mode: { state, dayOff } as Mode, ready };
}

export function HeaderClockPill() {
  const { session } = useStore();
  const confirm = useConfirm();
  const { today, mode, clock, punch, ready } = useClockMode();
  if (!session?.employee) return null; // no attendance for accounts without an employee record
  const { state, dayOff } = mode;
  const busy = clock.busy === 'in' || clock.busy === 'out';
  const anyway = async () => {
    const ok = await confirm({ title: 'Clock in on a day off?', message: `${dayOff ?? 'Today is not a working day'} — no clock-in is needed. Clock in only if you are actually working today.`, confirmLabel: 'Clock in' });
    if (ok) void punch('punch_in', { skipDayOffCheck: true });
  };
  const hrs = state === 'done' ? worked(today?.effIn ?? null, today?.effOut ?? null) : '';
  const out = state === 'in';
  const showBtn = busy || ((state === 'none' || state === 'in') && !dayOff);
  return (
    <div className={`bes-clockpill${state === 'in' ? ' is-in' : ''}${state === 'done' || dayOff ? ' is-done' : ''}`} role="group" aria-label="Attendance">
      <span className="bcp-dot" aria-hidden="true" />
      <span className="bcp-txt">
        {state === 'done' ? (
          <>✓ {today?.effIn && today?.effOut ? <>Done <b>{t12(today.effIn)} – {t12(today.effOut)}</b></> : 'Attendance completed'}{hrs && <> <span className="bcp-hrs">· {hrs}</span></>}</>
        ) : dayOff ? (
          <><b>{dayOff}</b> · no clock-in needed</>
        ) : state === 'in' ? (
          today?.effIn ? <>In since <b>{t12(today.effIn)}</b></> : 'Clocked in'
        ) : !ready ? 'Checking…' : 'Not clocked in'}
      </span>
      <button
        type="button"
        className={`bcp-btn ${busy ? (clock.busy === 'out' ? 'out' : 'in') : out ? 'out' : 'in'}`}
        hidden={!showBtn}
        disabled={busy || clock.coolingDown || !ready || !!clock.busy}
        title={state === 'in' ? `In since ${t12(today?.effIn)}` : undefined}
        onClick={() => void punch(out ? 'punch_out' : 'punch_in')}
      >
        {busy ? (
          <><span className="bclk-spin" /><span>{clock.busy === 'out' ? 'Clocking out…' : 'Clocking in…'}{clock.slow ? ' (slow connection)' : ''}</span></>
        ) : (
          <>{out ? IC_OUT : IC_IN}<span>{out ? 'Clock Out' : 'Clock In'}</span></>
        )}
      </button>
      <span className={`bcp-chip${dayOff ? ' off' : ''}`} hidden={busy || !(state === 'done' || dayOff)} aria-disabled="true" title={dayOff ?? 'Clock In opens again tomorrow'}>
        {dayOff ? 'Day off' : 'Completed today'}
      </span>
      <button type="button" className="bcp-link" hidden={busy || !dayOff} onClick={anyway}>Clock in anyway</button>
    </div>
  );
}

/** Phone top bar: BE's round Clock In / Clock Out button. */
export function HeaderClockButton() {
  const { session } = useStore();
  const confirm = useConfirm();
  const { mode, clock, punch, ready, today } = useClockMode();
  if (!session?.employee) return null;
  const { state, dayOff } = mode;
  const target = (state === 'none' || state === 'in') && !dayOff;
  const lbl = state === 'in' ? `Clock Out — In since ${t12(today?.effIn)}`
    : state === 'done' ? 'Attendance completed · Completed today'
    : dayOff ? `${dayOff} · no clock-in needed` : 'Clock In — Not clocked in';
  const onClick = async () => {
    if (target) return void punch(state === 'in' ? 'punch_out' : 'punch_in');
    if (dayOff) {
      const ok = await confirm({ title: 'Clock in on a day off?', message: `${dayOff} — no clock-in is needed. Clock in only if you are actually working today.`, confirmLabel: 'Clock in' });
      if (ok) void punch('punch_in', { skipDayOffCheck: true });
    }
  };
  return (
    <button
      type="button"
      className={`bcp-mbtn ${target ? (state === 'in' ? 'out' : 'in') : 'done'}`}
      aria-label={lbl}
      title={lbl}
      disabled={!!clock.busy || clock.coolingDown || !ready || (!target && !dayOff)}
      onClick={onClick}
    >
      {clock.busy === 'in' || clock.busy === 'out' ? <span className="bclk-spin" /> : target ? (state === 'in' ? IC_OUT : IC_IN) : IC_DONE}
    </button>
  );
}
