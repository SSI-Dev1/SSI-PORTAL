// Pure validation helpers for the admin-users function (unit-tested in lib.test.ts).

export const STAFF_ROLES = ['super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff'] as const;
export const PARTNER_ROLES = ['partner_admin', 'partner_staff'] as const;
export const STAFF_MODULES = ['partners', 'students', 'applications', 'assessments', 'documents', 'finance', 'catalogue', 'tasks', 'updates', 'reports'] as const;
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
  };
}
