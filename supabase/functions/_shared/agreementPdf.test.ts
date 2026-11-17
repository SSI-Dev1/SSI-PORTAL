// deno test --allow-read --node-modules-dir=none supabase/functions/_shared/agreementPdf.test.ts
import { PDFDocument, StandardFonts } from 'npm:pdf-lib@1.17.1';
import { fillAgreement, inspectPdf, LAYOUTS, sha256 } from './agreementPdf.ts';
import { particularsFrom } from '../partner-registration/agreements.ts';

function assert(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
}

async function blankPdf(pages: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([592, 768]);
  return await d.save();
}

const P = {
  companyName: 'Sample Overseas Education Consultants Private Limited', countryState: 'Kerala, India',
  address: '2nd Floor, Example Towers, MG Road, Kochi, Kerala 682016', representativeName: 'Priya Example', representativeDesignation: 'Director',
  agreementDate: '2026-11-17', reference: 'PR-26-TEST', templateLabel: 'Domestic agreement v1',
};

Deno.test('fills a 13-page template and appends Annexure A', async () => {
  const out = await fillAgreement(await blankPdf(13), P, 'ssi_domestic_v1', await blankPdf(2));
  assert(out.pages === 15, `expected 15 pages, got ${out.pages}`);
  const back = await PDFDocument.load(out.bytes);
  assert(back.getPageCount() === 15, 'output re-opens with every page');
  assert(back.getTitle()?.includes('Sample Overseas') ?? false, 'title names the partner');
});

Deno.test('refuses a template whose pages do not match the measured layout', async () => {
  let err = '';
  try { await fillAgreement(await blankPdf(12), P, 'ssi_domestic_v1'); } catch (e) { err = String((e as Error).message); }
  assert(err === 'TEMPLATE_LAYOUT_MISMATCH', `got ${err}`);
  err = '';
  try { await fillAgreement(await blankPdf(13), P, 'unknown'); } catch (e) { err = String((e as Error).message); }
  assert(err === 'LAYOUT_UNKNOWN', `got ${err}`);
});

Deno.test('very long particulars are refused instead of overflowing the clause text', async () => {
  let err = '';
  try { await fillAgreement(await blankPdf(13), { ...P, address: 'Very long address '.repeat(60) }, 'ssi_domestic_v1'); } catch (e) { err = String((e as Error).message); }
  assert(err === 'PARTICULARS_TOO_LONG', `got ${err}`);
});

Deno.test('non-Latin characters do not break generation', async () => {
  const out = await fillAgreement(await blankPdf(13), { ...P, companyName: 'Agencia Educación ಕನ್ನಡ', representativeName: 'José' }, 'ssi_domestic_v1');
  assert(out.pages === 13, 'generated');
});

Deno.test('inspectPdf accepts a plain PDF and rejects others', async () => {
  const ok = await inspectPdf(await blankPdf(3));
  assert(ok.problems.length === 0 && ok.pages === 3, JSON.stringify(ok));
  const notPdf = await inspectPdf(new TextEncoder().encode('MZ fake executable'));
  assert(notPdf.problems[0].includes('not a PDF'), 'non-PDF rejected by content, not by name');
  const d = await PDFDocument.create();
  d.addPage();
  d.addJavaScript('x', 'app.alert(1)');
  const js = await inspectPdf(await d.save());
  assert(js.problems.length > 0, 'scripts rejected');
  const broken = new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf');
  assert((await inspectPdf(broken)).problems.length > 0, 'unreadable PDF rejected');
});

Deno.test('sha256 is stable', async () => {
  const b = new TextEncoder().encode('abc');
  assert((await sha256(b)) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'known digest');
});

Deno.test('particulars come from the registration answers', () => {
  const { values, missing } = particularsFrom({ legal_name: 'Legal Co Pvt Ltd', state: 'Kerala', country: 'India', office_address: 'Main Road', city: 'Kochi', postal_code: '682001',
    acceptance_full_name: 'A Person', acceptance_designation: 'CEO' }, 'Brand Co');
  assert(values.companyName === 'Legal Co Pvt Ltd' && values.countryState === 'Kerala, India' && values.address === 'Main Road, Kochi, 682001', JSON.stringify(values));
  assert(missing.length === 0, 'complete');
  const m = particularsFrom({ country: 'India' }, 'Brand Co');
  assert(m.values.companyName === 'Brand Co' && m.missing.includes('Country and State') && m.missing.includes('Full Office Address'), JSON.stringify(m.missing));
});

Deno.test('layout is measured for the 13-page Domestic agreement', () => {
  assert(LAYOUTS.ssi_domestic_v1.pages === 13, 'pages');
  void StandardFonts;
});
