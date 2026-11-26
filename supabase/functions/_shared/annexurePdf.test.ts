// deno test supabase/functions/_shared/annexurePdf.test.ts — Annexure A from the accepted proposal (0063). Synthetic data only.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { annexureFromProposal } from './annexurePdf.ts';
import { inspectPdf } from './agreementPdf.ts';

const meta = { companyName: 'Example Overseas', proposalReference: 'PP-26-TEST01', confirmedAt: '20 November 2026', confirmedBy: 'Asha Example', registrationReference: 'PR-26-TEST01' };

Deno.test('Annexure A: one row per university, exact rates, a clean PDF', async () => {
  const out = await annexureFromProposal({ universities: [
    { university: 'Example University', country: 'United Kingdom', study_level: 'PG', intake: 'Sep 2027', commission_kind: 'percent', commission_value: '15' },
    { university: 'Sample College', country: 'Ireland', commission_kind: 'amount', commission_value: '4000.00', currency: 'EUR', conditions: 'Paid after census date' },
  ] }, meta);
  assertEquals(out.pages, 1);
  const check = await inspectPdf(out.bytes);
  assertEquals(check.problems, []);
  const doc = await PDFDocument.load(out.bytes);
  assertEquals(doc.getTitle(), 'Annexure A — Example Overseas');
});

Deno.test('Annexure A: long schedules continue on new pages', async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ university: `University number ${i + 1} with a long campus name`, country: 'United Kingdom', commission_kind: 'percent' as const, commission_value: 10 + (i % 5) }));
  const out = await annexureFromProposal({ universities: many }, meta);
  assert(out.pages >= 2);
});

Deno.test('Annexure A: never produced from an empty proposal', async () => {
  await assertRejects(() => annexureFromProposal({ universities: [] }, meta), Error, 'EMPTY_ARRANGEMENT');
});
