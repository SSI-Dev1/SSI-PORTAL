// Supabase Edge Function: Send Email Auth Hook → SSI GLOBAL branded auth emails through Brevo.
//
// Supabase Auth keeps generating, validating and expiring every token. It calls this hook instead
// of its built-in mailer; the hook only wraps the same verification link in an SSI GLOBAL email and
// sends it from the verified sender used for login-credential emails (EMAIL_FROM_ADDRESS).
// The request is signed by Supabase (Standard Webhooks); unsigned calls are refused. Nothing about
// the recipient, link or token is logged.
//
// Deploy:  supabase functions deploy auth-email --no-verify-jwt --project-ref <ref>
// Secret:  supabase secrets set SEND_EMAIL_HOOK_SECRET='v1,whsec_…'   (from Auth → Hooks → Send Email)
// Uses:    BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, PORTAL_PUBLIC_URL (already set)
import { mailConfig, sendViaBrevo } from '../_shared/credentials.ts';
import { buildAuthEmail, verifyLink, type AuthEmailData } from '../_shared/authEmail.ts';
import { describeWebhookFailure, verifyStandardWebhook } from '../_shared/webhookSignature.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const MAIL = mailConfig((k) => Deno.env.get(k));

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  if (!HOOK_SECRET) return fail(500, 'Email hook is not configured');
  const raw = await req.text();
  let payload: { user: { email: string; new_email?: string }; email_data: AuthEmailData };
  if (!(await verifyStandardWebhook(HOOK_SECRET, req.headers, raw))) {
    // Diagnostics only (no secret, signature, body or address): why the hook call was refused.
    try {
      const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
      await admin.from('audit_log').insert({ actor_id: null, actor_role: 'system', action: 'auth_hook_rejected', entity: 'auth-email', entity_id: 'send_email', partner_id: null,
        changes: describeWebhookFailure(HOOK_SECRET, req.headers) });
    } catch { /* never block on diagnostics */ }
    return fail(401, 'Invalid signature');
  }
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, 'Invalid request');
  }
  const d = payload.email_data;
  const type = d.email_action_type;
  const sends: { to: string; url: string }[] = [];
  if (type === 'email_change' && payload.user.new_email) {
    // Secure email change: one link to the current address, one to the new one.
    if (d.token_hash_new) sends.push({ to: payload.user.email, url: verifyLink(SUPABASE_URL, d, d.token_hash_new) });
    sends.push({ to: payload.user.new_email, url: verifyLink(SUPABASE_URL, d, d.token_hash) });
  } else {
    sends.push({ to: payload.user.email, url: verifyLink(SUPABASE_URL, d) });
  }
  for (const s of sends) {
    const mail = buildAuthEmail(type, s.url, MAIL.portalUrl, d.token);
    const r = await sendViaBrevo(MAIL, { email: s.to, name: s.to }, mail, fetch, `auth-${type}`);
    if (!r.ok) return fail(502, 'The email could not be sent. Please try again in a moment.');
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
});
