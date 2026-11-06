// Roles and module names shared by the UI. The database is the authority (see
// supabase/migrations/0004_account_management.sql): these lists only label things and
// decide which menu items to show; RLS refuses anything not permitted regardless.
import type { UserRole } from '../data/types';

export const STAFF_ROLES = ['super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff'] as const;
export const PARTNER_ROLES = ['partner_admin', 'partner_staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin_staff: 'Admin Staff',
  application_manager: 'Application Manager',
  assessment_staff: 'Assessment Staff',
  finance_staff: 'Finance Staff',
  support_staff: 'Support Staff',
  partner_admin: 'Partner Admin',
  partner_staff: 'Partner Staff',
};

export const isStaffRole = (r: UserRole): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);
/** Super Admins and Admin Staff use the Admin Portal; other employees use the Staff Portal. */
export const portalFor = (r: UserRole): 'admin' | 'staff' | 'client' =>
  r === 'super_admin' || r === 'admin_staff' ? 'admin' : isStaffRole(r) ? 'staff' : 'client';

export type StaffModule = 'partners' | 'students' | 'applications' | 'assessments' | 'documents' | 'finance' | 'catalogue' | 'tasks' | 'updates' | 'reports'
  | 'work_reports' | 'hr' | 'hr_accounts' | 'hr_salary';
export const STAFF_MODULES: { id: StaffModule; label: string; hint: string }[] = [
  { id: 'partners', label: 'Clients & Branches', hint: 'Partner organisations and contacts' },
  { id: 'students', label: 'Students', hint: 'Student records of every partner' },
  { id: 'applications', label: 'Applications', hint: 'Applications, offers and visa stages' },
  { id: 'assessments', label: 'Assessments', hint: 'Eligibility reviews' },
  { id: 'documents', label: 'Documents', hint: 'Student files and verification' },
  { id: 'finance', label: 'Finance', hint: 'Invoices and payments' },
  { id: 'catalogue', label: 'Providers & Courses', hint: 'Universities and course catalogue' },
  { id: 'tasks', label: 'Tasks & Reminders', hint: 'Internal task list' },
  { id: 'updates', label: 'Important Updates', hint: 'Announcements to partners' },
  { id: 'reports', label: 'Reports', hint: 'Analytics and exports' },
  { id: 'work_reports', label: 'Daily Work Reports', hint: 'Every employee\'s daily reports' },
  { id: 'hr', label: 'HR Portal', hint: 'Employees, attendance, leave, holidays (Super Admin grants)' },
  { id: 'hr_accounts', label: 'HR · Employee accounts', hint: 'Create and manage employee logins (Super Admin grants)' },
  { id: 'hr_salary', label: 'HR · Salaries', hint: 'View and edit salaries (Super Admin grants)' },
];
/** Only a Super Admin can grant these. */
export const HR_MODULES: StaffModule[] = ['hr', 'hr_accounts', 'hr_salary'];
/** HR account managers can create these roles only. */
export const HR_MANAGEABLE_ROLES: StaffRole[] = ['application_manager', 'assessment_staff', 'finance_staff', 'support_staff'];

export const ROLE_DEFAULTS: Record<StaffRole, StaffModule[]> = {
  super_admin: STAFF_MODULES.map((m) => m.id),
  admin_staff: STAFF_MODULES.map((m) => m.id).filter((m) => !HR_MODULES.includes(m)),
  application_manager: ['partners', 'students', 'applications', 'documents', 'catalogue', 'tasks', 'reports'],
  assessment_staff: ['partners', 'students', 'assessments', 'documents', 'catalogue', 'tasks'],
  finance_staff: ['partners', 'finance', 'reports', 'tasks'],
  support_staff: ['partners', 'students', 'updates', 'tasks'],
};

export type PartnerModule = 'students' | 'applications' | 'course_finder' | 'assessments' | 'documents' | 'finance' | 'updates';
export const PARTNER_MODULES: { id: PartnerModule; label: string }[] = [
  { id: 'students', label: 'Student Management' },
  { id: 'applications', label: 'Application Management' },
  { id: 'course_finder', label: 'Course Finder' },
  { id: 'assessments', label: 'Assessment Access' },
  { id: 'documents', label: 'Document Management' },
  { id: 'finance', label: 'Finance Access' },
  { id: 'updates', label: 'Important Updates' },
];

/** Admin route segment → module it needs (routes not listed are open to every employee). */
export const ADMIN_ROUTE_MODULE: Record<string, StaffModule | 'users'> = {
  partners: 'partners',
  students: 'students',
  applications: 'applications',
  assessments: 'assessments',
  documents: 'documents',
  finance: 'finance',
  providers: 'catalogue',
  courses: 'catalogue',
  tasks: 'tasks',
  updates: 'updates',
  reports: 'reports',
  users: 'users',
};

// ------------------------------------------------------------------ partner employees
/** What a Partner Company Employee may do (same catalogue as public.partner_permission_keys()). */
export type PartnerPermission =
  | 'students.view' | 'students.add' | 'students.edit'
  | 'applications.view' | 'applications.create' | 'applications.update'
  | 'chat' | 'documents.view' | 'documents.upload' | 'course_finder' | 'updates' | 'assessments' | 'team.manage';
export const PARTNER_PERMISSIONS: { id: PartnerPermission; label: string; module: PartnerModule | null; group: string; hint?: string }[] = [
  { id: 'students.view', label: 'View Students', module: 'students', group: 'Students' },
  { id: 'students.add', label: 'Add Students', module: 'students', group: 'Students' },
  { id: 'students.edit', label: 'Edit Students', module: 'students', group: 'Students' },
  { id: 'applications.view', label: 'View Applications', module: 'applications', group: 'Applications', hint: 'Track application progress' },
  { id: 'applications.create', label: 'Create Applications', module: 'applications', group: 'Applications' },
  { id: 'applications.update', label: 'Update Authorized Applications', module: 'applications', group: 'Applications' },
  { id: 'chat', label: 'Access Application Chat', module: 'applications', group: 'Applications' },
  { id: 'documents.view', label: 'View Documents', module: 'documents', group: 'Documents' },
  { id: 'documents.upload', label: 'Upload Documents', module: 'documents', group: 'Documents' },
  { id: 'course_finder', label: 'Access Course Finder', module: 'course_finder', group: 'Tools' },
  { id: 'updates', label: 'View Important Updates', module: 'updates', group: 'Tools' },
  { id: 'assessments', label: 'Assessments', module: 'assessments', group: 'Tools' },
  { id: 'team.manage', label: 'Manage Team (team manager)', module: null, group: 'Management', hint: 'Partner Admin only can grant this' },
];
/** Permission presets for the Add Employee form (never commission or finance). */
export const PARTNER_PRESETS: { id: string; label: string; permissions: PartnerPermission[] }[] = [
  { id: 'counsellor', label: 'Counsellor', permissions: ['students.view', 'students.add', 'students.edit', 'applications.view', 'applications.create', 'applications.update', 'chat', 'documents.view', 'documents.upload', 'course_finder', 'updates'] },
  { id: 'documentation', label: 'Documentation', permissions: ['students.view', 'applications.view', 'chat', 'documents.view', 'documents.upload', 'updates'] },
  { id: 'viewer', label: 'Read only', permissions: ['students.view', 'applications.view', 'documents.view', 'course_finder', 'updates'] },
];
/** Every permission the organisation's modules allow (what a Partner Admin holds). */
export const partnerKeysFor = (modules: string[]): PartnerPermission[] =>
  PARTNER_PERMISSIONS.filter((p) => !p.module || modules.includes(p.module)).map((p) => p.id);
/** Client route segment → permission it needs. */
export const CLIENT_ROUTE_PERMISSION: Record<string, PartnerPermission> = {
  students: 'students.view',
  applications: 'applications.view',
  messages: 'chat',
  'course-finder': 'course_finder',
  'course-search': 'course_finder',
  assessments: 'assessments',
  documents: 'documents.view',
  updates: 'updates',
  'team-management': 'team.manage',
};
/** May this partner session do this? Internal users: always (their access is RLS-checked separately). */
export const partnerCan = (session: { role: string; partnerPermissions?: string[] } | null, p: PartnerPermission) =>
  !!session && (session.role !== 'client' || (session.partnerPermissions ?? []).includes(p));

/** Client route segment → partner module (finance also needs the Partner Admin role). */
export const CLIENT_ROUTE_MODULE: Record<string, PartnerModule> = {
  students: 'students',
  applications: 'applications',
  messages: 'applications',
  'course-finder': 'course_finder',
  'course-search': 'course_finder',
  assessments: 'assessments',
  documents: 'documents',
  finance: 'finance',
  updates: 'updates',
};

export const isHR = (s: { userRole: UserRole; permissions: string[] } | null) => !!s && (s.userRole === 'super_admin' || s.permissions.includes('hr'));

/** Whether a session may open a portal page (menu + route guard; RLS enforces the data). */
export function canOpen(session: { role: 'admin' | 'staff' | 'client'; userRole: UserRole; permissions: string[]; partnerModules: string[]; previewOf?: unknown } | null, segment: string): boolean {
  if (!session) return false;
  if (session.role === 'admin' || session.role === 'staff') {
    const s = session as typeof session & { employee?: boolean; hasTeam?: boolean };
    if (segment === 'work') return !!s.employee;
    if (segment === 'team') return !!s.employee && !!s.hasTeam;
    if (segment === 'hr') return isHR(session) || session.permissions.includes('hr_accounts');
    if (segment === 'work-reports') return session.userRole === 'super_admin' || session.permissions.includes('work_reports') || session.permissions.includes('hr');
    // The Staff Portal has no partner directory or account management.
    if (session.role === 'staff' && (segment === 'partners' || segment === 'users')) return false;
    const m = ADMIN_ROUTE_MODULE[segment];
    if (!m) return true;
    if (m === 'users') return session.userRole === 'super_admin';
    // Tasks: everyone sees their own assigned tasks.
    if (m === 'tasks') return true;
    return session.permissions.includes(m);
  }
  const m = CLIENT_ROUTE_MODULE[segment];
  // Finance (and commission) is for the Partner Admin only, never for partner employees.
  if (m === 'finance') return (session.userRole === 'partner_admin' || !!session.previewOf) && session.partnerModules.includes(m);
  const perms = (session as { partnerPermissions?: string[] }).partnerPermissions;
  const need = CLIENT_ROUTE_PERMISSION[segment];
  if (need) return perms ? perms.includes(need) : !!m && session.partnerModules.includes(m);
  if (!m) return true;
  return session.partnerModules.includes(m);
}
