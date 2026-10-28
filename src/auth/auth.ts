// Auth adapter. Pages call these functions and never talk to a provider directly.
//
//  - Supabase mode (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY): email/password and
//    Google OAuth via Supabase Auth. The user's role and partner come from the
//    `profiles` table, protected by row-level security (supabase/migrations).
//  - Demo mode: built-in prototype accounts (src/auth/demoAccounts.ts).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Session } from '../data/types';
import { authRedirectUrl, demoAccountsEnabled, googleEnabled, SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from './config';
import { DEMO_ACCOUNTS, sha256 } from './demoAccounts';

export class AuthError extends Error {}

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  : null;

export const authMode: 'supabase' | 'demo' = supabaseEnabled ? 'supabase' : 'demo';
export { googleEnabled };

const GENERIC = 'Incorrect email or password.';

/** Loads the signed-in Supabase user's role from `profiles`. */
async function profileSession(userId: string, email: string): Promise<Session> {
  if (!supabase) throw new AuthError('Authentication is not configured.');
  const { data, error } = await supabase.from('profiles').select('role, partner_id, full_name, partners(name)').eq('id', userId).maybeSingle();
  if (error) throw new AuthError('Could not load your account. Please try again.');
  if (!data) throw new AuthError('Your account has not been assigned a role yet. Please contact SSI GLOBAL.');
  const name = (data.full_name as string | null) || email.split('@')[0];
  const partnerName = (data.partners as { name?: string } | null)?.name;
  if (data.role === 'admin') return { role: 'admin', name, email, title: 'Super Admin', provider: 'supabase' };
  if (data.role === 'partner' && data.partner_id) {
    return { role: 'client', partnerId: data.partner_id as string, name, email, title: partnerName ?? 'Partner', provider: 'supabase' };
  }
  throw new AuthError('Your account has not been assigned a role yet. Please contact SSI GLOBAL.');
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const normalized = email.trim().toLowerCase();

  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (error || !data.user) throw new AuthError(error?.message === 'Email not confirmed' ? 'Please confirm your email address first.' : GENERIC);
    try {
      return await profileSession(data.user.id, data.user.email ?? normalized);
    } catch (e) {
      await supabase.auth.signOut();
      throw e;
    }
  }

  if (demoAccountsEnabled) {
    const account = DEMO_ACCOUNTS.find((a) => a.email === normalized);
    const hash = await sha256(`${normalized}:${password}`);
    // Small constant delay so responses don't reveal which emails exist.
    await new Promise((r) => setTimeout(r, 450));
    if (!account || account.hash !== hash) throw new AuthError(GENERIC);
    return { role: account.role, partnerId: account.partnerId, name: account.name, email: account.email, title: account.title, provider: 'demo' };
  }

  throw new AuthError('Sign-in is not configured for this environment.');
}

/** Redirects to Google. Only available when Supabase and its Google provider are configured. */
export async function signInWithGoogle() {
  if (!supabase || !googleEnabled) throw new AuthError('Google sign-in is not enabled yet. Please use your email and password.');
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authRedirectUrl() } });
  if (error) throw new AuthError('Could not start Google sign-in. Please try again.');
}

export async function sendPasswordReset(email: string) {
  if (!supabase) return; // Demo mode: nothing to send.
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: authRedirectUrl() });
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

/**
 * Keeps the app session in step with Supabase (OAuth redirects, token expiry,
 * sign-out in another tab). Returns an unsubscribe function.
 */
export function watchAuth(onSignedIn: (s: Session) => void, onSignedOut: () => void, onError: (msg: string) => void) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') return onSignedOut();
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
      // Defer: Supabase recommends not awaiting other calls inside this callback.
      setTimeout(() => {
        profileSession(session.user.id, session.user.email ?? '')
          .then(onSignedIn)
          .catch(async (e: Error) => {
            await supabase!.auth.signOut();
            onError(e.message);
          });
      }, 0);
    }
    if (event === 'INITIAL_SESSION' && !session) onSignedOut();
  });
  return () => data.subscription.unsubscribe();
}
