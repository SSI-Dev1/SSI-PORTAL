// Partner Portal team management. Reads come from public.partner_team() (RLS + permission check
// in the database); writes go through the partner-team Edge Function, which derives the
// organisation from the signed-in user and asks the database to authorise every action.
// Passwords are sent once to the function and never stored or shown again.
import { requireClient } from '../auth/auth';
import type { Delivery } from './credentialDeliveries';
import type { PartnerPermission } from '../auth/roles';

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  designation: string | null;
  department: string | null;
  role: 'partner_admin' | 'partner_staff';
  status: 'active' | 'suspended' | 'deactivated';
  /** As assigned (null = access from before team management: every enabled module). */
  partnerPermissions: PartnerPermission[] | null;
  effectivePermissions: PartnerPermission[];
  lastSignInAt: string | null;
  createdAt: string;
  createdByName: string | null;
  /** May the signed-in user manage this account? */
  manageable: boolean;
}

export class TeamApiError extends Error {}

export async function loadTeam(): Promise<TeamMember[]> {
  const { data, error } = await requireClient().rpc('partner_team');
  if (error) throw new TeamApiError('Could not load your team. Apply migration 0022 and try again.');
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    fullName: String(r.full_name ?? ''),
    email: String(r.email ?? ''),
    phone: (r.phone as string | null) ?? null,
    designation: (r.designation as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    role: r.role as TeamMember['role'],
    status: r.status as TeamMember['status'],
    partnerPermissions: (r.partner_permissions as PartnerPermission[] | null) ?? null,
    effectivePermissions: (r.effective_permissions as PartnerPermission[] | null) ?? [],
    lastSignInAt: (r.last_sign_in_at as string | null) ?? null,
    createdAt: String(r.created_at),
    createdByName: (r.created_by_name as string | null) ?? null,
    manageable: r.manageable === true,
  }));
}

export async function loadGrantable(): Promise<PartnerPermission[]> {
  const { data, error } = await requireClient().rpc('partner_team_grantable');
  if (error) return [];
  return (data ?? []) as PartnerPermission[];
}

async function call(body: Record<string, unknown>): Promise<{ ok: true; userId?: string; delivery?: Delivery | null }> {
  const { data, error } = await requireClient().functions.invoke('partner-team', { body });
  if (!error) return data as { ok: true; userId?: string; delivery?: Delivery | null };
  let message = 'The team service is unavailable. Check that the partner-team function is deployed.';
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    const payload = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) message = payload.error;
  }
  throw new TeamApiError(message);
}

export interface MemberInput {
  fullName: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  status: 'active' | 'suspended';
  permissions: PartnerPermission[];
  password: string;
  mustChangePassword: boolean;
  /** Email the login details (temporary password) from the server. */
  sendCredentials?: boolean;
}

export const teamApi = {
  create: (m: MemberInput) =>
    call({
      action: 'create_member', fullName: m.fullName, email: m.email, phone: m.phone || null, designation: m.designation || null,
      department: m.department || null, status: m.status, permissions: m.permissions, password: m.password, mustChangePassword: m.mustChangePassword,
      sendCredentials: m.sendCredentials === true,
    }),
  update: (userId: string, patch: { fullName?: string; phone?: string | null; designation?: string | null; department?: string | null; permissions?: PartnerPermission[] }) =>
    call({ action: 'update_member', userId, ...patch }),
  setStatus: (userId: string, status: 'active' | 'suspended' | 'deactivated') => call({ action: 'set_member_status', userId, status }),
  resetPassword: (userId: string, password: string, mustChangePassword: boolean) => call({ action: 'reset_member_password', userId, password, mustChangePassword }),
  /** New temporary password emailed by the server; the old password stops working. */
  resendLoginAccess: (userId: string) => call({ action: 'resend_member_access', userId }),
};
