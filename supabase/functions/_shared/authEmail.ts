// Branded Supabase Auth emails (Send Email Auth Hook). Supabase Auth still generates, validates and
// expires every token; this only builds the message around the link Supabase would have sent.
import { escapeHtml } from './credentials.ts';

export type AuthEmailType = 'recovery' | 'signup' | 'invite' | 'magiclink' | 'email_change' | 'email' | 'reauthentication';

export interface AuthEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: AuthEmailType | string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
}

/** The same verification link Supabase puts in {{ .ConfirmationURL }} (works with PKCE and implicit flows). */
export function verifyLink(supabaseUrl: string, d: Pick<AuthEmailData, 'token_hash' | 'email_action_type' | 'redirect_to' | 'site_url'>, hash = d.token_hash): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  const q = new URLSearchParams({ token: hash, type: d.email_action_type, redirect_to: d.redirect_to || d.site_url });
  return `${base}/auth/v1/verify?${q.toString()}`;
}

/**
 * Password reset: link straight to the portal's reset page with the one-time token hash. The page
 * verifies it with Supabase (verifyOtp), so it works in any browser or device — not only the one that
 * asked — and mail scanners that merely fetch the page cannot use it up. Only for a redirect to the
 * portal's own /reset-password/ page (Supabase has already checked it against the allow-list).
 */
export function recoveryLink(d: Pick<AuthEmailData, 'token_hash' | 'redirect_to' | 'site_url'>): string | null {
  const target = d.redirect_to || '';
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') return null;
  if (!/\/reset-password\/?$/.test(u.pathname)) return null;
  u.search = '';
  u.hash = '';
  u.searchParams.set('token_hash', d.token_hash);
  u.searchParams.set('type', 'recovery');
  return u.toString();
}

const COPY: Record<string, { subject: string; heading: string; lines: string[]; button: string; note: string }> = {
  recovery: {
    subject: 'SSI GLOBAL — Reset Your Password',
    heading: 'Reset your password',
    lines: ['We received a request to reset the password for your SSI GLOBAL Portal account.', 'To create a new password, please click the button below.'],
    button: 'RESET MY PASSWORD',
    note: 'If you did not request a password reset, you can safely ignore this email. For your security, this password reset link is temporary and should not be shared with anyone.',
  },
  invite: {
    subject: 'SSI GLOBAL — You have been invited',
    heading: 'You have been invited',
    lines: ['You have been invited to the SSI GLOBAL Portal.', 'Click the button below to accept the invitation and set up your account.'],
    button: 'ACCEPT INVITATION',
    note: 'If you were not expecting this invitation, you can ignore this email. The link is temporary and should not be shared.',
  },
  signup: {
    subject: 'SSI GLOBAL — Confirm your email address',
    heading: 'Confirm your email address',
    lines: ['Please confirm the email address for your SSI GLOBAL Portal account.'],
    button: 'CONFIRM EMAIL',
    note: 'If you did not create an account, you can ignore this email.',
  },
  magiclink: {
    subject: 'SSI GLOBAL — Your sign-in link',
    heading: 'Your sign-in link',
    lines: ['Use the button below to sign in to the SSI GLOBAL Portal.'],
    button: 'SIGN IN',
    note: 'If you did not request this, you can ignore this email. The link works once and expires soon.',
  },
  email_change: {
    subject: 'SSI GLOBAL — Confirm your new email address',
    heading: 'Confirm your new email address',
    lines: ['Please confirm the change of email address for your SSI GLOBAL Portal account.'],
    button: 'CONFIRM CHANGE',
    note: 'If you did not request this change, contact your administrator straight away.',
  },
};

/** Subject, HTML and text for one auth email. `url` is the Supabase verification link. */
export function buildAuthEmail(type: string, url: string, portalUrl: string, code?: string): { subject: string; html: string; text: string } {
  const portal = portalUrl.replace(/\/+$/, '');
  if (type === 'reauthentication') {
    const subject = 'SSI GLOBAL — Your verification code';
    const text = `Hello,\n\nYour SSI GLOBAL verification code is: ${code ?? ''}\n\nIf you did not request this, contact your administrator.\n\nThank you,\nSSI GLOBAL Team\n${portal}`;
    return { subject, text, html: frame(subject, 'Your verification code', `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#33454C;">Enter this code to continue:</p><p style="margin:0 0 8px;font-size:28px;letter-spacing:6px;font-weight:700;color:#06242F;">${escapeHtml(code ?? '')}</p>`, 'If you did not request this, contact your administrator.', portal) };
  }
  const c = COPY[type] ?? COPY.magiclink;
  const link = escapeHtml(url);
  const body = `<p style="margin:0 0 6px;font-size:15px;color:#06242F;">Hello,</p>
          ${c.lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#33454C;">${escapeHtml(l)}</p>`).join('')}
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 8px;"><tr><td align="center" style="border-radius:10px;background:#FBA51E;background-image:linear-gradient(90deg,#FBA51E,#B94A12);">
            <a href="${link}" style="display:inline-block;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.4px;padding:14px 28px;border-radius:10px;">${escapeHtml(c.button)}</a>
          </td></tr></table>`;
  const text = `Hello,\n\n${c.lines.join('\n')}\n\n${c.button}: ${url}\n\n${c.note}\n\nThank you,\nSSI GLOBAL Team\n${portal}`;
  return { subject: c.subject, text, html: frame(c.subject, c.heading, body, c.note, portal) };
}

function frame(title: string, heading: string, body: string, note: string, portal: string): string {
  const logo = escapeHtml(`${portal}/email/ssi-global-mark.png`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F2F5F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2F5F6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#06242F;padding:24px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="padding-right:12px;"><img src="${logo}" width="44" height="44" alt="SSI GLOBAL" style="display:block;border:0;"></td>
            <td style="color:#FFFFFF;font-size:20px;line-height:1.05;"><b>SSI</b><br><span style="font-weight:300;letter-spacing:1px;">GLOBAL</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:#FBA51E;background-image:linear-gradient(90deg,#FBA51E,#B94A12);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 28px 8px;color:#06242F;">
          <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#06242F;">${escapeHtml(heading)}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 28px;">
          <div style="background:#FFF6E6;border-left:4px solid #FBA51E;border-radius:8px;padding:14px 16px;color:#33454C;font-size:13px;line-height:1.6;">${escapeHtml(note)}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;color:#33454C;font-size:14px;line-height:1.6;">Thank you,<br><b style="color:#06242F;">SSI GLOBAL Team</b><br><a href="${escapeHtml(portal)}" style="color:#B94A12;">${escapeHtml(portal.replace(/^https?:\/\//, ''))}</a></td></tr>
        <tr><td style="background:#06242F;padding:16px 28px;color:#A9BAC0;font-size:11px;line-height:1.6;">This is an automated message about your SSI GLOBAL account. Please do not reply to this email.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
