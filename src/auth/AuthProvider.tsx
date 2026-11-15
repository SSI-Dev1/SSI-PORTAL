import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Session } from '../data/types';
import { AuthError, arrivedWithAuthCode, isResetPasswordPath, resolveStage, signOut as authSignOut, supabase } from './auth';
import { IDLE_TIMEOUT_MINUTES } from './config';

export type AuthStatus = 'loading' | 'signed-out' | 'recovery' | 'password-change' | 'signed-in';

interface AuthValue {
  status: AuthStatus;
  /** Effective session (a staff member's partner preview overrides the real one). */
  session: Session | null;
  /** The real, server-derived session. */
  realSession: Session | null;
  /** Message to show on the login screen (suspension, idle timeout…). */
  notice: string;
  /** Re-reads the user's role from the server (e.g. after a password recovery). */
  refresh: () => Promise<void>;
  signOut: (reason?: 'logout' | 'idle_timeout') => Promise<void>;
  setPreview: (s: Session | null) => void;
  /** A password-recovery session was established from a reset link (code exchanged by Supabase). */
  recoveryVerified: boolean;
  /** The reset / sign-in link failed (expired, used, invalid). */
  linkFailed: boolean;
  /** A reset link's one-time token is being checked with Supabase. */
  verifyingLink: boolean;
  /** Seconds left before automatic sign-out (only set during the final minute). */
  idleSecondsLeft: number | null;
  stayActive: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'signed-out');
  const [realSession, setRealSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState<Session | null>(null);
  // A reset / sign-in link that failed comes back with ?error_code=… (or #error_code=…): explain it
  // on the sign-in page and remove it from the address bar.
  const [linkFailed, setLinkFailed] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, '').split('?').pop() ?? '');
    return !!(q.get('error_code') ?? h.get('error_code') ?? q.get('error') ?? h.get('error'));
  });
  // On the reset page a session only counts once Supabase confirms it came from a recovery link:
  // the PASSWORD_RECOVERY event, or a ?code= exchanged on this page (only reset emails point here).
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  // Reset emails link to /reset-password/?token_hash=…&type=recovery. The token is checked here with
  // Supabase (single use, Supabase's expiry), so the link works in any browser or device.
  const [verifyingLink, setVerifyingLink] = useState(
    () => isResetPasswordPath() && new URLSearchParams(window.location.search).get('type') === 'recovery' && !!new URLSearchParams(window.location.search).get('token_hash'),
  );
  useEffect(() => {
    if (!verifyingLink || !supabase) return;
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get('token_hash') ?? '';
    // Remove the token from the address bar and history before anything else runs.
    window.history.replaceState(null, '', window.location.pathname);
    void supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ data, error }) => {
      if (error || !data.session) setLinkFailed(true);
      else setRecoveryVerified(true);
      setVerifyingLink(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [notice, setNotice] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, '').split('?').pop() ?? '');
    const code = q.get('error_code') ?? h.get('error_code');
    const err = q.get('error') ?? h.get('error');
    if (!code && !err) return '';
    window.history.replaceState(null, '', window.location.pathname + (window.location.hash.startsWith('#/') && !window.location.hash.includes('error') ? window.location.hash : ''));
    return code === 'otp_expired'
      ? 'This password reset link has expired or was already used. Request a new one below — only the most recent email works, and each link works once.'
      : 'That sign-in link could not be used. Please request a new one.';
  });
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  const resetIdle = useRef<() => void>(() => {});
  const recovering = useRef(new URLSearchParams(window.location.search).has('recovery') || isResetPasswordPath());
  const resolvedFor = useRef<string | null>(null);

  const apply = useCallback(async (user: User | null) => {
    if (!user) {
      resolvedFor.current = null;
      setRealSession(null);
      setPreview(null);
      setStatus('signed-out');
      return;
    }
    if (recovering.current) {
      if (isResetPasswordPath() && arrivedWithAuthCode) setRecoveryVerified(true);
      setStatus('recovery');
      return;
    }
    try {
      const stage = await resolveStage(user);
      resolvedFor.current = user.id;
      setRealSession(stage.session);
      setStatus(stage.kind);
    } catch (e) {
      setNotice(e instanceof AuthError ? e.message : 'Could not verify your account.');
      await supabase?.auth.signOut({ scope: 'local' });
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering.current = true;
        setRecoveryVerified(true);
        setStatus('recovery');
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
      // Supabase recommends not awaiting other auth calls inside this callback.
      setTimeout(() => void apply(s?.user ?? null), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [apply]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    recovering.current = false;
    const { data } = await supabase.auth.getUser(); // validated by the server, not read from storage
    await apply(data.user);
  }, [apply]);

  const signOut = useCallback(async (reason: 'logout' | 'idle_timeout' = 'logout') => {
    if (reason === 'idle_timeout') setNotice('You were signed out after a period of inactivity.');
    await authSignOut('local', reason);
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);

  // Automatic sign-out after inactivity.
  useEffect(() => {
    if (status !== 'signed-in' && status !== 'password-change') return;
    let timer = 0;
    let warn = 0;
    let tick = 0;
    const WARN_MS = 60_000;
    const reset = () => {
      window.clearTimeout(timer);
      window.clearTimeout(warn);
      window.clearInterval(tick);
      setIdleSecondsLeft(null);
      const total = IDLE_TIMEOUT_MINUTES * 60_000;
      timer = window.setTimeout(() => void signOut('idle_timeout'), total);
      warn = window.setTimeout(() => {
        const end = Date.now() + WARN_MS;
        setIdleSecondsLeft(60);
        tick = window.setInterval(() => setIdleSecondsLeft(Math.max(0, Math.round((end - Date.now()) / 1000))), 1000);
      }, total - WARN_MS);
    };
    resetIdle.current = reset;
    const events = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(warn);
      window.clearInterval(tick);
      setIdleSecondsLeft(null);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [status, signOut]);

  // Re-check the account (e.g. suspension) when the tab regains focus.
  useEffect(() => {
    if (status !== 'signed-in') return;
    const h = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [status, refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session: status === 'signed-in' ? preview ?? realSession : null,
      realSession,
      notice,
      recoveryVerified,
      linkFailed,
      verifyingLink,
      refresh,
      signOut,
      setPreview,
      idleSecondsLeft,
      stayActive: () => resetIdle.current(),
    }),
    [status, preview, realSession, notice, recoveryVerified, linkFailed, verifyingLink, refresh, signOut, idleSecondsLeft],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
