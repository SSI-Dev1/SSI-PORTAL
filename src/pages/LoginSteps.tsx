// Additional sign-in step: choosing a new password from a reset link. Rendered inside
// the login card.
import { useState, type FormEvent } from 'react';
import { AlertCircle, Check, Lock, ShieldCheck, X } from 'lucide-react';
import { Button, Field, Input } from '../components/ui';
import { useToast } from '../components/feedback';
import { AuthError, passwordProblems, updatePassword } from '../auth/auth';
import { cn } from '../lib/utils';

function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function StepHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-rust">
        <ShieldCheck className="h-6 w-6" />
      </span>
      <h2 className="font-display text-[24px] font-semibold tracking-tight text-heading">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{sub}</p>
    </>
  );
}

export function SetNewPassword({ onDone }: { onDone: () => Promise<void> }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const problems = passwordProblems(pw);
  const rules = ['at least 12 characters', 'upper- and lower-case letters', 'a number', 'a symbol'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (problems.length) return setError(`Password must have ${problems.join(', ')}.`);
    if (pw !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    try {
      await updatePassword(pw);
      setPw('');
      setConfirm('');
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      toast.success('Password updated', 'Other devices have been signed out.');
      await onDone();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not update your password.');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader title="Choose a new password" sub="Your reset link is valid once. Pick a strong password you don’t use anywhere else." />
      <ErrorBox message={error} />
      <div className="mt-6 space-y-4">
        <Field label="New password">
          <Input icon={Lock} type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="h-12" />
        </Field>
        <ul className="grid grid-cols-2 gap-1.5 text-xs">
          {rules.map((r) => {
            const ok = pw.length > 0 && !problems.includes(r);
            return (
              <li key={r} className={cn('flex items-center gap-1.5', ok ? 'text-emerald-600' : 'text-ink-mute')}>
                {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                {r}
              </li>
            );
          })}
        </ul>
        <Field label="Confirm new password">
          <Input icon={Lock} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12" />
        </Field>
      </div>
      <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>
        Update password
      </Button>
    </form>
  );
}
