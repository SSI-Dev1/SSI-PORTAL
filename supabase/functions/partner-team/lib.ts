// Input checks for the partner-team function. The database (partner_team_authorize) has the final
// say on what a caller may grant; this only rejects malformed input early.

/** Permissions a partner employee can hold (same list as public.partner_permission_keys()). */
export const PARTNER_PERMISSIONS = [
  'students.view', 'students.add', 'students.edit', 'applications.view', 'applications.create', 'applications.update',
  'chat', 'documents.view', 'documents.upload', 'course_finder', 'updates', 'assessments', 'team.manage',
] as const;

/** A de-duplicated, known permission list, or null when anything is wrong. */
export function cleanPartnerPermissions(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > PARTNER_PERMISSIONS.length) return null;
  const out = [...new Set(v.map((x) => String(x)))];
  if (!out.every((p) => (PARTNER_PERMISSIONS as readonly string[]).includes(p))) return null;
  return out.sort();
}
