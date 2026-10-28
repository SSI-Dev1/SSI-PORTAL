// Additional sign-in steps: authenticator (TOTP) setup and verification, and choosing
// a new password from a reset link. Rendered inside the login card.
import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, Check, KeyRound, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import { Button, Field, Input } from '../components/ui';
import { useToast } from '../components/feedback';
import { AuthError, passwordProblems, startTotpEnrollment, updatePassword, verifyTotp } from '../auth/auth';
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

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      icon={KeyRound}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      maxLength={6}
      placeholder="6-digit code"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className="h-12 tracking-[0.4em]"
      aria-label="Authentication code"
    />
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

export function MfaChallenge({ factorId, onDone, onCancel }: { factorId: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyTotp(factorId, code);
      await onDone();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Verification failed.');
      setCode('');
    }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} noValidate>
      <StepHeader title="Two-step verification" sub="Enter the 6-digit code from your authenticator app to finish signing in." />
      <ErrorBox message={error} />
      <div className="mt-6">
        <CodeInput value={code} onChange={setCode} />
      </div>
      <Button type="submit" size="lg" className="mt-5 w-full" loading={busy} disabled={code.length !== 6}>
        Verify
      </Button>
      <button type="button" onClick={onCancel} className="mt-4 w-full text-center text-sm font-semibold text-ink-soft hover:text-heading">
        Use a different account
      </button>
    </form>
  );
}

export function MfaEnroll({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const toast = useToast();
  const [factor, setFactor] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    startTotpEnrollment()
      .then(setFactor)
      .catch((e) => setError(e instanceof AuthError ? e.message : 'Could not start setup.'));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factor) return;
    setBusy(true);
    setError('');
    try {
      await verifyTotp(factor.factorId, code, true);
      toast.success('Two-step verification enabled');
      await onDone();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Verification failed.');
      setCode('');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader
        title="Set up two-step verification"
        sub="SSI GLOBAL staff accounts require an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Scan the code, then enter the 6-digit code it shows."
      />
      <ErrorBox message={error} />
      <div className="mt-6 flex justify-center">
        {factor ? (
          <img src={factor.qrCode} alt="QR code for your authenticator app" className="h-44 w-44 rounded-xl bg-white p-2 ring-1 ring-line" />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-xl bg-canvas">
            <Loader2 className="h-6 w-6 animate-spin text-rust" />
          </div>
        )}
      </div>
      {factor && (
        <button type="button" onClick={() => setShowSecret((s) => !s)} className="mx-auto mt-3 block text-xs font-semibold text-rust hover:underline">
          {showSecret ? <span className="select-all break-all font-mono text-ink-soft">{factor.secret}</span> : 'Can’t scan? Show setup key'}
        </button>
      )}
      <div className="mt-5">
        <CodeInput value={code} onChange={setCode} />
      </div>
      <Button type="submit" size="lg" className="mt-5 w-full" loading={busy} disabled={!factor || code.length !== 6}>
        Verify and continue
      </Button>
      <button type="button" onClick={onCancel} className="mt-4 w-full text-center text-sm font-semibold text-ink-soft hover:text-heading">
        Cancel and sign out
      </button>
    </form>
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
