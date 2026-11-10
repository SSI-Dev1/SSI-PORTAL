// Login-credentials email for new accounts and "Resend login access" (shared by admin-users and
// partner-team). Sent from the server through the Brevo transactional API; the API key never
// reaches the browser. The temporary password exists only in memory while the email is built:
// it is not stored, logged, queued or returned, and only its Auth hash is kept (to expire it and
// to prove it was replaced at first login).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin_staff: 'Admin Staff', application_manager: 'Application Manager', assessment_staff: 'Assessment Staff',
  finance_staff: 'Finance Staff', support_staff: 'Support Staff', partner_admin: 'Partner Company Admin', partner_staff: 'Partner Employee',
};

// ------------------------------------------------------------------ temporary password

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';

function pick(set: string, n: number): string[] {
  const out: string[] = [];
  const max = 256 - (256 % set.length); // rejection sampling: no modulo bias
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < max && out.length < n) out.push(set[b % set.length]);
    }
  }
  return out;
}

/** 16 random characters with every character class the password policy requires. */
export function generateTempPassword(length = 16): string {
  const chars = [...pick(UPPER, 2), ...pick(LOWER, 2), ...pick(DIGITS, 2), ...pick(SYMBOLS, 2), ...pick(UPPER + LOWER + DIGITS + SYMBOLS, length - 8)];
  // Fisher–Yates with crypto randomness.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ------------------------------------------------------------------ email content

export interface CredentialEmail {
  fullName: string;
  organization: string;
  accountType: string;
  email: string;
  password: string;
  portalUrl: string;
  expiresAt: Date;
  resend?: boolean;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const expiryText = (d: Date) =>
  `${d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} (India time)`;

export const SUBJECT = 'Welcome to SSI GLOBAL — Your Login Credentials';
export const RESEND_SUBJECT = 'SSI GLOBAL — Your New Login Details';

/** Subject, HTML and plain-text versions. Every value is escaped; nothing else is included. */
export function buildCredentialEmail(c: CredentialEmail): { subject: string; html: string; text: string } {
  const e = {
    name: escapeHtml(c.fullName), org: escapeHtml(c.organization), type: escapeHtml(c.accountType), email: escapeHtml(c.email),
    password: escapeHtml(c.password), url: escapeHtml(c.portalUrl), logo: escapeHtml(`${c.portalUrl.replace(/\/+$/, '')}/email/ssi-global-mark.png`),
    expires: escapeHtml(expiryText(c.expiresAt)),
  };
  const intro = c.resend
    ? 'Your login access has been renewed. Any earlier temporary password no longer works.'
    : 'Your account has been successfully created.';
  const steps = [
    'Open the SSI GLOBAL Portal.',
    'Enter your registered email address.',
    'Enter the temporary password provided above.',
    'Create your new permanent password when prompted.',
    'Continue to your assigned dashboard.',
  ];
  const row = (label: string, value: string, mono = false) => `
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #E7ECEE;color:#5B6B72;font-size:13px;width:42%;vertical-align:top;">${label}</td>
                <td style="padding:10px 0;border-bottom:1px solid #E7ECEE;color:#06242F;font-size:14px;font-weight:600;word-break:break-all;${mono ? "font-family:'SFMono-Regular',Consolas,'Courier New',monospace;letter-spacing:.5px;" : ''}">${value}</td>
              </tr>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(c.resend ? RESEND_SUBJECT : SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#F2F5F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">Your SSI GLOBAL login details. The password is temporary and expires ${e.expires}.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2F5F6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#06242F;padding:24px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="padding-right:12px;"><img src="${e.logo}" width="44" height="44" alt="SSI GLOBAL" style="display:block;border:0;"></td>
            <td style="color:#FFFFFF;font-size:20px;line-height:1.05;"><b>SSI</b><br><span style="font-weight:300;letter-spacing:1px;">GLOBAL</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:#FBA51E;background-image:linear-gradient(90deg,#FBA51E,#B94A12);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 28px 8px;color:#06242F;">
          <p style="margin:0 0 6px;font-size:15px;">Hello ${e.name},</p>
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#06242F;">Welcome to SSI GLOBAL!</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#33454C;">${intro}</p>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#33454C;">You can now access your assigned SSI GLOBAL Portal using the following login credentials.</p>
        </td></tr>
        <tr><td style="padding:20px 28px 4px;">
          <div style="border:1px solid #E7ECEE;border-radius:12px;padding:6px 18px 10px;">
            <p style="margin:12px 0 4px;font-size:11px;font-weight:700;letter-spacing:1.2px;color:#B94A12;text-transform:uppercase;">Your account details</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${row('Name', e.name)}${row('Organization', e.org)}${row('Account Type', e.type)}${row('Login Email / Username', e.email)}${row('Temporary Password', e.password, true)}
            </table>
            <p style="margin:10px 0 2px;font-size:12px;color:#B94A12;">This temporary password expires on ${e.expires}.</p>
          </div>
        </td></tr>
        <tr><td align="center" style="padding:24px 28px 8px;">
          <a href="${e.url}" style="display:inline-block;background:#FBA51E;background-image:linear-gradient(90deg,#FBA51E,#B94A12);color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.4px;padding:14px 28px;border-radius:10px;">LOGIN TO SSI GLOBAL</a>
          <p style="margin:12px 0 0;font-size:13px;color:#5B6B72;">Portal login: <a href="${e.url}" style="color:#B94A12;">${e.url}</a></p>
        </td></tr>
        <tr><td style="padding:20px 28px 4px;color:#33454C;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.2px;color:#B94A12;text-transform:uppercase;">Login instructions</p>
          <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <div style="background:#FFF6E6;border-left:4px solid #FBA51E;border-radius:8px;padding:14px 16px;color:#33454C;font-size:13px;line-height:1.6;">
            <b style="color:#06242F;">Important security notice</b><br>
            Your initial password is temporary. For your security, you must create a new password during your first login.<br>
            Do not share your login credentials with anyone.<br>
            If you did not expect this account, please contact your administrator.
          </div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;color:#33454C;font-size:14px;line-height:1.6;">Thank you,<br><b style="color:#06242F;">SSI GLOBAL Team</b></td></tr>
        <tr><td style="background:#06242F;padding:16px 28px;color:#A9BAC0;font-size:11px;line-height:1.6;">This is an automated message about your SSI GLOBAL account. Please do not reply to this email.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    `Hello ${c.fullName},`, '', 'Welcome to SSI GLOBAL!', intro,
    'You can now access your assigned SSI GLOBAL Portal using the following login credentials.', '',
    'YOUR ACCOUNT DETAILS', `Name: ${c.fullName}`, `Organization: ${c.organization}`, `Account Type: ${c.accountType}`,
    `Login Email / Username: ${c.email}`, `Temporary Password: ${c.password}`, `This temporary password expires on ${expiryText(c.expiresAt)}.`, '',
    'PORTAL LOGIN', c.portalUrl, '', 'LOGIN INSTRUCTIONS', ...steps.map((s, i) => `${i + 1}. ${s}`), '',
    'IMPORTANT SECURITY NOTICE', 'Your initial password is temporary.', 'For your security, you must create a new password during your first login.',
    'Do not share your login credentials with anyone.', 'If you did not expect this account, please contact your administrator.', '',
    'Thank you,', 'SSI GLOBAL Team',
  ].join('\n');
  return { subject: c.resend ? RESEND_SUBJECT : SUBJECT, html, text };
}

// ------------------------------------------------------------------ sending

export interface MailConfig {
  apiKey: string;
  fromAddress: string;
  fromName: string;
  portalUrl: string;
  ttlHours: number;
}

export function mailConfig(env: (k: string) => string | undefined): MailConfig {
  const ttl = Number(env('TEMP_PASSWORD_TTL_HOURS') ?? 72);
  return {
    apiKey: env('BREVO_API_KEY') ?? '',
    fromAddress: env('EMAIL_FROM_ADDRESS') ?? '',
    fromName: env('EMAIL_FROM_NAME') ?? 'SSI GLOBAL',
    portalUrl: env('PORTAL_PUBLIC_URL') ?? 'https://portal.ssiglobal.uk',
    ttlHours: Number.isFinite(ttl) ? Math.min(Math.max(Math.round(ttl), 1), 720) : 72,
  };
}

export type SendResult = { ok: true; messageId: string } | { ok: false; detail: string };

/** One Brevo transactional request. Accepted means Brevo took it — not that it was delivered. */
export async function sendViaBrevo(cfg: MailConfig, to: { email: string; name: string }, mail: { subject: string; html: string; text: string }, fetcher: typeof fetch = fetch): Promise<SendResult> {
  if (!cfg.apiKey || !cfg.fromAddress) return { ok: false, detail: 'Email service is not configured' };
  try {
    const res = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.fromAddress, name: cfg.fromName },
        to: [{ email: to.email, name: to.name }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        tags: ['account-credentials'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, detail: `Rejected by the email provider (HTTP ${res.status})` };
    const body = (await res.json().catch(() => ({}))) as { messageId?: string };
    return body.messageId ? { ok: true, messageId: body.messageId } : { ok: false, detail: 'The email provider did not confirm the request' };
  } catch {
    return { ok: false, detail: 'The email provider could not be reached' };
  }
}

export interface Delivery {
  id: string | null;
  status: 'accepted' | 'failed';
  detail: string | null;
  expiresAt: string;
}

/**
 * Records the temporary password's hash and expiry, then emails the credentials and records the
 * outcome. Call only after the account exists and its password was set to `password`.
 */
export async function issueAndSend(
  admin: SupabaseClient,
  cfg: MailConfig,
  a: { userId: string; kind: 'initial' | 'resend'; requestedBy: string; email: string; fullName: string; organization: string; accountType: string; password: string },
  fetcher: typeof fetch = fetch,
): Promise<Delivery> {
  const { data: expires, error } = await admin.rpc('record_temp_credential', { p_user: a.userId, p_hours: cfg.ttlHours, p_issued_by: a.requestedBy });
  if (error || !expires) throw new Error('temp-credential');
  const expiresAt = new Date(expires as string);
  const { data: row } = await admin.from('account_credential_deliveries')
    .insert({ user_id: a.userId, kind: a.kind, status: 'pending', requested_by: a.requestedBy, temp_expires_at: expiresAt.toISOString() })
    .select('id').single();
  const mail = buildCredentialEmail({ fullName: a.fullName, organization: a.organization, accountType: a.accountType, email: a.email, password: a.password, portalUrl: cfg.portalUrl, expiresAt, resend: a.kind === 'resend' });
  const sent = await sendViaBrevo(cfg, { email: a.email, name: a.fullName }, mail, fetcher);
  const patch = sent.ok ? { status: 'accepted', provider_message_id: sent.messageId, updated_at: new Date().toISOString() } : { status: 'failed', detail: sent.detail, updated_at: new Date().toISOString() };
  if (row?.id) await admin.from('account_credential_deliveries').update(patch).eq('id', row.id);
  return { id: (row?.id as string | undefined) ?? null, status: sent.ok ? 'accepted' : 'failed', detail: sent.ok ? null : sent.detail, expiresAt: expiresAt.toISOString() };
}

/** Per-hour limits on credential emails: per account manager, and per target account. */
export async function overLimit(admin: SupabaseClient, by: { requestedBy?: string; userId?: string }, max: number) {
  let q = admin.from('account_credential_deliveries').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if (by.requestedBy) q = q.eq('requested_by', by.requestedBy);
  if (by.userId) q = q.eq('user_id', by.userId);
  const { count } = await q;
  return (count ?? 0) >= max;
}
