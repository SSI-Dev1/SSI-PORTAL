// Partnership proposal email (agency-proposal function). Pure, unit-tested in proposal.test.ts.
// Only the partner-facing snapshot stored on the proposal is used: university, level / campus,
// intake, country, the offered commission and partner-facing conditions. Never routes, portals,
// SSI GLOBAL's own commission or internal remarks — those are not in the snapshot at all.
import { escapeHtml } from './credentials.ts';
import { shell } from './registration.ts';

export interface ProposalUniversity {
  university: string; country: string; study_level?: string | null; variant?: string | null; intake?: string | null;
  commission_kind: 'percent' | 'amount'; commission_value: number | string; currency?: string | null; conditions?: string | null;
}
export interface ProposalArrangement { kind: 'tier' | 'custom'; tier_label: string; universities: ProposalUniversity[] }
export interface ProposalMail {
  reference: string; companyName: string; recipientName: string; country: string; arrangement: ProposalArrangement;
  termsTitle: string; termsBody: string; message?: string | null; url: string; expires: string; senderName?: string | null;
}

export const proposalSubject = (company: string) => `SSI GLOBAL — Partnership Proposal for ${company}`;

/** "20" percent → "20%"; 4000 amount GBP → "GBP 4,000". Exact values, no rounding. */
export function fmtRate(kind: string, value: number | string, currency?: string | null) {
  const v = String(value);
  if (kind === 'percent') return `${v}%`;
  const [i, f] = v.split('.');
  return `${currency ? `${currency} ` : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f && Number(f) !== 0 ? `.${f}` : ''}`;
}

const uniLabel = (u: ProposalUniversity) => [u.university, u.study_level, u.variant].filter(Boolean).join(' · ');

export function proposalEmail(p: ProposalMail) {
  const rows = p.arrangement.universities;
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:8px 0 16px">
<tr style="background:#f4f6f8"><th align="left" style="padding:8px;border-bottom:1px solid #e3e8eb">University</th><th align="left" style="padding:8px;border-bottom:1px solid #e3e8eb">Country</th><th align="right" style="padding:8px;border-bottom:1px solid #e3e8eb">Your commission</th></tr>
${rows.map((u) => `<tr><td style="padding:8px;border-bottom:1px solid #eef1f3">${escapeHtml(uniLabel(u))}${u.intake ? `<br><span style="color:#5b6b73">${escapeHtml(u.intake)}</span>` : ''}${u.conditions ? `<br><span style="color:#5b6b73">${escapeHtml(u.conditions)}</span>` : ''}</td>
<td style="padding:8px;border-bottom:1px solid #eef1f3">${escapeHtml(u.country)}</td><td align="right" style="padding:8px;border-bottom:1px solid #eef1f3;font-weight:bold">${escapeHtml(fmtRate(u.commission_kind, u.commission_value, u.currency))}</td></tr>`).join('')}
</table>`;
  const html = shell(`Partnership proposal for ${p.companyName}`, `
<p style="font-size:15px;line-height:1.5">Dear ${escapeHtml(p.recipientName)},</p>
<p style="font-size:15px;line-height:1.5">Thank you for speaking with us. SSI GLOBAL would like to work with <b>${escapeHtml(p.companyName)}</b> as a recruitment partner. Below is our partnership proposal, including the commission we offer you for each university.</p>
${p.message ? `<p style="font-size:14px;line-height:1.5;background:#f4f6f8;border-radius:8px;padding:12px 14px">${escapeHtml(p.message).replace(/\n/g, '<br>')}</p>` : ''}
<p style="font-size:14px;margin:16px 0 4px"><b>Commission arrangement:</b> ${escapeHtml(p.arrangement.tier_label)} · ${escapeHtml(p.country)}</p>
${table}
<p style="font-size:14px;margin:16px 0 4px"><b>${escapeHtml(p.termsTitle)}</b></p>
<div style="font-size:13px;line-height:1.5;color:#33444c;border-left:3px solid #FBA51E;padding:4px 12px">${escapeHtml(p.termsBody).replace(/\n/g, '<br>')}</div>
<p style="font-size:14px;line-height:1.5;margin-top:20px">To accept, open the proposal, review it and confirm. Opening the link does not accept anything — you confirm on the next page.</p>
<p style="margin:20px 0"><a href="${escapeHtml(p.url)}" style="background:#B94A12;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;display:inline-block">I CONFIRM</a></p>
<p style="font-size:13px;color:#5b6b73">Proposal ${escapeHtml(p.reference)} · valid until ${escapeHtml(p.expires)}. After you confirm, we will email your company's partner registration form. This proposal is not a signed agreement and does not give portal access.${p.senderName ? `<br>Sent by ${escapeHtml(p.senderName)}, SSI GLOBAL.` : ''}</p>`);
  const text = [
    `Dear ${p.recipientName},`, '',
    `SSI GLOBAL would like to work with ${p.companyName} as a recruitment partner. Partnership proposal ${p.reference}:`, '',
    ...(p.message ? [p.message, ''] : []),
    `Commission arrangement: ${p.arrangement.tier_label} · ${p.country}`,
    ...rows.map((u) => `- ${uniLabel(u)} (${u.country}): ${fmtRate(u.commission_kind, u.commission_value, u.currency)}${u.conditions ? ` — ${u.conditions}` : ''}`), '',
    p.termsTitle, p.termsBody, '',
    `Review and confirm (I CONFIRM): ${p.url}`,
    `Valid until ${p.expires}. Opening the link does not accept anything; you confirm on the page. This proposal is not a signed agreement and does not give portal access.`,
    '', 'SSI GLOBAL Team',
  ].join('\n');
  return { subject: proposalSubject(p.companyName), html, text };
}
