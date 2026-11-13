// Partnership proposal email (agency-proposal function). Pure, unit-tested in proposal.test.ts.
// Partner-facing only: university, level / campus, intake, country, the commission offered,
// currency and partner-facing conditions. SSI GLOBAL's internal classification (Tier 1 / 2 / 3 or
// "custom") is never written into the email — the builder does not read it at all — and neither
// are routes, portals, SSI GLOBAL's own commission or internal remarks.
import { escapeHtml } from './credentials.ts';
import { shell } from './registration.ts';

export interface ProposalUniversity {
  university: string; country: string; study_level?: string | null; variant?: string | null; intake?: string | null;
  commission_kind: 'percent' | 'amount'; commission_value: number | string; currency?: string | null; conditions?: string | null;
}
/** Only the universities are used; the internal kind / tier fields of the stored snapshot are ignored. */
export interface ProposalArrangement { universities: ProposalUniversity[] }
export interface ProposalMail {
  reference: string; companyName: string; recipientName: string; country: string; arrangement: ProposalArrangement;
  termsTitle: string; termsBody: string; message?: string | null; url: string; expires: string; senderName?: string | null;
}

export const proposalSubject = (company: string) => `SSI GLOBAL — Partnership Proposal for ${company}`;
export const PROPOSAL_HEADING = 'SSI GLOBAL — Partnership Commission Proposal';
const SIGN_OFF = 'SSI GLOBAL Partnerships Team';

/** "20" percent → "20%"; 4000 amount GBP → "GBP 4,000". Exact values, no rounding. */
export function fmtRate(kind: string, value: number | string, currency?: string | null) {
  const v = String(value);
  if (kind === 'percent') return `${v}%`;
  const [i, f] = v.split('.');
  return `${currency ? `${currency} ` : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f && Number(f) !== 0 ? `.${f}` : ''}`;
}
const currencyOf = (u: ProposalUniversity) => (u.commission_kind === 'amount' ? u.currency || 'Not stated' : '—');
const uniLabel = (u: ProposalUniversity) => [u.university, u.study_level, u.variant].filter(Boolean).join(' · ');

export function proposalEmail(p: ProposalMail) {
  const rows = p.arrangement.universities;
  const th = 'padding:8px;border-bottom:1px solid #e3e8eb';
  const td = 'padding:8px;border-bottom:1px solid #eef1f3;vertical-align:top';
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:8px 0 16px">
<tr style="background:#f4f6f8"><th align="left" style="${th}">University</th><th align="right" style="${th}">Your commission</th><th align="left" style="${th}">Currency</th><th align="left" style="${th}">Applicable conditions</th></tr>
${rows.map((u) => `<tr><td style="${td}">${escapeHtml(uniLabel(u))}<br><span style="color:#5b6b73">${escapeHtml([u.country, u.intake].filter(Boolean).join(' · '))}</span></td>
<td align="right" style="${td};font-weight:bold">${escapeHtml(fmtRate(u.commission_kind, u.commission_value, u.currency))}</td>
<td style="${td}">${escapeHtml(currencyOf(u))}</td><td style="${td};color:#5b6b73">${escapeHtml(u.conditions || '—')}</td></tr>`).join('')}
</table>`;
  const html = shell(PROPOSAL_HEADING, `
<p style="font-size:15px;line-height:1.5">Dear ${escapeHtml(p.recipientName)},</p>
<p style="font-size:15px;line-height:1.5">Greetings from SSI GLOBAL!</p>
<p style="font-size:15px;line-height:1.5">We are pleased to share our proposed partnership commission arrangements with <b>${escapeHtml(p.companyName)}</b>. Please find below the commission details applicable to your organization.</p>
${p.message ? `<p style="font-size:14px;line-height:1.5;background:#f4f6f8;border-radius:8px;padding:12px 14px">${escapeHtml(p.message).replace(/\n/g, '<br>')}</p>` : ''}
<p style="font-size:14px;margin:16px 0 4px;letter-spacing:.3px"><b>Your Partnership Commission Details</b></p>
${table}
<p style="font-size:13px;color:#5b6b73;margin:0 0 12px">Valid until ${escapeHtml(p.expires)}.</p>
<p style="font-size:14px;margin:16px 0 4px"><b>${escapeHtml(p.termsTitle)}</b></p>
<div style="font-size:13px;line-height:1.5;color:#33444c;border-left:3px solid #FBA51E;padding:4px 12px">${escapeHtml(p.termsBody).replace(/\n/g, '<br>')}</div>
<p style="font-size:14px;line-height:1.5;margin-top:20px">Please review the proposed commission details and confirm your acceptance. Opening the link does not accept anything — you confirm on the next page.</p>
<p style="margin:20px 0"><a href="${escapeHtml(p.url)}" style="background:#B94A12;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;display:inline-block">I CONFIRM</a></p>
<p style="font-size:14px;line-height:1.5">We look forward to building a successful partnership with your organization.</p>
<p style="font-size:13px;color:#5b6b73">Best regards,${p.senderName ? `<br>${escapeHtml(p.senderName)}` : ''}</p>
<p style="font-size:12px;color:#5b6b73">Proposal ${escapeHtml(p.reference)}. After you confirm, we will email your company's partner registration form. This proposal is not a signed agreement and does not give portal access.</p>`, SIGN_OFF);
  const text = [
    PROPOSAL_HEADING, '',
    `Dear ${p.recipientName},`, '',
    'Greetings from SSI GLOBAL!', '',
    `We are pleased to share our proposed partnership commission arrangements with ${p.companyName}. Please find below the commission details applicable to your organization.`, '',
    ...(p.message ? [p.message, ''] : []),
    'YOUR PARTNERSHIP COMMISSION DETAILS',
    ...rows.flatMap((u) => [
      `University: ${uniLabel(u)}${u.country ? ` (${u.country})` : ''}`,
      `Commission: ${fmtRate(u.commission_kind, u.commission_value, u.currency)}`,
      `Currency: ${currencyOf(u)}`,
      `Applicable conditions: ${u.conditions || '—'}`, '',
    ]),
    `Valid until ${p.expires}.`, '',
    p.termsTitle, p.termsBody, '',
    'Please review the proposed commission details and confirm your acceptance.',
    `I CONFIRM: ${p.url}`,
    'Opening the link does not accept anything; you confirm on the page. This proposal is not a signed agreement and does not give portal access.', '',
    'We look forward to building a successful partnership with your organization.', '',
    'Best regards,', ...(p.senderName ? [p.senderName] : []), SIGN_OFF, '',
    `Proposal ${p.reference}`,
  ].join('\n');
  return { subject: proposalSubject(p.companyName), html, text };
}

// ------------------------------------------------------------------ MOU email (after confirmation)
export interface MouMail { companyName: string; recipientName: string; title: string; body: string; reference: string }
export const mouSubject = (company: string) => `SSI GLOBAL — Memorandum of Understanding for ${company}`;

/** The approved MOU text published by SSI GLOBAL. Sending it never marks it as signed. */
export function mouEmail(m: MouMail) {
  const html = shell(m.title, `
<p style="font-size:15px;line-height:1.5">Dear ${escapeHtml(m.recipientName)},</p>
<p style="font-size:15px;line-height:1.5">Thank you for confirming our partnership proposal. Please find below the Memorandum of Understanding between SSI GLOBAL and <b>${escapeHtml(m.companyName)}</b> for your review.</p>
<div style="font-size:13px;line-height:1.6;color:#33444c;border-left:3px solid #FBA51E;padding:6px 14px;margin:14px 0">${escapeHtml(m.body).replace(/\n/g, '<br>')}</div>
<p style="font-size:14px;line-height:1.5">Your SSI GLOBAL Partnerships Team will contact you to complete the signing. You will also receive your partner registration form in a separate email.</p>
<p style="font-size:12px;color:#5b6b73">Reference ${escapeHtml(m.reference)}. This email is not a signed agreement.</p>`, 'SSI GLOBAL Partnerships Team');
  const text = [`Dear ${m.recipientName},`, '', `Thank you for confirming our partnership proposal. Below is the Memorandum of Understanding between SSI GLOBAL and ${m.companyName} for your review.`, '',
    m.title, m.body, '', 'Your SSI GLOBAL Partnerships Team will contact you to complete the signing. You will also receive your partner registration form in a separate email.', '',
    `Reference ${m.reference}. This email is not a signed agreement.`, '', 'SSI GLOBAL Partnerships Team'].join('\n');
  return { subject: mouSubject(m.companyName), html, text };
}
