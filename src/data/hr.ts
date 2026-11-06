// Employee operations: HR records, attendance, leave and daily work reports.
// Field names mirror the database (camelCase); see supabase/migrations/0012–0015.

export type EmploymentStatus = 'Active' | 'Probation' | 'Resigned';
export const EMPLOYMENT_STATUSES: EmploymentStatus[] = ['Active', 'Probation', 'Resigned'];

export interface Department { id: string; name: string; active: boolean }
export interface Designation {
  id: string;
  name: string;
  departmentId: string | null;
  reportTemplate: string | null;
  workspace: string;
  defaultRole: string;
  defaultPermissions: string[] | null;
  active: boolean;
}
export interface Shift {
  id: string;
  name: string;
  flexible: boolean;
  startTime: string | null;
  endTime: string | null;
  graceMinutes: number;
  requiredMinutes: number;
  workingDays: number[];
  unpaidBreaks: boolean;
  active: boolean;
  /** Overnight shifts end at their own next-day cutoff instead of local midnight. */
  overnight?: boolean;
  /** Next-day local time an unfinished overnight session is closed (default: 4h after the end). */
  autoCloseTime?: string | null;
}
export interface Employee {
  id: string;
  employeeCode: string;
  designationId: string;
  additionalDesignations: string[];
  departmentId: string | null;
  reportingManagerId: string | null;
  joiningDate: string | null;
  employmentStatus: EmploymentStatus;
  probationEndDate: string | null;
  dateOfBirth: string | null;
  shiftId: string | null;
  workLocation: string | null;
  updatedAt: string;
}
/** Name directory (no personal data). */
export interface DirectoryEntry {
  id: string;
  fullName: string;
  employeeCode: string;
  designationId: string;
  departmentId: string | null;
  reportingManagerId: string | null;
  employmentStatus: EmploymentStatus;
  accountStatus: string;
  role: string;
}
export interface Salary { id: string; employeeId: string; amount: number; currency: string; payFrequency: string; effectiveFrom: string | null; updatedAt: string }
export interface Setting { key: string; value: unknown; label: string | null }

export type AttendanceState = 'Not Checked In' | 'Checked In' | 'On Break' | 'Checked Out' | 'Missing Punch-out' | 'Auto Clock-Out';
export interface AttendanceDay {
  id: string;
  employeeId: string;
  workDate: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  correctedInAt: string | null;
  correctedOutAt: string | null;
  effIn: string | null;
  effOut: string | null;
  closedReason: string | null;
  source: 'punch' | 'correction';
  locationStatusIn: string | null;
  locationStatusOut: string | null;
  locationVerifiedAt: string | null;
  earlyCheckoutId: string | null;
  state: AttendanceState;
  grossMinutes: number | null;
  breakMinutes: number;
  netMinutes: number | null;
  requiredMinutes: number;
  late: boolean;
  earlyCheckout: boolean;
  updatedAt: string;
  /** Worked minutes below / above the day's required hours (closed days only). */
  shortMinutes: number | null;
  extraMinutes: number | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  previousPunchOutAt: string | null;
  /** When an unfinished session of this day is closed automatically (company timezone). */
  cutoffAt: string | null;
  autoClosedAt: string | null;
  closureNote: string | null;
  reviewStatus: 'pending_review' | 'corrected' | 'reviewed' | null;
  /** How the day ended: manual clock-out, automatic clock-out, approved correction, or the older "missing" closure. */
  outKind: 'manual' | 'auto' | 'corrected' | 'missing' | null;
  /** Clock-in to the automatic cutoff: recorded only, never credited as work. */
  recordedMinutes: number | null;
  unverifiedMinutes: number;
  correctionPending: boolean;
}
export interface BreakSession { id: string; sessionId: string; startAt: string; endAt: string | null }
export type RequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  workDate: string;
  correctionType: 'missed_punch_in' | 'missed_punch_out' | 'break_timing' | 'technical';
  requestedInAt: string | null;
  requestedOutAt: string | null;
  requestedBreakMinutes: number | null;
  reason: string;
  details: string | null;
  status: RequestStatus;
  original: Record<string, string | number | null> | null;
  applied: Record<string, string | number | null> | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
}
export const CORRECTION_LABEL: Record<AttendanceCorrection['correctionType'], string> = {
  missed_punch_in: 'Forgot to punch in',
  missed_punch_out: 'Forgot to punch out',
  break_timing: 'Incorrect break time',
  technical: 'Technical issue',
};
export interface EarlyCheckout {
  id: string;
  employeeId: string;
  workDate: string;
  requestedTime: string;
  reason: string;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  override: boolean;
  overrideReason: string | null;
  actualCheckoutAt: string | null;
  createdAt: string;
}
export interface LeaveType {
  id: string;
  name: string;
  annualDays: number;
  carryForward: boolean;
  carryForwardMax: number | null;
  accrual: 'upfront' | 'monthly';
  prorateNewJoiners: boolean;
  eligibleAfterDays: number;
  requiresReason: boolean;
  active: boolean;
  /** false for Loss of Pay: never limited by or deducted from a balance. */
  paid?: boolean;
}
export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: RequestStatus;
  managerApprovedBy: string | null;
  managerApprovedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  /** Half-day leave: which half of the date (0.5 day). */
  halfDaySession?: 'morning' | 'afternoon' | null;
}
export const halfDayLabel = (s?: string | null) => (s === 'morning' ? 'Morning Leave' : s === 'afternoon' ? 'Afternoon Leave' : null);
/** 22 → "22", 21.5 → "21.5" (never rounded to a whole day). */
export const fmtDays = (n: number | null | undefined) => String(Math.round(Number(n ?? 0) * 100) / 100);

/** One day as the server resolves it (public.attendance_calendar): the same values HR, payroll and the employee see. */
export interface DayStatus {
  day: string;
  code: 'P' | 'HD' | 'SL' | 'PL' | 'LOP' | 'A' | 'H' | 'WO' | 'UP' | 'OPEN' | null;
  label: string | null;
  halfSession: 'morning' | 'afternoon' | 'both' | null;
  working: boolean;
  attended: boolean;
  present: number;
  paidLeave: number;
  sickLeave: number;
  lop: number;
  absent: number;
  counted: boolean;
}
export interface MonthSummary {
  employeeId: string;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  sickLeaveDays: number;
  lopDays: number;
  absentDays: number;
  halfDays: number;
  holidays: number;
}
export interface LeaveEvent { id: number; requestId: string; employeeId: string; action: 'requested' | 'manager_approved' | 'approved' | 'rejected' | 'cancelled'; actorId: string | null; comment: string | null; at: string }
export interface LeaveBalance {
  employeeId: string;
  leaveType: string;
  name: string;
  leaveYear: number;
  entitled: number;
  carried: number;
  accrued: number;
  adjusted: number;
  used: number;
  pending: number;
  available: number;
}
export interface Holiday { id: string; holidayDate: string; name: string; kind: 'Company' | 'Public'; locations: string[]; departmentIds: string[]; active: boolean }
export interface CalendarDay { id: string; workDate: string; kind: 'saturday_off' | 'working_day' | 'day_off'; shiftId: string | null; note: string | null }

export interface TemplateField { key: string; label: string; type: 'count' | 'text' }
export interface TemplateSection { id: string; title: string; fields: TemplateField[] }
export interface ReportTemplate { id: string; version: number; name: string; sections: TemplateSection[]; active: boolean }
export interface MyTemplate extends ReportTemplate { designationId: string; designation: string }
export type ReportStatus = 'Draft' | 'Submitted' | 'Reviewed' | 'Correction Requested' | 'Approved';
export const REPORT_STATUSES: ReportStatus[] = ['Draft', 'Submitted', 'Reviewed', 'Correction Requested', 'Approved'];
export interface DailyReport {
  id: string;
  employeeId: string;
  templateId: string;
  templateVersion: number;
  designationId: string;
  departmentId: string | null;
  managerId: string | null;
  reportDate: string;
  status: ReportStatus;
  metrics: Record<string, number>;
  notes: Record<string, string>;
  sources: Record<string, string>;
  sourceActivityIds?: number[];
  metricDetails?: Record<string, MetricValue>;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkActivityType { id: string; label: string; source: 'crm' | 'logged'; description: string | null; sort: number }
export interface WorkActivity {
  id: string;
  employeeId: string;
  designationId: string | null;
  activityType: string;
  source: 'crm' | 'logged';
  entityType: string | null;
  entityId: string | null;
  applicationId: string | null;
  studentId: string | null;
  partnerId: string | null;
  quantity: number;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  occurredAt: string;
  reportDate: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}
export interface MetricSource { templateId: string; fieldKey: string; kind: 'activity' | 'workload'; activityTypes: string[]; workload: string | null }
/** Server-computed figure of a report field. */
export interface MetricValue { value: number; kind: 'activity' | 'workload'; activity_ids?: number[]; application_ids?: string[] }
export const WORKLOAD_LABEL: Record<string, string> = {
  apps_new: 'Applications assigned to you in Draft or Pending Assessment',
  apps_awaiting: 'Applications assigned to you awaiting a university decision (Submitted, Offer Pending)',
  apps_conditional: 'Applications assigned to you with a Conditional Offer',
  apps_cas_visa: 'Applications assigned to you at Unconditional Offer or Visa Lodged',
  apps_open: 'Open applications assigned to you (not yet Visa Granted / Refused)',
};

export interface Reminder { kind: 'birthday' | 'anniversary' | 'probation' | 'leave' | 'holiday'; onDate: string; employeeId: string | null; title: string; detail: string | null }

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "8h 05m" from minutes. */
export const hm = (min: number | null | undefined) => {
  if (min == null || Number.isNaN(min)) return '—';
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

const TZ = 'Asia/Kolkata';
/** Date (YYYY-MM-DD) in the company timezone. */
export function companyDate(d: Date | string = new Date(), tz = TZ) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  return p;
}
/** HH:MM in the company timezone. */
export function companyTime(d: Date | string | null | undefined, tz = TZ) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}
/** Company-local date + time → ISO instant (IST has no daylight saving). */
export function companyInstant(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const isoDow = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

/** Message from a database error like "LEAVE_BALANCE: Not enough …" → "Not enough …". */
export function serverMessage(e: unknown, fallback = 'Something went wrong. Please try again.') {
  const m = (e as { message?: string } | null)?.message ?? '';
  if (!m) return fallback;
  if (/permission denied|violates row-level security|JWT|not allowed/i.test(m)) return 'You do not have permission to do this.';
  return m.replace(/^[A-Z_]+:\s*/, '');
}
