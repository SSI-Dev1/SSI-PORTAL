// node --test scripts/studentImport.test.ts — the student sheet becomes one group per student. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dmyToDate, monthYear, parseStudentSheet, passportOf, serialToDate, STUDENT_COLUMNS } from '../src/lib/studentImport.ts';
import type { Sheet } from '../src/lib/catalogueImport.ts';

const L = 'ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
const row = (r: number, v: Partial<Record<typeof STUDENT_COLUMNS[number], string>>) =>
  ({ r, cells: Object.fromEntries(STUDENT_COLUMNS.map((c, i) => [L[i], v[c] ?? ''])) });
const sheet = (rows: Sheet['rows']): Sheet[] => [{ name: 'Sheet1', rows: [{ r: 1, cells: Object.fromEntries(STUDENT_COLUMNS.map((c, i) => [L[i], c])) }, ...rows] }];

test('dates: Excel serials, day/month/year and month-year intakes', () => {
  assert.equal(serialToDate('46266.0'), '2026-09-01');
  assert.equal(serialToDate('123'), null);
  assert.equal(dmyToDate('13/06/2026'), '2026-06-13');
  assert.equal(dmyToDate('31/02/2026'), null);
  assert.equal(monthYear('september 2026'), '2026-09-01');
  assert.equal(monthYear('Jan-27'), '2027-01-01');
  assert.equal(monthYear('Seotember 2026'), null);
  assert.equal(passportOf('Applied'), null);
  assert.equal(passportOf(' x4857526 '), 'X4857526');
});

test('continuation rows stay with their student; Priority 1 vs blank; every column kept', () => {
  const p = parseStudentSheet(sheet([
    row(2, { 'Sl. No.': '1', 'Student Name': 'Asha  One', 'passport number': 'A1111111', 'Agent Name': 'North Star', 'Priority Intake': '46266', Country: 'UK', Priority: '1.0',
      'Request university': 'Uni A', 'Request course': 'MSc X', 'Program Intake': 'september 2026', 'Submission Date': '46186', 'Offer Status': 'COL', 'Offer Status date': '--', Remarks: 'ok' }),
    row(3, { 'Agent Name': 'North Star', 'Priority Intake': '46266', Country: 'UK', 'Request university': 'Uni B', 'Request course': 'MBA', 'Offer Status date': 'OIP 8/10/2026' }),
    row(4, { 'Agent Name': 'North Star', 'Request university': 'Uni B', 'Request course': 'MBA' }),
    row(5, { 'Sl. No.': '2', 'Student Name': 'Bala', 'passport number': 'Applied', 'Agent Name': 'Blue', Priority: '1', 'Request university': 'Uni C' }),
  ]));
  assert.deepEqual(p.missingColumns, []);
  assert.equal(p.totalRows, 4);
  assert.equal(p.groups.length, 2);
  const a = p.groups[0];
  assert.equal(a.name, 'Asha One');
  assert.equal(a.prefs.length, 3, 'two continuation rows belong to Asha');
  assert.deepEqual(a.prefs.map((x) => x.priority), ['1', null, null], 'blank priority stays blank (no 2/3 invented)');
  assert.equal(a.priority_intake, 'Sep 2026');
  assert.equal(a.prefs[0].program_intake, 'september 2026');
  assert.equal(a.prefs[0].program_intake_month, '2026-09-01');
  assert.equal(a.prefs[0].submission_date, '2026-06-13');
  assert.equal(a.prefs[0].offer_status_date, null, '"--" is blank, not a date issue');
  assert.deepEqual(a.prefs[0].date_issues, []);
  assert.deepEqual(a.prefs[1].date_issues, ['Offer Status date'], 'text that is not a date is kept and reported');
  assert.equal(a.prefs[1].source['Offer Status date'], 'OIP 8/10/2026');
  assert.notEqual(a.prefs[1].key, a.prefs[2].key, 'identical rows get their own key (none lost)');
  assert.equal(a.prefs[0].source['passport number'], undefined, 'passport not copied into the source cells');
  assert.equal(p.groups[1].passport, null, '"Applied" is not a passport');
  assert.equal(p.stats.multiUniversity, 1);
});

test('conflicts and shared passports are flagged, never resolved silently', () => {
  const p = parseStudentSheet(sheet([
    row(228, { 'Student Name': 'Cara', 'passport number': 'C3333333', 'Agent Name': 'X', Priority: '1', 'Request university': 'Uni E' }),
    row(229, { 'Agent Name': 'X', Priority: '1', 'Request university': 'Uni F' }),
    row(230, { 'Student Name': 'Dev One', 'passport number': 'Q9999999', 'Agent Name': 'X', Priority: '1', 'Request university': 'Uni G' }),
    row(231, { 'Student Name': 'Dev Two', 'passport number': 'Q9999999', 'Agent Name': 'X', Priority: '1', 'Request university': 'Uni H' }),
  ]));
  assert.equal(p.stats.priorityConflicts, 1);
  assert.ok(p.groups[0].flags.some((f) => f.includes('Priority conflict') && f.includes('228, 229')));
  assert.equal(p.groups.length, 3, 'same passport, different names: two students, not merged');
  assert.ok(p.groups[1].review && p.groups[2].review, 'both held for review');
});
