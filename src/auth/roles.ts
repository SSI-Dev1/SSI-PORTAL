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

export type StaffModule = 'partners' | 'students' | 'applications' | 'assessments' | 'documents' | 'finance' | 'catalogue' | 'tasks' | 'updates' | 'reports';
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
];

export const ROLE_DEFAULTS: Record<StaffRole, StaffModule[]> = {
  super_admin: STAFF_MODULES.map((m) => m.id),
  admin_staff: STAFF_MODULES.map((m) => m.id),
  application_manager: ['partners', 'students', 'applications', 'documents', 'catalogue', 'tasks', 'reports'],
  assessment_staff: ['partners', 'students', 'assessments', 'documents', 'catalogue', 'tasks'],
  finance_staff: ['partners', 'finance', 'reports', 'tasks'],
  support_staff: ['partners', 'students', 'updates', 'tasks'],
};

export type PartnerModule = 'students' | 'applications' | 'course_finder' | 'assessments' | 'documents' | 'finance' | 'updates';
export const PARTNER_MODULES: { id: PartnerModule; label: string }[] = [
  { id: 'students', label: 'Student Management' },
  { id: 'applications', label: 'Applications' },
  { id: 'course_finder', label: 'Course Finder' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'documents', label: 'Documents' },
  { id: 'finance', label: 'Finance' },
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

/** Client route segment → partner module (finance also needs the Partner Admin role). */
export const CLIENT_ROUTE_MODULE: Record<string, PartnerModule> = {
  students: 'students',
  applications: 'applications',
  'course-finder': 'course_finder',
  assessments: 'assessments',
  documents: 'documents',
  finance: 'finance',
  updates: 'updates',
};

/** Whether a session may open a portal page (menu + route guard; RLS enforces the data). */
export function canOpen(session: { role: 'admin' | 'client'; userRole: UserRole; permissions: string[]; partnerModules: string[]; previewOf?: unknown } | null, segment: string): boolean {
  if (!session) return false;
  if (session.role === 'admin') {
    const m = ADMIN_ROUTE_MODULE[segment];
    if (!m) return true;
    if (m === 'users') return session.userRole === 'super_admin';
    return session.permissions.includes(m);
  }
  const m = CLIENT_ROUTE_MODULE[segment];
  if (!m) return true;
  if (m === 'finance' && session.userRole !== 'partner_admin' && !session.previewOf) return false;
  return session.partnerModules.includes(m);
}
