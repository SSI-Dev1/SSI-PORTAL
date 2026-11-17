// node --test scripts/reportPdf.test.ts — the Daily Work Report PDF is a real, paginated PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { buildReportPdf, reportFileName } from '../src/lib/reportPdf.ts';
import type { ReportView } from '../src/lib/dailyReport.ts';

const timeline = Array.from({ length: 70 }, (_, i) => ({
  id: i, occurred_at: new Date(Date.UTC(2026, 10, 17, 3, 30 + i * 6)).toISOString(), activity_type: 'partner_call', label: i % 7 === 0 ? 'Partner follow-up call with a long descriptive label that wraps' : 'Partner follow-up call',
  manual: i % 9 === 0, entity_type: 'agency', entity_id: String(i), entity_name: `Sample Agency ${i} Private Limited`, application_id: i % 11 === 0 ? `APP-${i}` : null,
  from_status: null, to_status: null, quantity: 1, note: i % 5 === 0 ? 'Discussed intake and commission; follow up next week with the brochure and the MOU draft.' : null, voided: false,
}));
const view: ReportView = {
  employee: 'Sample Employée', designation: 'Partnership Officer', department: 'Partnerships', date: '2026-11-17', templateName: 'Partnership Officer — Daily Work Report',
  status: 'Submitted', submittedAt: '2026-11-17T12:30:00Z', live: false,
  sections: [
    { id: 'outreach', title: 'Partner Outreach & Onboarding', counts: [{ key: 'a', label: 'New partners contacted', value: 3, kind: 'activity' }, { key: 'b', label: 'Pending follow-ups', value: 4, kind: 'pending' }], texts: [] },
    { id: 'updates', title: 'Key Updates', counts: [], texts: [{ key: 'achievements', label: "Today's Achievements", value: 'Line one\nLine two '.repeat(20) }, { key: 'tomorrow_plan', label: "Tomorrow's Plan", value: '' }] },
  ],
  completed: 3, openWork: 4, timeline, pending: [{ title: 'Follow-up · Sample Agency', when: '16 Nov 2026', overdue: true }], pendingNotes: ['2 agencies not connected yet'],
};

test('builds a multi-page PDF with every activity and page numbers', async () => {
  const bytes = await buildReportPdf(view);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, `expected several pages, got ${doc.getPageCount()}`);
  assert.equal(doc.getTitle(), 'SSI GLOBAL Daily Work Report — Sample Employée — 2026-11-17');
  if (process.env.REPORT_PDF_OUT) writeFileSync(process.env.REPORT_PDF_OUT, bytes);
});

test('an empty report is one page', async () => {
  const bytes = await buildReportPdf({ ...view, timeline: [], pending: null, pendingNotes: [], sections: [] });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test('file name is safe on every OS', () => {
  assert.equal(reportFileName({ ...view, employee: 'A/B: C*D' }), 'SSI-GLOBAL-Daily-Work-Report-A-B-C-D-2026-11-17.pdf');
});
