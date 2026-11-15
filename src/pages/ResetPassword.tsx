// Dedicated password reset page (https://portal.ssiglobal.uk/reset-password/). Reset emails return
// here; Supabase exchanges the one-time code (PKCE) and only then is the form shown. The password is
// changed with Supabase Auth (updateUser), other sessions are revoked, and this session is ended so
// the user signs in again with the new password.
import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, Loader2, Lock, ShieldAlert, X } from 'lucide-react';
import { Logo } from '../components/brand';
import { Button, Field, Input } from '../components/ui';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { useAuth } from '../auth/AuthProvider';
import { AuthError, appRoot, passwordProblems, supabase, updatePassword } from '../auth/auth';
import { cn } from '../lib/utils';

const RULES = ['at least 12 characters', 'upper- and lower-case letters', 'a number', 'a symbol'];

export default function ResetPassword() {
  const auth = useAuth();
  const [done, setDone] = useState(false);
  useEffect(() => {
    document.title = 'Reset password · SSI GLOBAL';
  }, []);

  const state: 'checking' | 'form' | 'expired' | 'done' = done ? 'done'
    : auth.linkFailed ? 'expired'
    : auth.status === 'loading' || auth.verifyingLink ? 'checking'
    : auth.status === 'recovery' && auth.recoveryVerified ? 'form'
    : 'expired';

  return (
    <div className="login-page flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="absolute right-4 top-4"><ThemeMenu /></div>
      <div className="w-full max-w-[440px] animate-fade-up rounded-3xl border border-line bg-surface p-7 shadow-2xl sm:p-9">
        <div className="mb-6 flex justify-center"><Logo /></div>
        {state === 'checking' && (
          <div className="flex flex-col items-center py-8 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-rust" />
            <p className="mt-4 font-display text-lg font-semibold text-heading">Checking your reset link…</p>
            <p className="mt-1 text-sm text-ink-soft">This takes a moment.</p>
          </div>
        )}
        {state === 'form' && <NewPasswordForm onDone={() => setDone(true)} />}
        {state === 'expired' && <Expired network={auth.linkReason === 'network'} />}
        {state === 'done' && <Success />}
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-mute"><Lock className="h-3 w-3" /> Secure, encrypted password reset · © {new Date().getFullYear()} SSI GLOBAL</p>
    </div>
  );
}

function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const problems = passwordProblems(pw);
  const mismatch = confirm.length > 0 && pw !== confirm;
  const pwError = tried && !pw ? 'Enter a new password.' : tried && problems.length ? 'Please enter a stronger password.' : undefined;
  const confirmError = tried && !confirm ? 'Confirm your new password.' : (tried || confirm.length >= pw.length) && mismatch ? 'Passwords do not match.' : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTried(true);
    setError('');
    if (!pw || !confirm || problems.length || pw !== confirm) return;
    setBusy(true);
    try {
      await updatePassword(pw);
      setPw('');
      setConfirm('');
      // End this recovery session: the next sign-in uses the new password.
      await supabase?.auth.signOut({ scope: 'local' });
      onDone();
    } catch (err) {
      const msg = err instanceof AuthError ? err.message : '';
      setError(/session|expired|jwt|missing/i.test(msg) ? 'Your reset link has expired. Request a new one.'
        : msg || 'Could not update your password. Check your connection and try again — your reset link is still valid.');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-center font-display text-[26px] font-semibold tracking-tight text-heading">Create New Password</h1>
      <p className="mt-2 text-center text-[15px] text-ink-soft">Choose a new secure password for your SSI GLOBAL account.</p>
      {error && (
        <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </div>
      )}
      <div className="mt-6 space-y-4">
        <Field label="New Password" error={pwError}>
          <div className="relative">
            <Input icon={Lock} type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} invalid={!!pwError} className="h-12 pr-12" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-mute transition hover:bg-canvas hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <ul className="grid grid-cols-2 gap-1.5 text-xs" aria-label="Password requirements">
          {RULES.map((r) => {
            const ok = pw.length > 0 && !problems.includes(r);
            return <li key={r} className={cn('flex items-center gap-1.5', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-mute')}>{ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{r}</li>;
          })}
        </ul>
        <Field label="Confirm Password" error={confirmError}>
          <Input icon={Lock} type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!confirmError} className="h-12" />
        </Field>
      </div>
      <Button type="submit" size="lg" className="mt-6 w-full" loading={busy} disabled={busy}>{busy ? 'Updating…' : 'Reset Password'}</Button>
    </form>
  );
}

function Expired({ network }: { network?: boolean }) {
  if (network) {
    return (
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"><ShieldAlert className="h-7 w-7" /></span>
        <h1 className="mt-4 font-display text-[24px] font-semibold tracking-tight text-heading">Couldn’t check your reset link</h1>
        <p className="mt-2 text-[15px] text-ink-soft">We couldn’t reach SSI GLOBAL to check the link. Check your connection and request a new password reset email.</p>
        <Button size="lg" className="mt-6 w-full" onClick={() => window.location.assign(`${appRoot()}#/login?forgot=1`)}>Request New Reset Link</Button>
      </div>
    );
  }
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"><ShieldAlert className="h-7 w-7" /></span>
      <h1 className="mt-4 font-display text-[24px] font-semibold tracking-tight text-heading">Password Reset Link Expired</h1>
      <p className="mt-2 text-[15px] text-ink-soft">This password reset link is no longer valid. Please request a new password reset email.</p>
      <p className="mt-2 text-xs text-ink-mute">Each link works once and only the most recent email is valid.</p>
      <Button size="lg" className="mt-6 w-full" onClick={() => window.location.assign(`${appRoot()}#/login?forgot=1`)}>Request New Reset Link</Button>
      <button type="button" className="mt-3 text-sm font-semibold text-rust hover:underline" onClick={() => window.location.assign(`${appRoot()}#/login`)}>Back to Login</button>
    </div>
  );
}

function Success() {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><CheckCircle2 className="h-8 w-8" /></span>
      <h1 className="mt-4 font-display text-[24px] font-semibold tracking-tight text-heading">Password Updated Successfully</h1>
      <p className="mt-2 text-[15px] text-ink-soft">Your SSI GLOBAL account password has been changed successfully. You can now log in using your new password.</p>
      <Button size="lg" className="mt-6 w-full" onClick={() => window.location.assign(`${appRoot()}#/login`)}>Back to Login</Button>
    </div>
  );
}
