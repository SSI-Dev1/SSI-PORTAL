// deno test supabase/functions/_shared/proposal.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { fmtRate, mouEmail, proposalEmail, proposalSubject } from './proposal.ts';

const base = {
  reference: 'PP-26-ABC123', companyName: 'Ravi <Overseas>', recipientName: 'Ravi', country: 'India',
  arrangement: { kind: 'tier' as const, tier_label: 'Tier 1', universities: [
    { university: 'Bulk University 1', country: 'United Kingdom', study_level: 'PG', commission_kind: 'percent' as const, commission_value: '20', conditions: 'Paid after enrolment' },
    { university: 'Example College', country: 'United Kingdom', commission_kind: 'amount' as const, commission_value: '4000.00', currency: 'GBP' },
  ] },
  termsTitle: 'Partner terms', termsBody: 'Line one\nLine two', url: 'https://portal.example/#/proposal/abc', expires: '13 December 2026',
};

Deno.test('subject is exactly as specified', () => {
  assertEquals(proposalSubject('Sterling'), 'SSI GLOBAL — Partnership Proposal for Sterling');
  assertEquals(proposalEmail(base).subject, 'SSI GLOBAL — Partnership Proposal for Ravi <Overseas>');
});

Deno.test('rates are exact and readable', () => {
  assertEquals(fmtRate('percent', '17.5'), '17.5%');
  assertEquals(fmtRate('amount', '4000.00', 'GBP'), 'GBP 4,000');
  assertEquals(fmtRate('amount', 1250.5, 'EUR'), 'EUR 1,250.5');
});

Deno.test('no internal tier, arrangement or classification wording for Tier 1, 2, 3 or custom', () => {
  for (const label of ['Tier 1', 'Tier 2', 'Tier 3', 'Custom commission']) {
    const m = proposalEmail({ ...base, arrangement: { ...base.arrangement, tier_label: label, tier_id: label.toLowerCase().replace(' ', '_'), kind: label.startsWith('Tier') ? 'tier' : 'custom' } as never });
    for (const out of [m.subject, m.html, m.text]) {
      assert(!/\btier|arrangement:|classification|category|custom commission|tier_\d/i.test(out), `${label}: ${out.match(/.{0,30}(tier|arrangement|classification|category).{0,30}/i)?.[0]}`);
    }
    assert(m.html.includes('Your Partnership Commission Details') && m.text.includes('Commission: 20%'));
  }
});

Deno.test('suggested wording, currency and conditions per university', () => {
  const m = proposalEmail(base);
  assert(m.html.includes('SSI GLOBAL — Partnership Commission Proposal') && m.html.includes('Greetings from SSI GLOBAL!'));
  assert(m.html.includes('We look forward to building a successful partnership') && m.html.includes('SSI GLOBAL Partnerships Team'));
  assert(m.text.includes('University: Example College (United Kingdom)') && m.text.includes('Currency: GBP') && m.text.includes('Applicable conditions: Paid after enrolment'));
});

Deno.test('email shows the offered commission, terms and an I CONFIRM link; escapes input', () => {
  const m = proposalEmail(base);
  assert(m.html.includes('I CONFIRM') && m.html.includes(base.url));
  assert(m.html.includes('20%') && m.html.includes('GBP 4,000') && m.html.includes('Paid after enrolment'));
  assert(m.html.includes('Ravi &lt;Overseas&gt;') && !m.html.includes('Ravi <Overseas>'));
  assert(m.html.includes('Line one<br>Line two'));
  assert(m.text.includes('Opening the link does not accept anything'));
  assert(!/portal name|route|margin/i.test(m.text.replace('portal access', '')), 'no internal wording');
});

Deno.test('MOU email: approved text, escaped, never says signed', () => {
  const m = mouEmail({ companyName: 'Ravi <Overseas>', recipientName: 'Ravi', title: 'SSI GLOBAL MOU', body: 'Clause 1\nClause 2', reference: 'PP-26-ABC123' });
  assertEquals(m.subject, 'SSI GLOBAL — Memorandum of Understanding for Ravi <Overseas>');
  assert(m.html.includes('Clause 1<br>Clause 2') && m.html.includes('Ravi &lt;Overseas&gt;'));
  assert(m.text.includes('This email is not a signed agreement') && !/\btier/i.test(m.html + m.text));
});
