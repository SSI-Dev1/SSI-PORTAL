// Supabase Edge Function: Brevo transactional webhook → delivery status of login-credential emails.
//
// Brevo calls this URL for each email event. Only the message id, event name and bounce reason
// are used; the recipient address and message content are ignored and nothing is logged. A
// secret token in the URL proves the call comes from the webhook you configured in Brevo.
// "Delivered" is shown only after Brevo reports a delivered (or opened) event.
//
// Deploy:  supabase functions deploy brevo-webhook --no-verify-jwt --project-ref <ref>
// Secret:  supabase secrets set BREVO_WEBHOOK_TOKEN=<long random value>
// Brevo:   Transactional → Settings → Webhooks → URL
//          https://<ref>.supabase.co/functions/v1/brevo-webhook?token=<same value>
//          Events: Sent, Delivered, Soft bounce, Hard bounce, Invalid email, Blocked, Error, Deferred
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN = Deno.env.get('BREVO_WEBHOOK_TOKEN') ?? '';

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (TOKEN.length < 24 || !sameSecret(new URL(req.url).searchParams.get('token') ?? '', TOKEN)) return new Response(null, { status: 401 });
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const events = (Array.isArray(payload) ? payload : [payload]).slice(0, 100) as Record<string, unknown>[];
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  for (const e of events) {
    const messageId = typeof e['message-id'] === 'string' ? e['message-id'] : '';
    const event = typeof e.event === 'string' ? e.event : '';
    if (!messageId || !event || messageId.length > 300) continue;
    const reason = typeof e.reason === 'string' ? e.reason.slice(0, 200) : null;
    await admin.rpc('apply_email_event', { p_message_id: messageId, p_event: event, p_reason: reason });
  }
  return new Response(null, { status: 204 });
});
