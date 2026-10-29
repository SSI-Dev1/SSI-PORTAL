// Client for account administration. Everything privileged happens in the `admin-users`
// Edge Function (service role, Super Admin check) or in SECURITY DEFINER database
// functions; the browser only sends what the admin typed and never sees password hashes.
import { requireClient } from '../auth/auth';
import type { UserRole } from '../data/types';

export interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'deactivated';
  partnerId: string | null;
  partnerName: string | null;
  permissions: string[] | null;
  mustChangePassword: boolean;
  createdAt: string;
  lastSignInAt: string | null;
}

export class AdminApiError extends Error {}

export async function loadDirectory(): Promise<DirectoryUser[]> {
  const { data, error } = await requireClient().rpc('user_directory');
  if (error) throw new AdminApiError('Could not load accounts. Apply migration 0004 and sign in as a Super Admin.');
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    fullName: String(r.full_name ?? ''),
    email: String(r.email ?? ''),
    role: r.role as UserRole,
    status: r.status as DirectoryUser['status'],
    partnerId: (r.partner_id as string | null) ?? null,
    partnerName: (r.partner_name as string | null) ?? null,
    permissions: (r.permissions as string[] | null) ?? null,
    mustChangePassword: !!r.must_change_password,
    createdAt: String(r.created_at),
    lastSignInAt: (r.last_sign_in_at as string | null) ?? null,
  }));
}

async function call<T = { ok: true }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('admin-users', { body });
  if (!error) return data as T;
  let message = 'The account service is unavailable. Check that the admin-users function is deployed.';
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    const payload = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) message = payload.error;
  }
  throw new AdminApiError(message);
}

export const adminApi = {
  createEmployee: (b: { email: string; fullName: string; role: UserRole; permissions: string[] | null; password: string; mustChangePassword: boolean }) =>
    call<{ ok: true; userId: string }>({ action: 'create_employee', ...b }),
  createPartner: (b: {
    partner: Record<string, unknown>;
    account: { email: string; fullName: string; password: string; mustChangePassword: boolean };
    portalEnabled: boolean;
    modules: string[];
  }) => call<{ ok: true; partnerId: string; userId: string }>({ action: 'create_partner', ...b }),
  createPartnerUser: (b: { partnerId: string; email: string; fullName: string; role: UserRole; password: string; mustChangePassword: boolean }) =>
    call<{ ok: true; userId: string }>({ action: 'create_partner_user', ...b }),
  updateUser: (b: { userId: string; fullName?: string; role?: UserRole; permissions?: string[] | null; mustChangePassword?: boolean }) =>
    call({ action: 'update_user', ...b }),
  setStatus: (userId: string, status: DirectoryUser['status']) => call({ action: 'set_status', userId, status }),
  resetPassword: (userId: string, password: string, mustChangePassword: boolean) => call({ action: 'reset_password', userId, password, mustChangePassword }),
  deletePartner: (partnerId: string, confirmName: string) => call({ action: 'delete_partner', partnerId, confirmName }),
};

/** Partner organisation access — Super Admin only (enforced by a database trigger). */
export async function setPartnerAccess(partnerId: string, patch: { portalEnabled?: boolean; modules?: string[]; status?: string; archived?: boolean }) {
  const row: Record<string, unknown> = {};
  if (patch.portalEnabled !== undefined) row.portal_enabled = patch.portalEnabled;
  if (patch.modules) row.modules = patch.modules;
  if (patch.status) row.status = patch.status;
  if (patch.archived !== undefined) row.archived_at = patch.archived ? new Date().toISOString() : null;
  const { error } = await requireClient().from('partners').update(row).eq('id', partnerId);
  if (error) throw new AdminApiError('Partner access was not changed. Only a Super Admin can change it.');
}

const SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];

/** 16-character password from the browser CSPRNG with every character class present. */
export function generatePassword(length = 16): string {
  const all = SETS.join('');
  const pick = (chars: string) => {
    const limit = Math.floor(256 / chars.length) * chars.length;
    const b = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(b);
      if (b[0] < limit) return chars[b[0] % chars.length];
    }
  };
  const out = SETS.map(pick);
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function randomIndex(n: number) {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const b = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < limit) return b[0] % n;
  }
}
