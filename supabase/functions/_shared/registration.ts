// Pure helpers for the partner-registration function (unit-tested in registration.test.ts).
import { escapeHtml } from './credentials.ts';

export const TOKEN_RE = /^[0-9a-f]{64}$/;

/** File kind by content (never by the name the browser sends). */
export function sniffFile(head: Uint8Array): { kind: 'pdf' | 'image'; mime: string; ext: string } | null {
  const is = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (is([0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  if (is([0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (is([0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', mime: 'image/png', ext: 'png' };
  return null;
}

export const safeFileName = (s: string) => s.replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 6-digit code from a cryptographic random source (no modulo bias). */
export function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4_294_000_000) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

const shell = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#06242F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#06242F;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold">SSI GLOBAL</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px;color:#06242F">${escapeHtml(title)}</h1>${body}
<p style="margin:24px 0 0;font-size:13px;color:#5b6b73">SSI GLOBAL Team</p></td></tr></table></td></tr></table></body></html>`;

export function codeEmail(company: string, code: string) {
  const text = `Your SSI GLOBAL partner registration code for ${company} is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`;
  return {
    subject: `${code} is your SSI GLOBAL registration code`,
    text,
    html: shell('Confirm your email address', `<p style="font-size:15px;line-height:1.5">Use this code to confirm the login email for <b>${escapeHtml(company)}</b>'s partner registration:</p>
<p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#B94A12;margin:16px 0">${code}</p>
<p style="font-size:13px;color:#5b6b73">It expires in 10 minutes. If you did not request it, you can ignore this email.</p>`),
  };
}

export function linkEmail(kind: 'invite' | 'changes', company: string, url: string, expires: string, detail?: { reason?: string; instructions?: string | null; fields?: string[] }) {
  const changes = kind === 'changes';
  const title = changes ? 'Please update your partner registration' : 'Register as an SSI GLOBAL partner';
  const intro = changes
    ? `SSI GLOBAL has reviewed the partner registration for <b>${escapeHtml(company)}</b> and needs a few corrections before it can continue.`
    : `You have been invited to register <b>${escapeHtml(company)}</b> as an SSI GLOBAL partner.`;
  const extra = changes && detail ? `<div style="background:#fff7e8;border-left:4px solid #FBA51E;padding:12px 14px;margin:14px 0;font-size:14px;line-height:1.5">
<b>What to change:</b> ${escapeHtml(detail.reason ?? '')}${detail.fields?.length ? `<br><b>Fields:</b> ${escapeHtml(detail.fields.join(', '))}` : ''}${detail.instructions ? `<br>${escapeHtml(detail.instructions)}` : ''}</div>` : '';
  const text = `${changes ? `SSI GLOBAL needs corrections to the partner registration for ${company}.${detail?.reason ? ` ${detail.reason}.` : ''}` : `You have been invited to register ${company} as an SSI GLOBAL partner.`}\n\nOpen your registration form: ${url}\nThe link expires on ${expires}.\n\nSubmitting the form does not create a partnership agreement or give portal access; SSI GLOBAL reviews every registration first.`;
  return {
    subject: changes ? `SSI GLOBAL — corrections needed for ${company}'s registration` : `SSI GLOBAL — partner registration for ${company}`,
    text,
    html: shell(title, `<p style="font-size:15px;line-height:1.5">${intro}</p>${extra}
<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#B94A12;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">${changes ? 'Update registration' : 'Open registration form'}</a></p>
<p style="font-size:13px;color:#5b6b73">This link is personal to ${escapeHtml(company)} and expires on ${escapeHtml(expires)}. Submitting the form does not create a partnership agreement or give portal access — SSI GLOBAL reviews every registration first.</p>`),
  };
}
