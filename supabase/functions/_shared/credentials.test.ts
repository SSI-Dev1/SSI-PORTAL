// deno test supabase/functions/_shared/credentials.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { passwordProblems } from '../admin-users/lib.ts';
import { buildCredentialEmail, generateTempPassword, mailConfig, sendViaBrevo, SUBJECT } from './credentials.ts';

const base = {
  fullName: 'Asha <b>Nair</b>', organization: 'Horizon & Co', accountType: 'Partner Employee', email: 'asha@horizon.test',
  password: 'Tmp#Pass<word>9', portalUrl: 'https://portal.ssiglobal.uk', expiresAt: new Date('2026-11-13T10:00:00Z'),
};

Deno.test('temporary passwords meet the policy and are random', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generateTempPassword();
    assertEquals(p.length, 16);
    assertEquals(passwordProblems(p, 'someone@example.com'), []);
    seen.add(p);
  }
  assertEquals(seen.size, 200);
});

Deno.test('email has every required detail, escaped', () => {
  const m = buildCredentialEmail(base);
  assertEquals(m.subject, SUBJECT);
  for (const s of ['Hello Asha &lt;b&gt;Nair&lt;/b&gt;', 'Welcome to SSI GLOBAL!', 'Horizon &amp; Co', 'Partner Employee', 'asha@horizon.test',
    'Tmp#Pass&lt;word&gt;9', 'LOGIN TO SSI GLOBAL', 'href="https://portal.ssiglobal.uk"', 'https://portal.ssiglobal.uk/email/ssi-global-mark.png',
    'Login instructions', 'Important security notice', 'must create a new password', 'SSI GLOBAL Team', '#06242F', '#FBA51E', '#B94A12']) {
    assertStringIncludes(m.html, s);
  }
  assert(!m.html.includes('<b>Nair</b>'), 'user input is never raw HTML');
  assertStringIncludes(m.text, 'Temporary Password: Tmp#Pass<word>9');
  assertStringIncludes(m.text, 'Organization: Horizon & Co');
  assertStringIncludes(m.text, 'expires on');
});

Deno.test('resend email says earlier passwords stopped working', () => {
  const m = buildCredentialEmail({ ...base, resend: true });
  assertStringIncludes(m.html, 'no longer works');
  assert(m.subject !== SUBJECT);
});

Deno.test('not configured: nothing is sent', async () => {
  let called = false;
  const r = await sendViaBrevo(mailConfig(() => undefined), { email: 'a@b.test', name: 'A' }, { subject: 's', html: 'h', text: 't' }, (() => { called = true; }) as unknown as typeof fetch);
  assertEquals(r, { ok: false, detail: 'Email service is not configured' });
  assert(!called);
});

Deno.test('Brevo request: key in header, accepted only with a message id', async () => {
  const cfg = mailConfig((k) => ({ BREVO_API_KEY: 'xkeysib-test', EMAIL_FROM_ADDRESS: 'no-reply@ssiglobal.uk', EMAIL_FROM_NAME: 'SSI GLOBAL' } as Record<string, string>)[k]);
  let sent: { url: string; init: RequestInit } | null = null;
  const ok = await sendViaBrevo(cfg, { email: 'a@b.test', name: 'A' }, { subject: 's', html: 'h', text: 't' }, (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(JSON.stringify({ messageId: '<1@smtp-relay>' }), { status: 201 });
  }) as unknown as typeof fetch);
  assertEquals(ok, { ok: true, messageId: '<1@smtp-relay>' });
  assertEquals(sent!.url, 'https://api.brevo.com/v3/smtp/email');
  assertEquals((sent!.init.headers as Record<string, string>)['api-key'], 'xkeysib-test');
  const body = JSON.parse(String(sent!.init.body));
  assertEquals(body.sender, { email: 'no-reply@ssiglobal.uk', name: 'SSI GLOBAL' });
  assertEquals(body.to, [{ email: 'a@b.test', name: 'A' }]);

  const rejected = await sendViaBrevo(cfg, { email: 'a@b.test', name: 'A' }, { subject: 's', html: 'h', text: 't' }, (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch);
  assertEquals(rejected, { ok: false, detail: 'Rejected by the email provider (HTTP 400)' });
  const offline = await sendViaBrevo(cfg, { email: 'a@b.test', name: 'A' }, { subject: 's', html: 'h', text: 't' }, (async () => { throw new Error('net'); }) as unknown as typeof fetch);
  assertEquals(offline, { ok: false, detail: 'The email provider could not be reached' });
});

Deno.test('expiry is configurable and bounded', () => {
  assertEquals(mailConfig(() => undefined).ttlHours, 72);
  assertEquals(mailConfig((k) => (k === 'TEMP_PASSWORD_TTL_HOURS' ? '24' : undefined)).ttlHours, 24);
  assertEquals(mailConfig((k) => (k === 'TEMP_PASSWORD_TTL_HOURS' ? '99999' : undefined)).ttlHours, 720);
});
