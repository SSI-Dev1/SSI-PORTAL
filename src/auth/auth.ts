// Auth adapter over Supabase Auth. Passwords go straight to Supabase over HTTPS and are
// stored there with bcrypt; this app never stores or logs them. The user's role and
// organisation come from the `profiles` table (RLS-protected) and are re-read from the
// server on every load — the browser never decides who someone is.
import { createClient, type SupabaseClient, type SupportedStorage, type User } from '@supabase/supabase-js';
import type { Session, UserRole } from '../data/types';
import { authConfigured, googleEnabled, siteUrl, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export class AuthError extends Error {}

// Tokens live in sessionStorage (cleared when the browser closes) unless the user ticks
// "Remember me". Supabase access tokens are short-lived and refresh tokens rotate.
const REMEMBER_KEY = 'ssi-remember';
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
};
const tokenStorage: SupportedStorage = {
  getItem: (k) => (remembered() ? localStorage : sessionStorage).getItem(k),
  setItem: (k, v) => (remembered() ? localStorage : sessionStorage).setItem(k, v),
  removeItem: (k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  },
};

export const supabase: SupabaseClient | null = authConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: tokenStorage },
    })
  : null;

export { authConfigured, googleEnabled };

export function requireClient(): SupabaseClient {
  if (!supabase) throw new AuthError('Sign-in is not configured for this site. Please contact SSI GLOBAL.');
  return supabase;
}

const GENERIC = 'Incorrect email or password.';
const STAFF: UserRole[] = ['super_admin', 'admin_staff'];
export const isStaffRole = (r: UserRole) => STAFF.includes(r);

/** Fire-and-forget security event (actor is taken from the verified JWT on the server). */
export function logEvent(event: 'login' | 'logout' | 'idle_timeout' | 'password_changed') {
  supabase?.rpc('log_event', { event }).then(
    () => {},
    () => {},
  );
}

export type AuthStage = { kind: 'signed-in'; session: Session };

/** Reads the signed-in user's role from the server and decides what they must do next. */
export async function resolveStage(user: User): Promise<AuthStage> {
  const sb = requireClient();
  const { data, error } = await sb
    .from('profiles')
    .select('role, partner_id, full_name, status, partners(name)')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new AuthError('Could not load your account. Please try again.');
  if (!data) throw new AuthError('Your account has not been set up yet. Please contact SSI GLOBAL.');
  if (data.status !== 'active') throw new AuthError('Your account has been suspended. Please contact SSI GLOBAL.');

  const userRole = data.role as UserRole;
  const name = (data.full_name as string | null) || (user.email ?? '').split('@')[0];
  const email = user.email ?? '';
  const partnerName = (data.partners as { name?: string } | null)?.name;
  const session: Session = isStaffRole(userRole)
    ? { role: 'admin', userRole, userId: user.id, name, email, title: userRole === 'super_admin' ? 'Super Admin' : 'Admin Staff' }
    : { role: 'client', userRole, userId: user.id, partnerId: data.partner_id as string, name, email, title: partnerName ?? 'Partner' };

  return { kind: 'signed-in', session };
}

export async function signInWithPassword(email: string, password: string, remember: boolean): Promise<AuthStage> {
  const sb = requireClient();
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    /* ignore */
  }
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.user) {
    if (error?.status === 429) throw new AuthError('Too many sign-in attempts. Please wait a few minutes and try again.');
    if (error?.message === 'Email not confirmed') throw new AuthError('Please confirm your email address first.');
    throw new AuthError(GENERIC);
  }
  try {
    const stage = await resolveStage(data.user);
    logEvent('login');
    return stage;
  } catch (e) {
    await sb.auth.signOut({ scope: 'local' });
    throw e;
  }
}

/** Redirects to Google (PKCE + state handled by Supabase). Only when configured. */
export async function signInWithGoogle() {
  const sb = requireClient();
  if (!googleEnabled) throw new AuthError('Google sign-in is not enabled yet. Please use your email and password.');
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: siteUrl() } });
  if (error) throw new AuthError('Could not start Google sign-in. Please try again.');
}

// ------------------------------------------------------------------ passwords

/** Mirrors the policy you should also set in Supabase → Authentication → Policies. */
export function passwordProblems(pw: string, email = ''): string[] {
  const issues: string[] = [];
  if (pw.length < 12) issues.push('at least 12 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('upper- and lower-case letters');
  if (!/\d/.test(pw)) issues.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('a symbol');
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && pw.toLowerCase().includes(local)) issues.push('not contain your email name');
  return issues;
}

export async function sendPasswordReset(email: string) {
  if (!supabase) return;
  // Supabase issues a single-use, time-limited link; the response never reveals whether the email exists.
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${siteUrl()}?recovery=1` });
}

export async function updatePassword(password: string) {
  const sb = requireClient();
  const { data: u } = await sb.auth.getUser();
  const problems = passwordProblems(password, u.user?.email ?? '');
  if (problems.length) throw new AuthError(`Password must have ${problems.join(', ')}.`);
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new AuthError(error.message.includes('different') ? 'Choose a password you have not used before.' : 'Could not update your password. Please try again.');
  logEvent('password_changed');
  // Revoke other sessions after a credential change.
  await sb.auth.signOut({ scope: 'others' });
}

// ------------------------------------------------------------------ sign-out

export async function signOut(scope: 'local' | 'global' = 'local', reason: 'logout' | 'idle_timeout' = 'logout') {
  if (!supabase) return;
  try {
    await supabase.rpc('log_event', { event: reason });
  } catch {
    /* ignore */
  }
  await supabase.auth.signOut({ scope });
}
