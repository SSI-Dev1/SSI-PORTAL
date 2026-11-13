// Supabase Edge Function: partnership proposals for agency prospects (0034).
//
// Signed-in action (Partnership Officer or administrator who can see the agency):
//   send     — claims the proposal once (double clicks and retries cannot send twice), issues a
//              one-time link token (only its hash is stored), emails the proposal through Brevo and
//              records the outcome: "accepted" by the provider is not "delivered" — delivery comes
//              from the brevo-webhook function.
// Public actions (no login; the link token is the only key and opens only its own proposal):
//   load     — what the recipient sees. Opening it (or an email scanner fetching the link) never
//              accepts anything.
//   confirm  — explicit acceptance: typed full name + "I confirm". Then the company-specific
//              partner registration (the existing 0030 flow) is created and its link emailed —
//              unless an administrator has switched automatic links off, in which case they are
//              notified to issue it.
//   decline  — the recipient declines.
//
// Deploy:  supabase functions deploy agency-proposal --no-verify-jwt --project-ref <ref>
// Uses the same secrets as partner-registration: ALLOWED_ORIGINS, BREVO_API_KEY, EMAIL_FROM_ADDRESS,
// EMAIL_FROM_NAME, PORTAL_PUBLIC_URL.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { mailConfig, sendViaBrevo } from '../_shared/credentials.ts';
import { TOKEN_RE, linkEmail } from '../_shared/registration.ts';
import { proposalEmail, type ProposalArrangement } from '../_shared/proposal.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAIL = mailConfig((k) => Deno.env.get(k));

class Fail extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
const json = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) } });

function newToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const longDate = (d: string | Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const portal = () => MAIL.portalUrl.replace(/\/$/, '');

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin);
  if (ALLOWED_ORIGINS.length && (!origin || !ALLOWED_ORIGINS.includes(origin))) return json(403, { error: 'Forbidden' }, origin);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim().slice(0, 64);
  const limit = async (bucket: string, max: number, minutes: number) => {
    const { data, error } = await admin.rpc('registration_rate_hit', { p_bucket: bucket, p_limit: max, p_window_minutes: minutes });
    if (error || data !== true) throw new Fail(429, 'Too many requests. Please wait a few minutes and try again.');
  };

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');

    // ---------------------------------------------------------------- signed in: send
    if (action === 'send') {
      const auth = req.headers.get('Authorization') ?? '';
      if (!auth.startsWith('Bearer ')) throw new Fail(401, 'Sign in again.');
      const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: who } = await user.auth.getUser();
      const me = who.user?.id;
      if (!me) throw new Fail(401, 'Sign in again.');
      const id = String(body.proposalId ?? '');
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Fail(400, 'Unknown proposal.');
      const { data: ok } = await user.rpc('can_send_agency_proposal', { p_id: id });
      if (ok !== true) throw new Fail(403, 'You cannot send this proposal.');
      await limit(`proposal_send:${me}`, 30, 60);
      const token = newToken();
      const { data: claimed, error: claimErr } = await admin.rpc('begin_agency_proposal_send', { p_id: id, p_actor: me, p_token: token });
      if (claimErr) {
        const state = /STATE: (\w+)/.exec(claimErr.message)?.[1];
        if (state) return json(409, { error: state === 'sending' ? 'This proposal is already being sent.' : `This proposal is ${state.replace(/_/g, ' ')}.`, state }, origin);
        throw new Fail(500, 'The proposal could not be prepared.');
      }
      const r = claimed as { reference: string; company_name: string; recipient_name: string; recipient_email: string; country: string; arrangement: ProposalArrangement;
        terms_title: string; terms_body: string; message: string | null; expires_at: string };
      const { data: prof } = await admin.from('profiles').select('full_name').eq('id', me).maybeSingle();
      const mail = proposalEmail({ reference: r.reference, companyName: r.company_name, recipientName: r.recipient_name, country: r.country, arrangement: r.arrangement,
        termsTitle: r.terms_title, termsBody: r.terms_body, message: r.message, url: `${portal()}/#/proposal/${token}`, expires: longDate(r.expires_at),
        senderName: (prof?.full_name as string | null) ?? null });
      const sent = await sendViaBrevo(MAIL, { email: r.recipient_email, name: r.recipient_name }, mail);
      await admin.rpc('finish_agency_proposal_send', { p_id: id, p_actor: me, p_ok: sent.ok, p_message_id: sent.ok ? sent.messageId : null, p_detail: sent.ok ? null : sent.detail });
      if (!sent.ok) return json(502, { error: `Not sent: ${sent.detail}. You can try again.`, state: 'delivery_failed' }, origin);
      return json(200, { ok: true, state: 'awaiting_confirmation', email: 'accepted' }, origin);
    }

    // ---------------------------------------------------------------- public: load · confirm · decline
    if (!['load', 'confirm', 'decline'].includes(action)) throw new Fail(400, 'Unknown request.');
    const { data: badRows } = await admin.from('partner_registration_hits').select('hits').eq('bucket', `badproposal:${ip}`)
      .gte('window_start', new Date(Date.now() - 60 * 60_000).toISOString());
    if ((badRows ?? []).reduce((s, x) => s + Number(x.hits), 0) > 20) throw new Fail(429, 'Too many requests. Please wait and try again later.');
    await limit(`proposal:${ip}:${action}`, action === 'load' ? 120 : 20, 10);
    const token = String(body.token ?? '');
    const state = TOKEN_RE.test(token) ? (await admin.rpc('agency_proposal_for_token', { p_token: token })).data as Record<string, unknown> | null : null;
    if (!state || state.state === 'invalid') {
      await admin.rpc('registration_rate_hit', { p_bucket: `badproposal:${ip}`, p_limit: 1000000, p_window_minutes: 60 });
      return json(200, { state: 'invalid' }, origin);
    }
    const { proposal_id: proposalId, ...visible } = state;
    if (action === 'load') return json(200, visible, origin);

    if (action === 'decline') {
      const { error } = await admin.rpc('decline_agency_proposal', { p_token: token, p_reason: String(body.reason ?? '').slice(0, 1000) });
      if (error) throw new Fail(409, 'This proposal can no longer be declined.');
      return json(200, { ...visible, state: 'declined' }, origin);
    }

    // confirm
    if (body.agree !== true) throw new Fail(400, 'Tick the box to confirm that you accept the proposal.');
    const name = String(body.name ?? '').trim().slice(0, 120);
    if (name.length < 2) throw new Fail(400, 'Type your full name to confirm.');
    const { data: conf, error: confErr } = await admin.rpc('confirm_agency_proposal', { p_token: token, p_name: name });
    if (confErr) throw new Fail(409, /full name/.test(confErr.message) ? 'Type your full name to confirm.' : 'This proposal can no longer be confirmed.');
    let registration: 'emailed' | 'manual' | 'exists' | 'email_failed' = 'exists';
    if (!(conf as { duplicate?: boolean }).duplicate) {
      const { data: reg, error: regErr } = await admin.rpc('issue_registration_for_proposal', { p_proposal: proposalId });
      const g = reg as { state: string; registration_id?: string; token?: string; expires_at?: string; company_name?: string; email?: string } | null;
      if (regErr || !g) registration = 'manual';
      else if (g.state === 'created' && g.token && g.email) {
        const sent = await sendViaBrevo(MAIL, { email: g.email, name: g.company_name ?? '' },
          linkEmail('invite', g.company_name ?? '', `${portal()}/#/partner-registration/${g.token}`, longDate(g.expires_at ?? new Date())));
        await admin.from('partner_registration_events').insert({ registration_id: g.registration_id, actor: null,
          action: sent.ok ? 'link_emailed' : 'link_email_failed', detail: { kind: 'invite', source: 'proposal' } });
        registration = sent.ok ? 'emailed' : 'email_failed';
      } else registration = g.state === 'manual' ? 'manual' : 'exists';
    }
    return json(200, { ...visible, state: 'confirmed', registration }, origin);
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message }, origin);
    return json(500, { error: 'Something went wrong. Please try again.' }, origin);
  }
});
