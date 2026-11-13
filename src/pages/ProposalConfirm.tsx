// Public page behind the "I CONFIRM" button in a partnership proposal email (#/proposal/<token>).
// Shows the proposal (partner-facing commission and terms only). Nothing is accepted by opening
// it: the recipient types their name, ticks the box and presses Confirm. Then SSI GLOBAL emails
// the company's partner registration form. No login, no portal access.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileSignature, Mail, ShieldCheck, XCircle } from 'lucide-react';
import { Alert, Button, Checkbox, Field, Input, Textarea } from '../components/ui';
import { Logo } from '../components/brand';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { supabase } from '../auth/auth';
import { fmtCommission, type ValueKind } from '../lib/commissions';
/** What the public page receives per university: partner-facing values only (0037). */
type PublicUniversity = Pick<ProposalUniversity, 'university' | 'country' | 'study_level' | 'variant' | 'intake' | 'commission_kind' | 'commission_value' | 'currency' | 'conditions'>;
import type { ProposalUniversity } from '../lib/agencies';

interface View {
  state: 'open' | 'confirmed' | 'declined' | 'expired' | 'closed' | 'invalid' | 'loading' | 'error';
  reference?: string; company_name?: string; recipient_name?: string; country?: string;
  universities?: PublicUniversity[]; terms_title?: string; terms_body?: string; message?: string | null;
  expires_at?: string; confirmed_at?: string | null; registration?: 'emailed' | 'manual' | 'exists' | 'email_failed'; error?: string;
}

const isDemo = () => import.meta.env.DEV && window.location.hash.includes('/proposal/demo');
const DEMO: View = {
  state: 'open', reference: 'PP-26-DEMO01', company_name: 'Sample Agency (demo)', recipient_name: 'Sample Contact', country: 'India',
  universities: [
    { university: 'Sample University (demo)', country: 'Sampleland', study_level: 'PG', variant: null, intake: 'Sep', commission_kind: 'percent', commission_value: '10', currency: null, conditions: 'Sample condition' },
    { university: 'Example College (demo)', country: 'Sampleland', study_level: null, variant: null, intake: null, commission_kind: 'amount', commission_value: '1000', currency: 'XXX', conditions: null },
  ],
  terms_title: 'Sample terms (demo)', terms_body: 'Sample text only — real terms are published by SSI GLOBAL administrators.', message: null, expires_at: new Date(Date.now() + 864e6).toISOString(),
};

async function call(body: Record<string, unknown>): Promise<View> {
  if (isDemo()) {
    if (body.action === 'confirm') return { ...DEMO, state: 'confirmed', registration: 'emailed' };
    if (body.action === 'decline') return { ...DEMO, state: 'declined' };
    return DEMO;
  }
  if (!supabase) return { state: 'error', error: 'The service is not available.' };
  const { data, error } = await supabase.functions.invoke('agency-proposal', { body });
  if (!error) return data as View;
  const ctx = (error as { context?: unknown }).context;
  const p = ctx instanceof Response ? ((await ctx.json().catch(() => null)) as { error?: string } | null) : null;
  return { state: 'error', error: p?.error ?? 'Could not reach SSI GLOBAL. Check your connection and try again.' };
}

export default function ProposalConfirm() {
  const { token = '' } = useParams();
  const [v, setV] = useState<View>({ state: 'loading' });
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { void call({ action: 'load', token }).then(setV); }, [token]);
  const act = async (action: 'confirm' | 'decline') => {
    if (action === 'confirm' && (!agree || name.trim().length < 2)) return setErr('Type your full name and tick the box to confirm.');
    setBusy(true); setErr('');
    const r = await call(action === 'confirm' ? { action, token, name: name.trim(), agree } : { action, token, reason });
    setBusy(false);
    if (r.state === 'error') return setErr(r.error ?? 'Please try again.');
    setV((x) => ({ ...x, ...r }));
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><Logo stacked={false} /><ThemeMenu /></div></header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {v.state === 'loading' && <p className="text-sm text-ink-soft" role="status">Loading the proposal…</p>}
        {v.state === 'error' && !v.reference && <Alert tone="error">{v.error}</Alert>}
        {v.state === 'invalid' && <Notice icon={XCircle} title="This link is not valid" text="Check that you opened the full link from the email, or contact your SSI GLOBAL Partnership Officer." />}
        {v.state === 'expired' && <Notice icon={XCircle} title="This proposal has expired" text="Contact your SSI GLOBAL Partnership Officer for a new proposal." />}
        {v.state === 'closed' && <Notice icon={XCircle} title="This proposal is no longer open" text="It was replaced or withdrawn. Contact your SSI GLOBAL Partnership Officer." />}
        {v.state === 'declined' && <Notice icon={CheckCircle2} title="Thank you — you declined this proposal" text="SSI GLOBAL has been informed." />}
        {v.state === 'confirmed' && (
          <Notice icon={CheckCircle2} title={`Thank you${v.company_name ? `, ${v.company_name}` : ''} — proposal confirmed`}
            text={v.registration === 'emailed' ? 'We have emailed your partner registration form to the address this proposal was sent to. Please complete it so SSI GLOBAL can review your registration.'
              : v.registration === 'email_failed' ? 'Your confirmation is saved. We could not email the registration form right now — SSI GLOBAL will send it to you shortly.'
              : 'Your confirmation is saved. SSI GLOBAL will send your partner registration form shortly.'} />
        )}
        {v.reference && (v.state === 'open' || (v.state === 'error' && v.reference)) && v.universities && (
          <>
            <p className="text-sm font-semibold uppercase tracking-wide text-rust">Partnership proposal · {v.reference}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-heading">{v.company_name}</h1>
            <p className="mt-1 text-sm text-ink-soft">For {v.recipient_name} · {v.country}{v.expires_at ? ` · valid until ${new Date(v.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p>
            {v.message && <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-surface p-4 text-sm shadow-sm">{v.message}</p>}
            <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-line bg-canvas/70 text-[11.5px] uppercase tracking-wider text-ink-mute"><th className="px-4 py-3">Your partnership commission</th><th className="px-4 py-3 text-right">Commission</th></tr></thead>
                <tbody>
                  {v.universities.map((u, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-4 py-3"><div className="font-medium text-heading">{[u.university, u.study_level, u.variant].filter(Boolean).join(' · ')}</div>
                        <div className="text-xs text-ink-mute">{[u.country, u.intake, u.conditions].filter(Boolean).join(' · ')}</div></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-heading">{fmtCommission(u.commission_kind as ValueKind, String(u.commission_value), u.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="mt-5 rounded-2xl bg-surface p-5 shadow-sm">
              <h2 className="flex items-center gap-2 font-semibold text-heading"><FileSignature className="h-4 w-4 text-rust" />{v.terms_title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{v.terms_body}</p>
            </section>
            <section className="mt-5 rounded-2xl border border-brand-200 bg-surface p-5 dark:border-brand-500/30">
              <h2 className="flex items-center gap-2 font-semibold text-heading"><ShieldCheck className="h-4 w-4 text-rust" />Confirm this proposal</h2>
              <p className="mt-1 text-sm text-ink-soft">Confirming accepts this proposal on behalf of {v.company_name}. It is not a signed agreement and does not give portal access — next, we email your partner registration form.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Your full name" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></Field>
              </div>
              <div className="mt-3"><Checkbox checked={agree} onCheckedChange={setAgree} label={`I am authorised to act for ${v.company_name} and I accept this partnership proposal and its terms.`} /></div>
              {err && <Alert tone="error" className="mt-3">{err}</Alert>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button icon={CheckCircle2} disabled={busy || !agree || name.trim().length < 2} onClick={() => void act('confirm')}>{busy ? 'Confirming…' : 'I Confirm'}</Button>
                <Button variant="ghost" disabled={busy} onClick={() => setDeclining((d) => !d)}>Decline</Button>
              </div>
              {declining && (
                <div className="mt-4">
                  <Field label="Reason (optional)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
                  <Button className="mt-2" variant="secondary" disabled={busy} onClick={() => void act('decline')}>Decline proposal</Button>
                </div>
              )}
            </section>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-mute"><Mail className="h-3.5 w-3.5" />Questions? Reply to the proposal email to reach your SSI GLOBAL Partnership Officer.</p>
          </>
        )}
      </main>
    </div>
  );
}

function Notice({ icon: Icon, title, text }: { icon: typeof XCircle; title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-surface p-8 text-center shadow-sm">
      <Icon className="mx-auto h-10 w-10 text-rust" />
      <h1 className="mt-3 font-display text-xl font-semibold text-heading">{title}</h1>
      <p className="mx-auto mt-2 max-w-lg text-sm text-ink-soft">{text}</p>
    </div>
  );
}
