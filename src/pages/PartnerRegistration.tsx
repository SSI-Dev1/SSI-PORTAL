// Public Partner Registration Form (#/partner-registration/<token>). No login: the link opens only
// its own registration through the partner-registration Edge Function, which checks the link,
// rate-limits, saves drafts on the server (nothing is kept in the browser) and validates again on
// submit. Submitting never creates an account or gives portal access.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, FileCheck2, FileText, Lock, Mail, PenLine, ShieldCheck, Upload, UserRound, XCircle } from 'lucide-react';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from '../components/ui';
import { Logo } from '../components/brand';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { supabase } from '../auth/auth';
import { FORM_SECTIONS, fieldByKey, fieldProblem, type Answers, type FormField } from '../../supabase/functions/_shared/partnerRegistrationForm';
import { cn } from '../lib/utils';

type FileInfo = { id: string; name: string; size: number; mime: string };
interface OpenState {
  state: 'open'; reference: string; companyName: string; country: string | null; intendedEmail: string | null; status: string;
  answers: Answers; files: Record<string, FileInfo>; verifiedEmail: string | null; expiresAt: string;
  changeRequest: { reason: string; fields: string[]; instructions: string | null } | null; emailVerification: boolean;
}
type LoadState = { state: 'loading' } | { state: 'invalid' | 'revoked' | 'expired' | 'closed' | 'error' } | { state: 'submitted'; companyName: string | null; reference: string | null } | OpenState;

const ICONS = { company: Building2, contact: UserRound, business: FileText, documents: FileCheck2, login: Lock, declaration: PenLine };
const STEPS = [...FORM_SECTIONS.map((s) => ({ id: s.id, title: s.title })), { id: 'review', title: 'Review details' }];

// Development only (#/partner-registration/demo): a fake server for layout checks. Never in production builds.
const isDemo = () => import.meta.env.DEV && window.location.hash.includes('/partner-registration/demo');
function demoCall(body: Record<string, unknown>): unknown {
  if (body.action === 'load') return { state: 'open', reference: 'PR-26-DEMO01', companyName: 'Sample Agency (demo)', country: 'India', intendedEmail: null, status: 'link_generated',
    answers: {}, files: {}, verifiedEmail: null, expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(), changeRequest: null, emailVerification: true };
  if (body.action === 'verify_code') return { ok: true, verifiedEmail: String(body.email) };
  if (body.action === 'submit') return { ok: true, reference: 'PR-26-DEMO01' };
  return { ok: true };
}

async function call<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; problems?: Record<string, string> }> {
  if (isDemo()) return { ok: true, data: demoCall(body) as T };
  if (!supabase) return { ok: false, status: 0, error: 'The registration service is not available.' };
  const { data, error } = await supabase.functions.invoke('partner-registration', { body });
  if (!error) return { ok: true, data: data as T };
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    const p = (await ctx.json().catch(() => null)) as { error?: string; problems?: Record<string, string> } | null;
    return { ok: false, status: ctx.status, error: p?.error ?? 'Please try again.', problems: p?.problems };
  }
  return { ok: false, status: 0, error: 'Could not reach SSI GLOBAL. Check your connection and try again.' };
}

export default function PartnerRegistration() {
  const { token = '' } = useParams();
  const [load, setLoad] = useState<LoadState>({ state: 'loading' });
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, FileInfo>>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const [verified, setVerified] = useState<string | null>(null);
  const idem = useRef(crypto.randomUUID());
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void call<LoadState>({ action: 'load', token }).then((r) => {
      if (!alive) return;
      if (!r.ok) return setLoad({ state: r.status === 429 ? 'error' : 'error' });
      const s = r.data;
      setLoad(s);
      if (s.state === 'open') {
        setAnswers({ ...s.answers, company_name: s.companyName, country: s.answers.country ?? s.country ?? null, registered_email: s.answers.registered_email ?? s.intendedEmail ?? null });
        setFiles(s.files ?? {});
        setVerified(s.verifiedEmail);
      }
    });
    return () => { alive = false; };
  }, [token]);

  // Unsaved answers: warn before leaving the page; save to the server when moving between steps.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty && !done) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, done]);
  const save = useCallback(async () => {
    if (!dirty) return true;
    setSaved('saving');
    const r = await call({ action: 'save', token, answers });
    setSaved(r.ok ? 'saved' : 'error');
    if (r.ok) setDirty(false);
    return r.ok;
  }, [dirty, token, answers]);
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => void save(), 15000);
    return () => window.clearTimeout(t);
  }, [dirty, save]);

  const open = load.state === 'open' ? load : null;
  const changeFields = useMemo(() => new Set(open?.changeRequest?.fields ?? []), [open]);
  const set = (key: string, v: string | boolean) => {
    setAnswers((a) => ({ ...a, [key]: v }));
    setDirty(true);
    setSaved('idle');
    if (touched[key]) setErrors((e) => ({ ...e, [key]: fieldProblem(fieldByKey.get(key)!, { ...answers, [key]: v }) }));
  };
  const stepFields = (i: number) => (FORM_SECTIONS[i]?.fields ?? []);
  const problemsFor = (i: number) => {
    const out: Record<string, string> = {};
    for (const f of stepFields(i)) {
      const p = fieldProblem(f, answers);
      if (p) out[f.key] = p;
    }
    if (FORM_SECTIONS[i]?.id === 'login' && open?.emailVerification && verified !== String(answers.registered_email ?? '').trim().toLowerCase()) {
      out.registered_email = out.registered_email || 'Confirm this email address with the code';
    }
    return out;
  };
  const go = async (to: number) => {
    if (to > step && step < FORM_SECTIONS.length) {
      const p = problemsFor(step);
      setTouched((t) => ({ ...t, ...Object.fromEntries(stepFields(step).map((f) => [f.key, true])) }));
      setErrors(p);
      if (Object.keys(p).length) return;
    }
    void save();
    setStep(to);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const submit = async () => {
    const all: Record<string, string> = {};
    FORM_SECTIONS.forEach((_, i) => Object.assign(all, problemsFor(i)));
    if (Object.keys(all).length) {
      setErrors(all);
      const first = FORM_SECTIONS.findIndex((s) => s.fields.some((f) => all[f.key]));
      setStep(first >= 0 ? first : 0);
      setSubmitError('Some answers need attention.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const r = await call<{ reference: string }>({ action: 'submit', token, answers, idempotencyKey: idem.current, website_url: honeypot });
    setSubmitting(false);
    if (r.ok) { setDirty(false); setDone(r.data.reference); return; }
    if (r.problems) {
      setErrors(r.problems);
      const first = FORM_SECTIONS.findIndex((s) => s.fields.some((f) => r.problems![f.key]));
      if (first >= 0) setStep(first);
    }
    setSubmitError(r.error);
  };

  // ---------------------------------------------------------------- screens
  const shell = (children: React.ReactNode, wide = false) => (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className={cn('mx-auto flex items-center justify-between gap-3 px-4 py-4 sm:px-6', wide ? 'max-w-6xl' : 'max-w-3xl')}><Logo stacked={false} /><ThemeMenu /></div>
      </header>
      <main className={cn('mx-auto px-4 py-6 sm:px-6 sm:py-10', wide ? 'max-w-6xl' : 'max-w-3xl')}>{children}</main>
      <footer className="pb-10 text-center text-xs text-ink-mute">© SSI GLOBAL · This form is private to the company it was sent to.</footer>
    </div>
  );
  if (load.state === 'loading') return shell(<div className="py-24 text-center text-sm text-ink-soft" role="status">Opening your registration form…</div>);
  if (done || load.state === 'submitted') {
    return shell(
      <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-10">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
        <h1 className="mt-4 font-display text-2xl font-semibold text-heading">Registration Submitted Successfully</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-soft">Thank you for your interest in partnering with SSI GLOBAL. Your registration has been received and is awaiting review by our team.</p>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-soft">Submitting this form does not automatically activate a Partner account. We will contact you regarding the next steps.</p>
        {(done || (load.state === 'submitted' && load.reference)) && <p className="mt-5 text-xs text-ink-mute">Registration reference: <b className="text-heading">{done ?? (load.state === 'submitted' ? load.reference : '')}</b></p>}
      </div>,
    );
  }
  if (!open) {
    const msg = {
      invalid: ['This link is not valid', 'Check that you opened the full link SSI GLOBAL sent you, or ask SSI GLOBAL for a new one.'],
      revoked: ['This link has been withdrawn', 'Ask your SSI GLOBAL contact for a new registration link.'],
      expired: ['This link has expired', 'Ask your SSI GLOBAL contact for a new registration link.'],
      closed: ['This registration is closed', 'Please contact SSI GLOBAL if you have any questions.'],
      error: ['We could not open the form', 'Please try again in a few minutes.'],
    }[load.state as 'invalid' | 'revoked' | 'expired' | 'closed' | 'error'];
    return shell(
      <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <XCircle className="mx-auto h-12 w-12 text-red-500" aria-hidden />
        <h1 className="mt-4 font-display text-xl font-semibold text-heading">{msg[0]}</h1>
        <p className="mt-2 text-sm text-ink-soft">{msg[1]}</p>
      </div>,
    );
  }

  const section = FORM_SECTIONS[step];
  const isReview = step === FORM_SECTIONS.length;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);
  const savedText = saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Draft saved' : saved === 'error' ? 'Not saved — check your connection' : '';
  return shell(
    <>
      <div ref={top} className="mb-6 lg:mb-8">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-heading sm:text-3xl">Partner Registration Form</h1>
        <p className="mt-1 text-sm text-ink-soft">Register your organization to explore partnership opportunities with SSI GLOBAL.</p>
      </div>
      <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* left panel (desktop): who this is for, progress and steps */}
        <aside className="mb-5 space-y-4 lg:sticky lg:top-6 lg:mb-0">
          <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 text-sm dark:border-brand-500/30 dark:bg-brand-500/10">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Registration for</div>
            <div className="mt-0.5 font-display text-lg font-semibold text-heading">{open.companyName}</div>
            <div className="mt-1 text-xs text-ink-mute">Ref. {open.reference} · link valid until {new Date(open.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-ink-soft">
              <span>Step {step + 1} of {STEPS.length}</span><span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Form progress">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-rust transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <ol className="mt-3 flex flex-wrap gap-1.5 lg:mt-4 lg:flex-col lg:gap-1">
              {STEPS.map((st, i) => {
                const I = ICONS[st.id as keyof typeof ICONS] ?? CheckCircle2;
                return (
                  <li key={st.id}>
                    <button type="button" onClick={() => (i <= step ? void go(i) : undefined)} disabled={i > step} aria-current={i === step ? 'step' : undefined}
                      className={cn('flex w-full items-center gap-2 rounded-full border px-2.5 py-1 text-left text-[11px] font-semibold transition lg:rounded-xl lg:border-transparent lg:px-3 lg:py-2 lg:text-sm',
                        i === step ? 'border-rust bg-rust text-white lg:bg-rust' : i < step ? 'border-brand-300 text-heading hover:bg-brand-50 dark:hover:bg-brand-500/10' : 'border-line text-ink-mute')}>
                      <span className={cn('hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg lg:flex', i === step ? 'bg-white/20' : i < step ? 'bg-emerald-500/15 text-emerald-600' : 'bg-canvas')}>
                        {i < step ? <Check className="h-3.5 w-3.5" /> : <I className="h-3.5 w-3.5" />}
                      </span>
                      {i < step && <Check className="h-3 w-3 lg:hidden" />}
                      <span className="truncate">{st.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {savedText && <p className="mt-3 text-xs text-ink-mute" aria-live="polite">{savedText}</p>}
          </div>
          <p className="hidden items-start gap-1.5 text-xs text-ink-mute lg:flex"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />Your answers are saved securely with SSI GLOBAL as you go. Submitting this form does not create a partnership agreement or give portal access.</p>
        </aside>

        <div className="min-w-0">
          {open.changeRequest && (
            <Alert tone="warning" className="mb-5" title="SSI GLOBAL has asked for some changes">
              <p>{open.changeRequest.reason}</p>
              {open.changeRequest.fields.length > 0 && <p className="mt-1">Please check: {open.changeRequest.fields.map((k) => fieldByKey.get(k)?.label ?? k).join(', ')}</p>}
              {open.changeRequest.instructions && <p className="mt-1">{open.changeRequest.instructions}</p>}
            </Alert>
          )}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
            {!isReview ? (
              <>
                <div className="mb-5 flex items-start gap-3">
                  {(() => { const I = ICONS[section.id as keyof typeof ICONS] ?? FileText; return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-rust dark:bg-brand-500/10"><I className="h-5 w-5" /></span>; })()}
                  <div>
                    <h2 className="font-display text-lg font-semibold text-heading">Section {step + 1} – {section.title}</h2>
                    {section.description && <p className="mt-0.5 text-sm text-ink-soft">{section.description}</p>}
                  </div>
                </div>
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {section.fields.filter((f) => !f.showWhen || answers[f.showWhen.key] === f.showWhen.equals).map((f) => (
                    <FieldInput key={f.key} f={f} value={answers[f.key]} error={errors[f.key]} flagged={changeFields.has(f.key)}
                      onChange={(v) => set(f.key, v)} onBlur={() => { setTouched((t) => ({ ...t, [f.key]: true })); setErrors((e) => ({ ...e, [f.key]: fieldProblem(f, answers) })); }}
                      file={files[f.key]} token={token} onFile={(info) => setFiles((x) => ({ ...x, [f.key]: info }))}
                      emailVerification={open.emailVerification} verified={verified} onVerified={(e) => { setVerified(e); setErrors((x) => ({ ...x, registered_email: '' })); }} />
                  ))}
                </div>
                {/* invisible to people; bots that fill every field are refused */}
                <input type="text" name="website_url" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden />
              </>
            ) : (
              <Review answers={answers} files={files} verified={verified} onEdit={(i) => void go(i)} />
            )}
            {submitError && <Alert tone="error" className="mt-5">{submitError}</Alert>}
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="secondary" icon={ArrowLeft} disabled={step === 0} onClick={() => void go(step - 1)}>Previous</Button>
              {!isReview ? (
                <Button icon={ArrowRight} onClick={() => void go(step + 1)}>{step === FORM_SECTIONS.length - 1 ? 'Review Details' : 'Next'}</Button>
              ) : (
                <Button icon={ShieldCheck} disabled={submitting} onClick={() => void submit()}>{submitting ? 'Submitting…' : 'Submit Registration'}</Button>
              )}
            </div>
          </div>
          <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-mute lg:hidden"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />Your answers are saved securely with SSI GLOBAL as you go. Submitting this form does not create a partnership agreement or give portal access.</p>
        </div>
      </div>
    </>,
    true,
  );
}

function FieldInput({ f, value, error, flagged, onChange, onBlur, file, token, onFile, emailVerification, verified, onVerified }: {
  f: FormField; value: Answers[string] | undefined; error?: string; flagged: boolean; onChange: (v: string | boolean) => void; onBlur: () => void;
  file?: FileInfo; token: string; onFile: (f: FileInfo) => void; emailVerification: boolean; verified: string | null; onVerified: (email: string) => void;
}) {
  const s = typeof value === 'string' ? value : '';
  // Long answers and checkboxes take a full row; short fields share rows (2 columns, 3 on wide screens).
  const wide = f.type === 'textarea' || f.type === 'checkbox' || f.key === 'registered_email';
  const label = <>{f.label}{flagged && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">Please check</span>}</>;
  if (f.type === 'checkbox') {
    return (
      <div className={cn('sm:col-span-full', error && 'rounded-lg ring-1 ring-red-400')}>
        <Checkbox checked={value === true} onCheckedChange={(v) => { onChange(v); }} label={f.label + (f.required ? ' *' : '')} />
        {error && <p className="mt-1 pl-7 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  if (f.type === 'file') return <div><FileField f={f} file={file} token={token} onFile={onFile} flagged={flagged} /></div>;
  if (f.key === 'registered_email') {
    return <div className="sm:col-span-full"><EmailVerify f={f} value={s} error={error} onChange={onChange} onBlur={onBlur} token={token} enabled={emailVerification} verified={verified} onVerified={onVerified} /></div>;
  }
  return (
    <Field label={label as unknown as string} required={f.required} error={error || undefined} hint={f.locked ? 'Set by SSI GLOBAL for this link. Use the correction field below if it is wrong.' : f.hint} className={wide ? 'sm:col-span-full' : undefined}>
      {f.type === 'textarea' ? <Textarea rows={3} value={s} maxLength={f.max} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} invalid={!!error} />
        : f.type === 'select' ? (
          <Select value={s} onChange={(e) => { onChange(e.target.value); }}>
            <option value="">Choose…</option>
            {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Input value={s} readOnly={f.locked} disabled={f.locked} maxLength={f.max ?? (f.type === 'tel' ? 20 : 200)} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} invalid={!!error}
            type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : 'text'}
            inputMode={f.type === 'year' || f.type === 'count' ? 'numeric' : f.type === 'tel' ? 'tel' : undefined}
            autoComplete={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : undefined}
            placeholder={f.type === 'tel' ? '+91 98765 43210' : f.type === 'year' ? 'e.g. 2015' : f.type === 'url' ? 'www.example.com' : undefined} />
        )}
    </Field>
  );
}

function FileField({ f, file, token, onFile, flagged }: { f: FormField; file?: FileInfo; token: string; onFile: (f: FileInfo) => void; flagged: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = (f.accept ?? ['pdf', 'image']).flatMap((a) => (a === 'pdf' ? ['.pdf', 'application/pdf'] : ['.jpg', '.jpeg', '.png', 'image/jpeg', 'image/png'])).join(',');
  const upload = async (picked: File) => {
    setErr(null);
    if (picked.size > (f.accept?.length === 1 && f.accept[0] === 'image' ? 5 : 10) * 1024 * 1024) return setErr(`The file is too large (max ${f.accept?.length === 1 && f.accept[0] === 'image' ? 5 : 10} MB).`);
    if (!supabase) return;
    setBusy(true);
    const u = await call<{ path: string; uploadToken: string }>({ action: 'upload_url', token, field: f.key, size: picked.size });
    if (!u.ok) { setBusy(false); return setErr(u.error); }
    const up = await supabase.storage.from('partner-registration-files').uploadToSignedUrl(u.data.path, u.data.uploadToken, picked, { contentType: picked.type || 'application/octet-stream' });
    if (up.error) { setBusy(false); return setErr('The upload failed. Please try again.'); }
    const a = await call<{ file: FileInfo }>({ action: 'attach_file', token, field: f.key, path: u.data.path, name: picked.name });
    setBusy(false);
    if (!a.ok) return setErr(a.error);
    onFile(a.data.file);
  };
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-heading">{f.label}{flagged && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Please check</span>}</div>
      <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border border-dashed bg-canvas px-4 py-3 text-sm transition focus-within:ring-2 focus-within:ring-brand-300', file ? 'border-emerald-400' : 'border-line hover:border-brand-300')}>
        {file ? <FileCheck2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <Upload className="h-5 w-5 shrink-0 text-rust" />}
        <span className="min-w-0 flex-1 truncate text-ink-soft">{busy ? 'Uploading…' : file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB — choose another to replace` : f.hint ?? (f.accept?.length === 1 && f.accept[0] === 'pdf' ? 'Choose a PDF…' : 'Choose a PDF, JPG or PNG…')}</span>
        <input type="file" accept={accept} className="sr-only" disabled={busy} onChange={(e) => { const p = e.target.files?.[0]; if (p) void upload(p); e.target.value = ''; }} />
      </label>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

function EmailVerify({ f, value, error, onChange, onBlur, token, enabled, verified, onVerified }: {
  f: FormField; value: string; error?: string; onChange: (v: string) => void; onBlur: () => void; token: string; enabled: boolean; verified: string | null; onVerified: (e: string) => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const email = value.trim().toLowerCase();
  const isVerified = !!verified && verified === email;
  const send = async () => {
    setBusy(true); setMsg(null);
    const r = await call({ action: 'send_code', token, email });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: 'error', text: r.error });
    setSent(true); setCode('');
    setMsg({ tone: 'info', text: `We sent a 6-digit code to ${email}. It expires in 10 minutes.` });
  };
  const verify = async () => {
    setBusy(true); setMsg(null);
    const r = await call<{ verifiedEmail: string }>({ action: 'verify_code', token, email, code });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: 'error', text: r.error });
    onVerified(r.data.verifiedEmail);
    setSent(false);
  };
  return (
    <div className="space-y-3">
      <Field label={f.label} required error={error || undefined} hint={enabled ? f.hint : 'Your Partner Admin will sign in with this address after approval.'}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="email" autoComplete="email" value={value} icon={Mail} maxLength={200} onChange={(e) => { onChange(e.target.value); setSent(false); }} onBlur={onBlur} invalid={!!error} className="flex-1" />
          {enabled && (isVerified
            ? <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Verified</span>
            : <Button variant="secondary" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)} onClick={() => void send()}>{sent ? 'Send again' : 'Send code'}</Button>)}
        </div>
      </Field>
      {enabled && sent && !isVerified && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Email OTP Verification" required className="sm:w-56"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" /></Field>
          <Button disabled={busy || code.length !== 6} onClick={() => void verify()}>Verify</Button>
        </div>
      )}
      {msg && <p className={cn('text-xs', msg.tone === 'error' ? 'text-red-600' : 'text-ink-soft')}>{msg.text}</p>}
      {!enabled && <p className="flex items-start gap-1.5 text-xs text-ink-mute"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Email confirmation is not available right now; SSI GLOBAL will confirm this address with you.</p>}
    </div>
  );
}

function Review({ answers, files, verified, onEdit }: { answers: Answers; files: Record<string, FileInfo>; verified: string | null; onEdit: (step: number) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-heading">Review your details</h2>
        <p className="text-sm text-ink-soft">Check everything before you submit. You can go back to any section.</p>
      </div>
      {FORM_SECTIONS.map((s, i) => (
        <section key={s.id} className="rounded-xl border border-line p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-heading">Section {i + 1} – {s.title}</h3>
            <button type="button" className="text-xs font-semibold text-rust hover:underline" onClick={() => onEdit(i)}>Edit</button>
          </div>
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {s.fields.filter((f) => !f.showWhen || answers[f.showWhen.key] === f.showWhen.equals).map((f) => {
              const v = f.type === 'file' ? files[f.key]?.name : f.type === 'checkbox' ? (answers[f.key] === true ? 'Agreed' : 'Not agreed') : answers[f.key];
              return (
                <div key={f.key} className={cn((f.type === 'textarea' || f.type === 'checkbox') && 'sm:col-span-2')}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{f.type === 'checkbox' ? 'Declaration' : f.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-heading">{f.type === 'checkbox' ? `${f.label} — ${v}` : (v as string) || '—'}{f.key === 'registered_email' && verified && verified === String(v ?? '').toLowerCase() && <span className="ml-1.5 text-xs font-semibold text-emerald-600">✓ verified</span>}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
      <p className="text-xs text-ink-mute">Date of acceptance: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} (recorded when you submit).</p>
    </div>
  );
}
