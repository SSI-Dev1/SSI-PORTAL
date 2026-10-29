import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Session } from '../data/types';
import { AuthError, resolveStage, signOut as authSignOut, supabase } from './auth';
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
  /** Seconds left before automatic sign-out (only set during the final minute). */
  idleSecondsLeft: number | null;
  stayActive: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'signed-out');
  const [realSession, setRealSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState<Session | null>(null);
  const [notice, setNotice] = useState('');
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  const resetIdle = useRef<() => void>(() => {});
  const recovering = useRef(new URLSearchParams(window.location.search).has('recovery'));
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
      refresh,
      signOut,
      setPreview,
      idleSecondsLeft,
      stayActive: () => resetIdle.current(),
    }),
    [status, preview, realSession, notice, refresh, signOut, idleSecondsLeft],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
