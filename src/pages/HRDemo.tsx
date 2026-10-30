// Development-only harness (route #/ui/hr/<page>): the real employee and HR pages rendered with
// clearly fake sample data and an in-memory "server", to check layout and interactions.
// Business rules are tested against PostgreSQL in supabase/tests/70_hr_tests.sql.
import { useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { StoreContext, type StoreValue } from '../store/store';
import { HRContext, type HRData, type HRValue } from '../store/hr';
import type { DB, Session } from '../data/types';
import { addDays, companyDate } from '../data/hr';
import WorkDashboard from './work/WorkDashboard';
import MyReport from './work/MyReport';
import MyAttendance from './work/MyAttendance';
import MyLeave from './work/MyLeave';
import Holidays from './work/Holidays';
import Team from './work/Team';
import HRDashboard from './hr/HRDashboard';
import Employees from './hr/Employees';
import WorkReports from './hr/WorkReports';
import HRLeave from './hr/HRLeave';
import { HRSettings } from './hr/HRMisc';
import HRAttendance from './hr/HRAttendance';

const T = companyDate();
const ME = 'demo-mgr';
const at = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`).toISOString();

function sample(): HRData {
  const person = (id: string, fullName: string, code: string, designationId: string, manager: string | null, status: 'Active' | 'Probation' = 'Active') =>
    ({ id, fullName, employeeCode: code, designationId, departmentId: designationId.startsWith('partner') ? 'partnerships' : 'applications', reportingManagerId: manager, employmentStatus: status, accountStatus: 'active', role: 'support_staff' });
  const directory = [
    person(ME, 'Manu Manager (sample)', 'DEMO-1', 'senior_international_recruitment_manager', null),
    person('demo-po', 'Priya Partnerships (sample)', 'DEMO-2', 'partnership_officer', ME, 'Probation'),
    person('demo-app', 'Arun Applications (sample)', 'DEMO-3', 'application_team', ME),
  ];
  const templates = [{
    id: 'senior_recruitment_manager', version: 1, name: 'Senior International Recruitment Manager — Daily Work Report', active: true,
    sections: [
      { id: 'development', title: 'Partner Development', fields: [{ key: 'pd_new_partners_contacted', label: 'New partners contacted', type: 'count' }, { key: 'pd_partners_onboarded', label: 'Partners onboarded', type: 'count' }] },
      { id: 'summary', title: 'Daily Summary', fields: [{ key: 'achievements', label: 'Key Achievements', type: 'text' }, { key: 'tomorrow_plan', label: "Tomorrow's Plan", type: 'text' }] },
    ],
  }, {
    id: 'partnership_officer', version: 1, name: 'Partnership Officer — Daily Work Report', active: true,
    sections: [{ id: 'outreach', title: 'Partner Outreach & Onboarding', fields: [{ key: 'po_new_partners_contacted', label: 'New partners contacted', type: 'count' }, { key: 'po_mous_signed', label: 'MOUs signed', type: 'count' }] },
      { id: 'updates', title: 'Key Updates', fields: [{ key: 'achievements', label: "Today's Achievements", type: 'text' }] }],
  }] as HRData['templates'];
  const day = (id: string, emp: string, d: string, inT: string, outT: string | null, brk: number, late = false) => {
    const effIn = at(d, inT);
    const effOut = outT ? at(d, outT) : null;
    const gross = effOut ? (new Date(effOut).getTime() - new Date(effIn).getTime()) / 60000 : (Date.now() - new Date(effIn).getTime()) / 60000;
    return { id, employeeId: emp, workDate: d, punchInAt: effIn, punchOutAt: effOut, correctedInAt: null, correctedOutAt: null, effIn, effOut, closedReason: null, source: 'punch' as const,
      locationStatusIn: 'captured', locationStatusOut: outT ? 'denied' : null, locationVerifiedAt: null, earlyCheckoutId: null, state: (outT ? 'Checked Out' : 'Checked In') as 'Checked Out',
      grossMinutes: Math.round(gross), breakMinutes: brk, netMinutes: Math.round(gross - brk), requiredMinutes: 480, late, earlyCheckout: !!outT && gross - brk < 480, updatedAt: effIn };
  };
  return {
    employees: directory.map((p) => ({ id: p.id, employeeCode: p.employeeCode, designationId: p.designationId, additionalDesignations: [], departmentId: p.departmentId, reportingManagerId: p.reportingManagerId, joiningDate: '2025-01-06', employmentStatus: p.employmentStatus, probationEndDate: null, dateOfBirth: null, shiftId: 'standard', workLocation: 'Kochi', updatedAt: T })),
    directory,
    departments: [{ id: 'partnerships', name: 'Partnerships', active: true }, { id: 'applications', name: 'Applications', active: true }],
    designations: [
      { id: 'senior_international_recruitment_manager', name: 'Senior International Recruitment Manager', departmentId: 'partnerships', reportTemplate: 'senior_recruitment_manager', workspace: 'x', defaultRole: 'application_manager', defaultPermissions: null, active: true },
      { id: 'partnership_officer', name: 'Partnership Officer', departmentId: 'partnerships', reportTemplate: 'partnership_officer', workspace: 'x', defaultRole: 'support_staff', defaultPermissions: null, active: true },
      { id: 'application_team', name: 'Application Team', departmentId: 'applications', reportTemplate: 'application_team', workspace: 'x', defaultRole: 'application_manager', defaultPermissions: null, active: true },
    ],
    shifts: [{ id: 'standard', name: 'Standard (Mon–Sat, 8 hours)', flexible: false, startTime: '09:30:00', endTime: '18:30:00', graceMinutes: 15, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5, 6], unpaidBreaks: true, active: true }],
    salaries: [],
    settings: [{ key: 'location_policy', value: 'optional', label: null }, { key: 'early_checkout_monthly_limit', value: 2, label: null }, { key: 'leave_approval', value: 'manager_or_hr', label: null }, { key: 'saturday_offs_per_month', value: 1, label: null }, { key: 'leave_year_start_month', value: 1, label: null }, { key: 'location_retention_days', value: 180, label: null }, { key: 'leave_counts_non_working_days', value: false, label: null }],
    attendance: [day('a1', ME, T, '09:20', null, 15), day('a2', 'demo-po', T, '09:52', null, 0, true), day('a3', ME, addDays(T, -1), '09:25', '18:40', 60), day('a4', 'demo-app', addDays(T, -1), '10:05', '17:10', 45, true)],
    breaks: [{ id: 'b1', sessionId: 'a1', startAt: at(T, '11:00'), endAt: at(T, '11:15') }],
    corrections: [{ id: 'c1', employeeId: 'demo-app', workDate: addDays(T, -2), correctionType: 'missed_punch_out', requestedInAt: null, requestedOutAt: at(addDays(T, -2), '18:35'), requestedBreakMinutes: null, reason: 'Forgot after client call (sample)', details: null, status: 'Pending', original: { punch_in_at: at(addDays(T, -2), '09:30'), punch_out_at: null }, applied: null, decidedBy: null, decidedAt: null, decisionComment: null, createdAt: T }],
    earlyCheckouts: [{ id: 'e1', employeeId: 'demo-po', workDate: T, requestedTime: at(T, '15:30'), reason: 'Family emergency (sample)', status: 'Pending', decidedBy: null, decidedAt: null, decisionComment: null, override: false, overrideReason: null, actualCheckoutAt: null, createdAt: T }],
    leaveTypes: [{ id: 'paid', name: 'Paid Leave', annualDays: 12, carryForward: true, carryForwardMax: null, accrual: 'upfront', prorateNewJoiners: false, eligibleAfterDays: 0, requiresReason: true, active: true },
      { id: 'sick', name: 'Sick Leave', annualDays: 12, carryForward: false, carryForwardMax: null, accrual: 'upfront', prorateNewJoiners: false, eligibleAfterDays: 0, requiresReason: true, active: true }],
    leaveRequests: [{ id: 'l1', employeeId: 'demo-po', leaveType: 'paid', startDate: addDays(T, 9), endDate: addDays(T, 10), days: 2, reason: 'Wedding (sample)', status: 'Pending', managerApprovedBy: null, managerApprovedAt: null, decidedBy: null, decidedAt: null, decisionComment: null, createdAt: T }],
    balances: directory.flatMap((p) => [
      { employeeId: p.id, leaveType: 'paid', name: 'Paid Leave', leaveYear: Number(T.slice(0, 4)), entitled: 12, carried: 3, accrued: 12, adjusted: 0, used: 2, pending: p.id === 'demo-po' ? 2 : 0, available: p.id === 'demo-po' ? 11 : 13 },
      { employeeId: p.id, leaveType: 'sick', name: 'Sick Leave', leaveYear: Number(T.slice(0, 4)), entitled: 12, carried: 0, accrued: 12, adjusted: 0, used: 1, pending: 0, available: 11 },
    ]),
    holidays: [{ id: 'h1', holidayDate: addDays(T, 6), name: 'Sample Festival', kind: 'Public', locations: [], departmentIds: [], active: true }],
    calendar: [],
    reports: [{ id: 'r1', employeeId: 'demo-po', templateId: 'partnership_officer', templateVersion: 1, designationId: 'partnership_officer', departmentId: 'partnerships', managerId: ME, reportDate: T, status: 'Submitted', metrics: { po_new_partners_contacted: 6, po_mous_signed: 1 }, notes: { achievements: 'Signed MOU with a sample agency.' }, sources: {}, submittedAt: at(T, '17:45'), reviewedBy: null, reviewedAt: null, reviewComment: null, createdAt: T, updatedAt: T }],
    templates,
    myTemplates: [{ ...templates[0], designationId: 'senior_international_recruitment_manager', designation: 'Senior International Recruitment Manager' }],
  } as HRData;
}

const PAGES: [string, string, React.ReactNode][] = [
  ['work', 'Employee dashboard', <WorkDashboard key="w" />], ['report', 'Daily report', <MyReport key="r" />], ['attendance', 'My attendance', <MyAttendance key="a" />],
  ['leave', 'My leave', <MyLeave key="l" />], ['team', 'Team', <Team key="t" />], ['holidays', 'Holidays', <Holidays key="h" />],
  ['hr', 'HR dashboard', <HRDashboard key="hd" />], ['employees', 'Employees', <Employees key="e" />], ['hr-attendance', 'HR attendance', <HRAttendance key="ha" />],
  ['hr-leave', 'HR leave', <HRLeave key="hl" />], ['reports', 'Work reports', <WorkReports key="wr" />], ['settings', 'HR settings', <HRSettings key="s" />],
];

export default function HRDemo() {
  const [data, setData] = useState<HRData>(sample);
  const [log, setLog] = useState<string[]>([]);
  const session: Session = { role: 'staff', userRole: 'application_manager', userId: ME, name: 'Manu Manager', email: '', title: 'Senior International Recruitment Manager', permissions: ['hr', 'hr_accounts', 'tasks', 'applications', 'students'], partnerModules: [], employee: true, designations: ['senior_international_recruitment_manager'], hasTeam: true };
  const store = useMemo(() => ({ db: { staff: [], applications: [], students: [], tasks: [] } as unknown as DB, session, actions: {}, loading: false, live: 'live', profilesRev: 0 }) as unknown as StoreValue, [session]);
  const hr = useMemo<HRValue>(() => ({
    data, ready: true, enabled: true,
    load: async () => undefined,
    now: () => new Date(),
    setting: <V,>(k: string, f: V) => ((data.settings.find((s) => s.key === k)?.value ?? f) as V),
    call: async (fn: string, args: Record<string, unknown>) => {
      setLog((l) => [`${fn}(${JSON.stringify(args).slice(0, 120)})`, ...l].slice(0, 8));
      if (fn === 'save_daily_report') {
        setData((d) => ({ ...d, reports: [{ id: `r${Date.now()}`, employeeId: ME, templateId: args.p_template as string, templateVersion: 1, designationId: 'senior_international_recruitment_manager', departmentId: 'partnerships', managerId: null, reportDate: args.p_date as string, status: args.p_submit ? 'Submitted' : 'Draft', metrics: args.p_metrics as Record<string, number>, notes: args.p_notes as Record<string, string>, sources: args.p_sources as Record<string, string>, submittedAt: args.p_submit ? new Date().toISOString() : null, reviewedBy: null, reviewedAt: null, reviewComment: null, createdAt: T, updatedAt: new Date().toISOString() }, ...d.reports.filter((r) => !(r.employeeId === ME && r.reportDate === args.p_date))] }));
      }
      if (fn === 'break_start') setData((d) => ({ ...d, breaks: [...d.breaks, { id: 'b2', sessionId: 'a1', startAt: new Date().toISOString(), endAt: null }], attendance: d.attendance.map((a) => (a.id === 'a1' ? { ...a, state: 'On Break' } : a)) }));
      if (fn === 'break_end') setData((d) => ({ ...d, breaks: d.breaks.map((b) => (b.endAt ? b : { ...b, endAt: new Date().toISOString() })), attendance: d.attendance.map((a) => (a.id === 'a1' ? { ...a, state: 'Checked In' } : a)) }));
      return { ok: true as const, data: undefined as never };
    },
    write: async (table: string, op: string) => {
      setLog((l) => [`${op} ${table}`, ...l].slice(0, 8));
      return true;
    },
  }) as unknown as HRValue, [data]);
  return (
    <StoreContext.Provider value={store}>
      <HRContext.Provider value={hr}>
        <div className="min-h-screen bg-canvas">
          <div className="sticky top-0 z-30 flex flex-wrap gap-1.5 border-b border-line bg-surface/90 p-3 text-xs backdrop-blur">
            <b className="mr-2 self-center text-heading">HR harness (sample data)</b>
            {PAGES.map(([k, label]) => <NavLink key={k} to={`/ui/hr/${k}`} className={({ isActive }) => `rounded-lg border px-2 py-1 ${isActive ? 'border-rust text-rust' : 'border-line text-ink-soft'}`}>{label}</NavLink>)}
            <span className="ml-auto max-w-[40%] truncate self-center text-ink-mute" title={log.join('\n')}>{log[0] ?? 'no calls yet'}</span>
          </div>
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
            <Routes>{PAGES.map(([k, , el]) => <Route key={k} path={k} element={el} />)}</Routes>
          </div>
        </div>
      </HRContext.Provider>
    </StoreContext.Provider>
  );
}
