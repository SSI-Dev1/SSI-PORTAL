import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { Logo } from '../components/brand';
import { Button, Checkbox, Field, Input, Modal } from '../components/ui';
import { useToast } from '../components/feedback';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { LoginShowcase } from '../components/LoginShowcase';
import { useAuth } from '../auth/AuthProvider';
import { AuthError, authConfigured, googleEnabled, sendPasswordReset, signInWithGoogle, signInWithPassword } from '../auth/auth';
import { SetNewPassword } from './LoginSteps';
import { cn } from '../lib/utils';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function Login() {
  const auth = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState<'password' | 'google' | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  // Returning from Google or an email link (PKCE adds ?code=…); AuthProvider finishes sign-in.
  const oauthReturn = auth.status === 'loading' && new URLSearchParams(window.location.search).has('code');

  useEffect(() => {
    document.title = 'Sign in · SSI GLOBAL';
    return () => {
      document.title = 'SSI GLOBAL CRM';
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;
    setLoading('password');
    try {
      const stage = await signInWithPassword(email, password, remember);
      setPassword('');
      toast.success(`Welcome back, ${stage.session.name.split(' ')[0]}`);
      await auth.refresh();
      setLoading(null);
    } catch (err) {
      setFormError(err instanceof AuthError ? err.message : 'Something went wrong. Please try again.');
      setLoading(null);
    }
  };

  const google = async () => {
    setFormError('');
    setLoading('google');
    try {
      await signInWithGoogle(); // Browser navigates away to Google.
    } catch (err) {
      setFormError(err instanceof AuthError ? err.message : 'Could not start Google sign-in.');
      setLoading(null);
    }
  };

  const reset = async () => {
    if (!EMAIL_RE.test(resetEmail.trim())) return toast.error('Enter a valid email address');
    setResetSending(true);
    await sendPasswordReset(resetEmail).catch(() => {});
    setResetSending(false);
    setForgotOpen(false);
    toast.success('Check your inbox', `If an account exists for ${resetEmail.trim()}, we’ve sent password reset instructions.`);
  };

  if (auth.status === 'signed-in' && auth.session) return <Navigate to={`/${auth.session.role}/dashboard`} replace />;

  const step =
    auth.status === 'password-change' ? (
      <SetNewPassword required onDone={auth.refresh} />
    ) : auth.status === 'recovery' ? (
      <SetNewPassword onDone={auth.refresh} />
    ) : null;

  return (
    <div className="login-page flex min-h-screen items-stretch justify-center sm:p-4 lg:items-center lg:p-6">
      <div className="flex w-full max-w-[1320px] bg-surface shadow-2xl sm:rounded-[32px] lg:min-h-[min(860px,calc(100vh-48px))] lg:p-3">
      <LoginShowcase />

      {/* Sign-in */}
      <section className="relative flex flex-1 flex-col lg:pl-4">
        <div className="flex items-center justify-between px-5 pt-5 sm:px-10 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeMenu />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-10">
          <div className="w-full max-w-[400px] animate-fade-up">
            <div>
              {step ?? (oauthReturn || auth.status === 'loading' ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-rust" />
                  <p className="mt-4 font-display text-lg font-semibold text-heading">Signing you in…</p>
                  <p className="mt-1 text-sm text-ink-soft">Verifying your account with SSI GLOBAL.</p>
                </div>
              ) : (
                <>
                  <h2 className="font-display text-[30px] font-semibold tracking-tight text-heading">Welcome back</h2>
                  <p className="mt-2 text-[15px] text-ink-soft">Sign in to your SSI GLOBAL account</p>

                  {!authConfigured && (
                    <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      Sign-in is not configured for this site yet. Please contact SSI GLOBAL.
                    </div>
                  )}
                  {(formError || auth.notice) && (
                    <div role="alert" className="mt-6 flex animate-fade-in items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {formError || auth.notice}
                    </div>
                  )}

                  <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
                    <Field label="Email address" error={errors.email}>
                      <Input
                        icon={Mail}
                        type="email"
                        autoComplete="email"
                        autoFocus
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        invalid={!!errors.email}
                        className="h-12"
                      />
                    </Field>
                    <Field label="Password" error={errors.password}>
                      <div className="relative">
                        <Input
                          icon={Lock}
                          type={show ? 'text' : 'password'}
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          invalid={!!errors.password}
                          className="h-12 pr-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShow((s) => !s)}
                          aria-label={show ? 'Hide password' : 'Show password'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-mute transition hover:bg-canvas hover:text-heading"
                        >
                          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </Field>
                    <div className="flex items-center justify-between text-sm">
                      <Checkbox checked={remember} onCheckedChange={setRemember} label="Remember me" />
                      <button
                        type="button"
                        onClick={() => {
                          setResetEmail(email);
                          setForgotOpen(true);
                        }}
                        className="font-semibold text-rust hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Button type="submit" size="lg" className="w-full" loading={loading === 'password'} disabled={!!loading || !authConfigured}>
                      Sign in {loading !== 'password' && <ArrowRight className="h-4 w-4" />}
                    </Button>
                  </form>

                  {/* Shown only once Google sign-in is configured: a Google button that
                      can't sign anyone in looks like a phishing page to browsers. */}
                  {googleEnabled && (
                    <>
                    <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-ink-mute">
                      <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
                    </div>

                    <button
                      type="button"
                      onClick={google}
                      disabled={!!loading}
                      className={cn(
                        'flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface text-[15px] font-semibold text-heading shadow-sm transition',
                        'hover:border-navy-200 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-60',
                      )}
                    >
                      {loading === 'google' ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
                      Continue with Google
                    </button>
                    </>
                  )}

                  <p className="mt-8 text-center text-sm text-ink-soft">
                    Need an account?{' '}
                    <a className="font-semibold text-rust hover:underline" href="mailto:partners@ssiglobal.com">
                      Contact SSI GLOBAL
                    </a>
                  </p>
                </>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex flex-col items-center justify-between gap-2 px-5 pb-6 text-xs text-ink-mute sm:flex-row sm:px-10">
          <span>© {new Date().getFullYear()} SSI GLOBAL. All rights reserved.</span>
          <span className="flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> Secure, encrypted sign-in
          </span>
        </footer>
      </section>
      </div>

      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        size="sm"
        title="Reset your password"
        subtitle="Enter your account email and we’ll send you reset instructions."
        footer={
          <>
            <Button variant="secondary" onClick={() => setForgotOpen(false)}>
              Cancel
            </Button>
            <Button onClick={reset} loading={resetSending}>
              Send reset link
            </Button>
          </>
        }
      >
        <Field label="Email address">
          <Input icon={Mail} type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="you@company.com" autoFocus />
        </Field>
      </Modal>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
