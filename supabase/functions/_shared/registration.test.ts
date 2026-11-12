// deno test supabase/functions/_shared/registration.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ALL_FIELDS, FORM_SECTIONS, formProblems, sanitizeAnswers } from './partnerRegistrationForm.ts';
import { codeEmail, linkEmail, safeFileName, sixDigitCode, sniffFile, TOKEN_RE } from './registration.ts';

const complete = {
  year_established: '2015', country: 'India', state: 'Kerala', city: 'Kochi', office_address: '12 MG Road', company_email: 'info@agency.test', contact_number: '+91 98765 43210',
  contact_full_name: 'Asha N', contact_designation: 'Director', contact_email: 'asha@agency.test', contact_mobile: '+91 98765 43211',
  organisation_type: 'Recruitment Agency', primary_markets: 'India', countries_promoting: 'UK', countries_interested: 'Canada', registered_email: 'asha@agency.test',
  decl_accurate: true, decl_terms: true, decl_guidelines: true, decl_consent: true, decl_authorised: true, decl_review: true,
  acceptance_full_name: 'Asha N', acceptance_designation: 'Director', acceptance_signature: 'asha n',
};

Deno.test('every screenshot section is present, in order', () => {
  assertEquals(FORM_SECTIONS.map((s) => s.title), ['Company / Agency Details', 'Primary Contact Person', 'Business Profile', 'Documents Upload', 'Portal Login Details', 'Declaration']);
  assertEquals(ALL_FIELDS.find((f) => f.key === 'organisation_type')?.options?.length, 7);
  assert(!ALL_FIELDS.some((f) => /password/i.test(f.key)), 'no password is collected');
});

Deno.test('a complete form has no problems', () => {
  assertEquals(formProblems({ ...complete, company_name: 'Agency' }), {});
});

Deno.test('required fields, formats, Other and signature', () => {
  const p = formProblems({ ...complete, company_name: 'Agency', year_established: '1800', company_email: 'nope', contact_number: 'abc', decl_terms: false,
    organisation_type: 'Other', acceptance_signature: 'Someone Else' });
  assertEquals(Object.keys(p).sort(), ['acceptance_signature', 'company_email', 'contact_number', 'decl_terms', 'organisation_type_other', 'year_established']);
  assert(!formProblems({ ...complete, company_name: 'A', website: '' }).website, 'optional fields may be empty');
});

Deno.test('the server keeps only known fields and never the locked company name', () => {
  const s = sanitizeAnswers({ ...complete, company_name: 'Someone Else Ltd', is_admin: true, contact_full_name: '  Asha  ', company_logo: 'x' });
  assertEquals(s.company_name, undefined);
  assertEquals((s as Record<string, unknown>).is_admin, undefined);
  assertEquals(s.company_logo, undefined, 'files are attached by the server, not typed');
  assertEquals(s.contact_full_name, 'Asha');
  assertEquals(s.decl_terms, true);
});

Deno.test('files are recognised by content', () => {
  assertEquals(sniffFile(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))?.kind, 'pdf');
  assertEquals(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))?.mime, 'image/png');
  assertEquals(sniffFile(new Uint8Array([0x4d, 0x5a, 0x90, 0x00])), null, 'an .exe renamed to .pdf is refused');
  assertEquals(safeFileName('../../etc/passwd'), '.._.._etc_passwd');
});

Deno.test('codes, tokens and emails', () => {
  for (let i = 0; i < 50; i++) assert(/^\d{6}$/.test(sixDigitCode()));
  assert(TOKEN_RE.test('a'.repeat(64)) && !TOKEN_RE.test('a'.repeat(63)) && !TOKEN_RE.test('A'.repeat(64)));
  assert(codeEmail('Agency <b>', '123456').html.includes('Agency &lt;b&gt;'));
  const m = linkEmail('changes', 'Agency', 'https://portal.ssiglobal.uk/#/partner-registration/abc', '1 Dec 2026', { reason: 'Address <missing>', fields: ['City'] });
  assert(m.html.includes('Address &lt;missing&gt;') && m.text.includes('does not create a partnership agreement'));
});
