// Pure validation helpers for the admin-users function (unit-tested in lib.test.ts).

export const STAFF_ROLES = ['super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff'] as const;
export const PARTNER_ROLES = ['partner_admin', 'partner_staff'] as const;
export const STAFF_MODULES = ['partners', 'students', 'applications', 'assessments', 'documents', 'finance', 'catalogue', 'tasks', 'updates', 'reports',
  'work_reports', 'hr', 'hr_accounts', 'hr_salary'] as const;
/** Permissions only a Super Admin may grant or remove. */
export const HR_MODULES = ['hr', 'hr_accounts', 'hr_salary'] as const;
/** Permissions HR account managers may not grant (HR rights and financial access). */
export const HR_RESTRICTED = [...HR_MODULES, 'finance'] as const;
/** Roles HR account managers may create or manage. */
export const HR_MANAGEABLE_ROLES = ['application_manager', 'assessment_staff', 'finance_staff', 'support_staff'] as const;
export const PARTNER_MODULES = ['students', 'applications', 'course_finder', 'assessments', 'documents', 'finance', 'updates'] as const;
export const STATUSES = ['active', 'suspended', 'deactivated'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];
export type PartnerRole = (typeof PARTNER_ROLES)[number];

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isStaffRole = (r: unknown): r is StaffRole => STAFF_ROLES.includes(r as StaffRole);
export const isPartnerRole = (r: unknown): r is PartnerRole => PARTNER_ROLES.includes(r as PartnerRole);

export function cleanEmail(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

export function cleanName(v: unknown, min = 2, max = 100): string | null {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s.length >= min && s.length <= max ? s : null;
}

/** Problems with an admin-chosen password; empty when acceptable. Same rules as the app. */
export function passwordProblems(pw: unknown, email = ''): string[] {
  if (typeof pw !== 'string') return ['a password'];
  const issues: string[] = [];
  if (pw.length < 12) issues.push('at least 12 characters');
  if (new TextEncoder().encode(pw).length > 72) issues.push('at most 72 bytes');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('upper- and lower-case letters');
  if (!/\d/.test(pw)) issues.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('a symbol');
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && pw.toLowerCase().includes(local)) issues.push('not contain the email name');
  return issues;
}

/** null = use the role's defaults; otherwise a de-duplicated list of known modules. */
export function cleanPermissions(v: unknown): string[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v)) return undefined;
  const set = [...new Set(v.map(String))];
  return set.every((m) => (STAFF_MODULES as readonly string[]).includes(m)) ? set : undefined;
}

export function cleanModules(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const set = [...new Set(v.map(String))];
  return set.every((m) => (PARTNER_MODULES as readonly string[]).includes(m)) ? set : undefined;
}

/** Optional short text (phone, department, designation…); null when empty, undefined when invalid. */
export function cleanOptional(v: unknown, max = 80): string | null | undefined {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.length <= max ? s : undefined;
}

export interface PartnerInput {
  name: string;
  code: string;
  contact_name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  website: string | null;
  tier: 'Platinum' | 'Gold' | 'Silver';
  branches: string[];
  commission_rate: number;
  address: string | null;
}

export function cleanPartner(v: unknown): PartnerInput | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const name = cleanName(p.name, 3, 120);
  const code = String(p.code ?? '').trim().toUpperCase();
  const contact = cleanName(p.contactName);
  const email = cleanEmail(p.email);
  const phone = String(p.phone ?? '').trim();
  const city = cleanName(p.city, 1, 80);
  const tier = ['Platinum', 'Gold', 'Silver'].includes(String(p.tier)) ? (String(p.tier) as PartnerInput['tier']) : 'Silver';
  const rate = Number(p.commissionRate ?? 10);
  if (!name || !/^[A-Z]{2,5}$/.test(code) || !contact || !email || phone.replace(/\D/g, '').length < 8 || !city) return null;
  if (!Number.isFinite(rate) || rate < 0 || rate > 40) return null;
  const branches = Array.isArray(p.branches) ? p.branches.map((b) => String(b).trim()).filter(Boolean).slice(0, 30) : [];
  const website = String(p.website ?? '').trim().slice(0, 200);
  return {
    name,
    code,
    contact_name: contact,
    email,
    phone: phone.slice(0, 40),
    city,
    country: String(p.country ?? 'India').trim().slice(0, 60) || 'India',
    website: website || null,
    tier,
    branches: branches.length ? branches : [city],
    commission_rate: rate,
    address: String(p.address ?? '').trim().slice(0, 300) || null,
  };
}

export interface EmployeeInput {
  employee_code: string;
  designation_id: string;
  additional_designations: string[];
  department_id: string | null;
  reporting_manager_id: string | null;
  joining_date: string | null;
  employment_status: 'Active' | 'Probation' | 'Resigned';
  probation_end_date: string | null;
  date_of_birth: string | null;
  shift_id: string | null;
  work_location: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9_-]{1,60}$/;
const optDate = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
const optSlug = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' && (SLUG_RE.test(v) || UUID_RE.test(v)) ? v : undefined);

/** Employee record sent with create_employee; null when anything is invalid. */
export function cleanEmployee(v: unknown): EmployeeInput | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  const code = typeof e.employee_code === 'string' ? e.employee_code.trim() : '';
  if (!/^[A-Za-z0-9._/-]{1,30}$/.test(code)) return null;
  if (typeof e.designation_id !== 'string' || !SLUG_RE.test(e.designation_id)) return null;
  const extra = Array.isArray(e.additional_designations) ? e.additional_designations : [];
  if (extra.length > 5 || !extra.every((x) => typeof x === 'string' && SLUG_RE.test(x))) return null;
  const status = e.employment_status ?? 'Active';
  if (!['Active', 'Probation', 'Resigned'].includes(status as string)) return null;
  const manager = e.reporting_manager_id == null || e.reporting_manager_id === '' ? null : String(e.reporting_manager_id);
  if (manager !== null && !UUID_RE.test(manager)) return null;
  const department = optSlug(e.department_id), shift = optSlug(e.shift_id);
  const joining = optDate(e.joining_date), probation = optDate(e.probation_end_date), dob = optDate(e.date_of_birth);
  const location = cleanOptional(e.work_location, 80);
  if ([department, shift, joining, probation, dob, location].some((x) => x === undefined)) return null;
  return {
    employee_code: code, designation_id: e.designation_id, additional_designations: [...new Set(extra as string[])].filter((x) => x !== e.designation_id),
    department_id: department as string | null, reporting_manager_id: manager, joining_date: joining as string | null,
    employment_status: status as EmployeeInput['employment_status'], probation_end_date: probation as string | null,
    date_of_birth: dob as string | null, shift_id: shift as string | null, work_location: location as string | null,
  };
}

/** Salary sent with create_employee (only applied for callers allowed to see salaries). */
export function cleanSalary(v: unknown): { amount: number; currency: string } | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  const amount = Number(s.amount);
  const currency = typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : 'INR';
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) return undefined;
  return { amount, currency };
}

/** HR account managers: allowed permission lists keep their HR part unchanged and add nothing restricted. */
export function hrPermissionProblem(next: string[] | null, prev: string[] | null): string | null {
  const restricted = (l: string[] | null) => (l ?? []).filter((m) => (HR_RESTRICTED as readonly string[]).includes(m)).sort().join(',');
  if (restricted(next) !== restricted(prev)) return 'Only a Super Admin can grant HR or finance permissions.';
  return null;
}
