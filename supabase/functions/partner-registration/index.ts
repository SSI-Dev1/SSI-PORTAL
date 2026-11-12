// Supabase Edge Function: the public Partner Registration Form (and emailing its link).
//
// Public actions (no login; the link token is the only key and opens only its own registration):
//   load · save · upload_url · attach_file · send_code · verify_code · submit
// Admin action (needs a signed-in registration manager): email_link
//
// The token arrives in the request body (never in a URL this function sees) and is never logged.
// Only its SHA-256 hash is stored. Every public request is rate-limited per IP address and per
// link; repeated unknown links lock the address out for an hour. Files go to private storage
// through one-time signed upload URLs and are checked by content before they are accepted.
//
// Deploy:  supabase functions deploy partner-registration --no-verify-jwt --project-ref <ref>
// Uses the same secrets as admin-users: ALLOWED_ORIGINS, BREVO_API_KEY, EMAIL_FROM_ADDRESS,
// EMAIL_FROM_NAME, PORTAL_PUBLIC_URL.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { mailConfig, sendViaBrevo } from '../_shared/credentials.ts';
import { FILE_FIELDS, FORM_VERSION, fieldByKey, formProblems, sanitizeAnswers, type Answers } from '../_shared/partnerRegistrationForm.ts';
import { TOKEN_RE, codeEmail, linkEmail, safeFileName, sha256Hex, sixDigitCode, sniffFile } from '../_shared/registration.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAIL = mailConfig((k) => Deno.env.get(k));
const BUCKET = 'partner-registration-files';
const MAX_FILE = 10 * 1024 * 1024;

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

    // ---------------------------------------------------------------- admin: email the link
    if (action === 'email_link') {
      const auth = req.headers.get('Authorization') ?? '';
      if (!auth.startsWith('Bearer ')) throw new Fail(401, 'Sign in again.');
      const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: ok } = await user.rpc('can_manage_registrations');
      if (ok !== true) throw new Fail(403, 'Only authorised administrators can email registration links.');
      const token = String(body.token ?? '');
      const id = String(body.registrationId ?? '');
      if (!TOKEN_RE.test(token)) throw new Fail(400, 'Invalid link.');
      const { data: r } = await admin.from('partner_registrations').select('id, company_name, intended_email, answers, token_hash, link_expires_at, change_request, status').eq('id', id).maybeSingle();
      if (!r || r.token_hash !== (await sha256Hex(token))) throw new Fail(400, 'This link is no longer the current one. Generate a new link.');
      const to = String(body.email ?? '') || r.intended_email || (r.answers as Answers)?.registered_email || (r.answers as Answers)?.contact_email;
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) throw new Fail(400, 'No email address for this company. Copy the link instead.');
      await limit(`email_link:${id}`, 10, 60);
      const kind = body.kind === 'changes' ? 'changes' : 'invite';
      const cr = r.change_request as { reason?: string; instructions?: string | null; fields?: string[] } | null;
      const fields = (cr?.fields ?? []).map((k) => fieldByKey.get(k)?.label ?? k);
      const url = `${MAIL.portalUrl.replace(/\/$/, '')}/#/partner-registration/${token}`;
      const expires = new Date(r.link_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const sent = await sendViaBrevo(MAIL, { email: String(to), name: r.company_name }, linkEmail(kind, r.company_name, url, expires, kind === 'changes' ? { ...cr, fields } : undefined));
      if (!sent.ok) throw new Fail(502, sent.detail);
      const { data: me } = await user.auth.getUser();
      await admin.from('partner_registration_events').insert({ registration_id: id, actor: me.user?.id ?? null, action: 'link_emailed', detail: { kind } });
      return json(200, { ok: true }, origin);
    }

    // ---------------------------------------------------------------- public actions
    if (!['load', 'save', 'upload_url', 'attach_file', 'send_code', 'verify_code', 'submit'].includes(action)) throw new Fail(400, 'Unknown request.');
    // An address that tried more than 20 unknown links in the last hour is refused (guessing).
    const { data: badRows } = await admin.from('partner_registration_hits').select('hits').eq('bucket', `badlink:${ip}`)
      .gte('window_start', new Date(Date.now() - 60 * 60_000).toISOString());
    if ((badRows ?? []).reduce((s, r) => s + Number(r.hits), 0) > 20) throw new Fail(429, 'Too many requests. Please wait and try again later.');
    await limit(`ip:${ip}:${action}`, action === 'save' ? 240 : action === 'submit' ? 20 : 120, 10);

    const token = String(body.token ?? '');
    const state = TOKEN_RE.test(token) ? (await admin.rpc('registration_for_token', { p_token: token })).data as Record<string, unknown> | null : { state: 'invalid' };
    if (!state || state.state === 'invalid') {
      await admin.rpc('registration_rate_hit', { p_bucket: `badlink:${ip}`, p_limit: 1000000, p_window_minutes: 60 });
      return json(200, { state: 'invalid' }, origin);
    }
    if (action === 'load' || state.state !== 'open') return json(200, publicState(state, action), origin);
    const id = String(state.id);
    await limit(`link:${id}:${action}`, action === 'save' ? 240 : 60, 10);

    if (action === 'save') {
      const answers = sanitizeAnswers(body.answers);
      const { error } = await admin.rpc('save_registration_draft', { p_token: token, p_answers: answers });
      if (error) throw new Fail(409, 'This form can no longer be changed.');
      return json(200, { ok: true }, origin);
    }

    if (action === 'upload_url') {
      const field = String(body.field ?? '');
      const size = Number(body.size ?? 0);
      if (!FILE_FIELDS.includes(field)) throw new Fail(400, 'Unknown document.');
      if (!(size > 0 && size <= MAX_FILE)) throw new Fail(400, 'Files must be up to 10 MB.');
      const path = `${id}/${crypto.randomUUID()}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new Fail(500, 'The upload could not be prepared.');
      return json(200, { path, uploadToken: data.token }, origin);
    }

    if (action === 'attach_file') {
      const field = String(body.field ?? '');
      const path = String(body.path ?? '');
      const f = fieldByKey.get(field);
      if (!f || f.type !== 'file' || !path.startsWith(`${id}/`) || path.includes('..')) throw new Fail(400, 'Unknown document.');
      const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
      if (error || !blob) throw new Fail(400, 'The file did not finish uploading. Please try again.');
      const kind = sniffFile(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
      if (!kind || !(f.accept ?? ['pdf', 'image']).includes(kind.kind) || blob.size > MAX_FILE || blob.size === 0) {
        await admin.storage.from(BUCKET).remove([path]);
        throw new Fail(400, f.accept?.length === 1 && f.accept[0] === 'pdf' ? 'Upload a PDF file.' : f.accept?.length === 1 ? 'Upload a JPG or PNG image.' : 'Upload a PDF, JPG or PNG file.');
      }
      const name = safeFileName(String(body.name ?? 'file'));
      const { data: row, error: e2 } = await admin.from('partner_registration_files')
        .insert({ registration_id: id, field_key: field, file_name: name, size: blob.size, mime: kind.mime, storage_path: path }).select('id').single();
      if (e2 || !row) throw new Fail(500, 'The file could not be saved.');
      const files = { ...((state.files as Record<string, unknown>) ?? {}), [field]: { id: row.id, name, size: blob.size, mime: kind.mime } };
      await admin.from('partner_registrations').update({ files }).eq('id', id);
      return json(200, { file: files[field] }, origin);
    }

    if (action === 'send_code') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) throw new Fail(400, 'Enter a valid email address.');
      if (!MAIL.apiKey || !MAIL.fromAddress) throw new Fail(503, 'Email verification is not available right now. You can still submit; SSI GLOBAL will confirm the address.');
      await limit(`code:${id}`, 5, 60);
      await limit(`code-ip:${ip}`, 10, 60);
      const code = sixDigitCode();
      await admin.from('partner_registration_email_codes').upsert({ registration_id: id, email, code_hash: await sha256Hex(`${id}:${email}:${code}`),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0, sent_at: new Date().toISOString() });
      const sent = await sendViaBrevo(MAIL, { email, name: String(state.company_name) }, codeEmail(String(state.company_name), code));
      if (!sent.ok) throw new Fail(502, 'The code could not be sent. Check the address and try again.');
      return json(200, { ok: true }, origin);
    }

    if (action === 'verify_code') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const code = String(body.code ?? '').trim();
      const { data: c } = await admin.from('partner_registration_email_codes').select('*').eq('registration_id', id).maybeSingle();
      if (!c || c.email !== email || new Date(c.expires_at) < new Date() || c.attempts >= 5) throw new Fail(400, 'This code has expired. Send a new code.');
      await admin.from('partner_registration_email_codes').update({ attempts: c.attempts + 1 }).eq('registration_id', id);
      if (!/^\d{6}$/.test(code) || (await sha256Hex(`${id}:${email}:${code}`)) !== c.code_hash) throw new Fail(400, 'That code is not correct.');
      await admin.from('partner_registration_email_codes').delete().eq('registration_id', id);
      await admin.from('partner_registrations').update({ verified_email: email, email_verified_at: new Date().toISOString() }).eq('id', id);
      return json(200, { ok: true, verifiedEmail: email }, origin);
    }

    // submit
    if (body.website_url) throw new Fail(400, 'The form could not be submitted.'); // honeypot field, invisible to people
    const answers = sanitizeAnswers(body.answers);
    answers.company_name = String(state.company_name); // the link's company cannot be changed
    const problems = formProblems(answers);
    if (Object.keys(problems).length) return json(422, { error: 'Some answers need attention.', problems }, origin);
    const mailOn = !!(MAIL.apiKey && MAIL.fromAddress);
    const verified = String(state.verified_email ?? '');
    if (mailOn && verified !== String(answers.registered_email ?? '').toLowerCase()) {
      return json(422, { error: 'Confirm your login email with the code we send.', problems: { registered_email: 'Confirm this email address with the code' } }, origin);
    }
    const idem = String(body.idempotencyKey ?? '').slice(0, 80) || null;
    const { data, error } = await admin.rpc('submit_partner_registration', { p_token: token, p_answers: answers, p_form_version: FORM_VERSION, p_idempotency: idem });
    if (error) throw new Fail(409, 'This form can no longer be submitted. It may have been submitted already or the link was replaced.');
    return json(200, { ok: true, reference: (data as { reference: string }).reference }, origin);
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message }, origin);
    return json(500, { error: 'Something went wrong. Please try again.' }, origin);
  }
});

// What the public page may know: never internal notes, reviewers or other registrations.
function publicState(s: Record<string, unknown>, action: string) {
  if (s.state !== 'open') {
    return { state: s.state, companyName: s.company_name ?? null, reference: s.reference ?? null, submittedAt: s.submitted_at ?? null, ...(action !== 'load' ? { error: 'This link can no longer be used.' } : {}) };
  }
  return {
    state: 'open', reference: s.reference, companyName: s.company_name, country: s.country, intendedEmail: s.intended_email, status: s.status,
    answers: s.answers ?? {}, files: s.files ?? {}, verifiedEmail: s.verified_email ?? null, expiresAt: s.expires_at, changeRequest: s.change_request ?? null,
    emailVerification: !!(MAIL.apiKey && MAIL.fromAddress), formVersion: FORM_VERSION,
  };
}
