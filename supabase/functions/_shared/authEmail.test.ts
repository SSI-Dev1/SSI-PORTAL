import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { buildAuthEmail, recoveryLink, verifyLink } from './authEmail.ts';

Deno.test('recovery link is the Supabase verify link with the requested redirect', () => {
  const url = verifyLink('https://ref.supabase.co/', { token_hash: 'pkce_abc', email_action_type: 'recovery', redirect_to: 'https://portal.ssiglobal.uk/reset-password/', site_url: 'https://portal.ssiglobal.uk' });
  assertEquals(url, 'https://ref.supabase.co/auth/v1/verify?token=pkce_abc&type=recovery&redirect_to=https%3A%2F%2Fportal.ssiglobal.uk%2Freset-password%2F');
});

Deno.test('falls back to the site URL when no redirect is given', () => {
  const url = verifyLink('https://ref.supabase.co', { token_hash: 'h', email_action_type: 'recovery', redirect_to: '', site_url: 'https://portal.ssiglobal.uk' });
  assertStringIncludes(url, 'redirect_to=https%3A%2F%2Fportal.ssiglobal.uk');
});

Deno.test('recovery email is SSI GLOBAL branded with the required wording', () => {
  const m = buildAuthEmail('recovery', 'https://ref.supabase.co/auth/v1/verify?token=x&type=recovery', 'https://portal.ssiglobal.uk');
  assertEquals(m.subject, 'SSI GLOBAL — Reset Your Password');
  for (const s of ['RESET MY PASSWORD', 'We received a request to reset the password for your SSI GLOBAL Portal account.',
    'you can safely ignore this email', 'should not be shared with anyone', 'SSI GLOBAL Team', '#06242F', '#FBA51E', '#B94A12', '/email/ssi-global-mark.png']) {
    assertStringIncludes(m.html, s);
  }
  assertStringIncludes(m.html, 'href="https://ref.supabase.co/auth/v1/verify?token=x&amp;type=recovery"');
  assert(!/supabase/i.test(m.subject), 'no Supabase branding in the subject');
  assertStringIncludes(m.text, 'RESET MY PASSWORD: https://ref.supabase.co/auth/v1/verify?token=x&type=recovery');
});

Deno.test('links are HTML-escaped', () => {
  const m = buildAuthEmail('magiclink', 'https://x.test/?a="><script>', 'https://portal.ssiglobal.uk');
  assert(!m.html.includes('<script>'));
});

Deno.test('reauthentication sends the code, not a link', () => {
  const m = buildAuthEmail('reauthentication', '', 'https://portal.ssiglobal.uk', '123456');
  assertStringIncludes(m.html, '123456');
  assertStringIncludes(m.text, '123456');
});

import { signStandardWebhook, verifyStandardWebhook } from './webhookSignature.ts';
Deno.test('hook signature: valid, tampered, stale and missing', async () => {
  const secret = 'v1,whsec_' + btoa('0123456789abcdef0123456789abcdef');
  const body = '{"user":{"email":"a@b.test"}}';
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signStandardWebhook(secret, 'msg_1', ts, body);
  const h = (s: string, t = ts) => new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(t), 'webhook-signature': s });
  assert(await verifyStandardWebhook(secret, h(sig), body));
  assert(!(await verifyStandardWebhook(secret, h(sig), body + ' ')), 'tampered body');
  assert(!(await verifyStandardWebhook(secret, h(sig, ts - 600), body)), 'stale timestamp');
  assert(!(await verifyStandardWebhook(secret, new Headers(), body)), 'no headers');
  assert(!(await verifyStandardWebhook('', h(sig), body)), 'no secret');
});

Deno.test('recovery link goes straight to the reset page with the token hash', () => {
  assertEquals(recoveryLink({ token_hash: 'pkce_abc+/=', redirect_to: 'https://portal.ssiglobal.uk/reset-password/', site_url: 'https://portal.ssiglobal.uk' }),
    'https://portal.ssiglobal.uk/reset-password/?token_hash=pkce_abc%2B%2F%3D&type=recovery');
  assertEquals(recoveryLink({ token_hash: 'h', redirect_to: 'https://portal.ssiglobal.uk/reset-password/?x=1#y', site_url: '' }),
    'https://portal.ssiglobal.uk/reset-password/?token_hash=h&type=recovery');
});

Deno.test('other redirects keep the Supabase verify link', () => {
  assertEquals(recoveryLink({ token_hash: 'h', redirect_to: 'https://portal.ssiglobal.uk/', site_url: '' }), null);
  assertEquals(recoveryLink({ token_hash: 'h', redirect_to: 'http://evil.test/reset-password/', site_url: '' }), null);
  assertEquals(recoveryLink({ token_hash: 'h', redirect_to: '', site_url: 'https://portal.ssiglobal.uk' }), null);
});
