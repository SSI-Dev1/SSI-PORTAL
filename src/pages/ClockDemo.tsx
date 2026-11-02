// Development-only harness (route #/ui/clock?state=none|in|done&theme=light|dark): the header
// Clock In / Clock Out pill with sample attendance, for side-by-side comparison with the
// Broken English Studio original. Nothing is saved.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HeaderClockButton, HeaderClockPill } from '../components/ClockPill';
import { StoreContext, type StoreValue } from '../store/store';
import { HRContext, type HRData, type HRValue } from '../store/hr';
import type { AttendanceDay } from '../data/hr';
import { companyDate } from '../data/hr';

export default function ClockDemo() {
  const [params] = useSearchParams();
  const state = params.get('state') ?? 'none';
  const today = companyDate();
  const at = (t: string) => new Date(`${today}T${t}:00+05:30`).toISOString();
  const row: AttendanceDay | null = state === 'none' ? null : {
    id: 'demo', employeeId: 'demo', workDate: today, punchInAt: at('09:20'), punchOutAt: state === 'done' ? at('18:40') : null,
    correctedInAt: null, correctedOutAt: null, effIn: at('09:20'), effOut: state === 'done' ? at('18:40') : null, closedReason: null, source: 'punch',
    locationStatusIn: 'captured', locationStatusOut: null, locationVerifiedAt: null, earlyCheckoutId: null,
    state: state === 'done' ? 'Checked Out' : 'Checked In', grossMinutes: 560, breakMinutes: 0, netMinutes: 560, requiredMinutes: 480,
    late: false, earlyCheckout: false, updatedAt: at('09:20'), shortMinutes: null, extraMinutes: null, reopenedAt: null, reopenedBy: null, reopenReason: null, previousPunchOutAt: null,
  };
  const store = useMemo(() => ({ db: { staff: [] }, session: { role: 'staff', userRole: 'support_staff', userId: 'demo', name: 'Demo', email: '', title: '', permissions: [], partnerModules: [], employee: true, designations: [], hasTeam: false }, actions: {}, loading: false, live: 'live', profilesRev: 0 }) as unknown as StoreValue, []);
  const hr = useMemo(() => ({
    data: { attendance: row ? [row] : [], breaks: [], holidays: [], calendar: [], leaveRequests: [], earlyCheckouts: [], settings: [] } as unknown as HRData,
    ready: true, enabled: true, now: () => new Date(), load: async () => undefined, setting: <V,>(_k: string, f: V) => f,
    call: async () => ({ ok: false as const, error: 'Demo only — nothing is saved' }), write: async () => false,
  }) as unknown as HRValue, [state]);
  return (
    <StoreContext.Provider value={store}>
      <HRContext.Provider value={hr}>
        <div className="flex min-h-screen items-start gap-3 bg-surface p-[14px]">
          <HeaderClockPill />
          <HeaderClockButton />
        </div>
      </HRContext.Provider>
    </StoreContext.Provider>
  );
}
