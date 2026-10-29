// node --test scripts/catalogue.test.ts — parser checks with a generated workbook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { findDates, levelOf, parseCatalogue, parseMoney, previewImport, readWorkbook } from '../src/lib/catalogueImport.ts';

function xlsx(sheets: Record<string, (string | number | null)[][]>) {
  const names = Object.keys(sheets);
  const strings: string[] = [];
  const si = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(`<workbook><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
  };
  names.forEach((n, i) => {
    const rows = sheets[n].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v == null || v === '') return '';
      const ref = String.fromCharCode(65 + ci) + (ri + 1);
      return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`);
  });
  files['xl/sharedStrings.xml'] = strToU8(`<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  return zipSync(files);
}

test('helpers', () => {
  assert.deepEqual(findDates('18th Jan 2027').map((d) => d.date), ['2027-01-18']);
  assert.deepEqual(findDates('25th Jan 2028\n(MSC)\n28th April 2028\n(MBA)').map((d) => d.date), ['2028-01-25', '2028-04-28']);
  assert.deepEqual(findDates('46388').map((d) => d.date), ['2027-01-01']);
  assert.deepEqual(parseMoney('£15,500'), { amount: 15500, currency: 'GBP' });
  assert.equal(parseMoney('TBC').amount, null);
  assert.equal(levelOf('Postgraduate (MBA)'), 'Postgraduate');
  assert.equal(levelOf('Bachelors'), 'Undergraduate');
});

test('flat layout: one row per course with intakes', () => {
  const bytes = xlsx({
    Courses: [
      ['University', 'Country', 'City', 'Course', 'Level', 'Category', 'Tuition', 'Intake', 'Deadline'],
      ['Test University', 'Canada', 'Toronto', 'MSc Data', 'Postgraduate', 'Computing', 'CAD 30,000', 'Sep 2027, Jan 2028', '1 Jul 2027'],
      ['Test University', 'Canada', 'Toronto', 'BA Arts', 'Undergraduate', 'Arts', '', 'Sep 2027', ''],
      ['', '', '', 'Orphan course', 'Postgraduate', '', '1000', '', ''],
    ],
  });
  const r = parseCatalogue(readWorkbook(bytes), 'flat test');
  assert.equal(r.layout, 'flat');
  assert.equal(r.payload.universities.length, 1);
  assert.equal(r.payload.courses.length, 2);
  const msc = r.payload.courses.find((c) => c.name === 'MSc Data')!;
  assert.equal(msc.tuition, 30000);
  assert.deepEqual(msc.intakes.map((i) => `${i.month}/${i.year}`), ['9/2027', '1/2028']);
  assert.equal(r.invalid.length, 1, 'row without a university is reported');
  const p = previewImport(r, { universities: [], courses: [] as never, intakes: [], blacklist: [] }, false);
  assert.equal(p.newCourses.length, 1, 'course without a fee is not offered as new');
  assert.ok(p.invalid.some((x) => /without a tuition/.test(x.reason)));
});

test('course finder export: every column kept, originals preserved', () => {
  const header = ['Serial No.', 'University', 'University Ranking', 'Program Name', 'Website URL', 'Campus', 'Country', 'Study Level', 'Duration', 'Open Intakes', 'Intake Year',
    'Entry Requirements', 'IELTS Score', 'IELTS No Band Less Than', 'TOEFL Score', 'PTE Score', 'DET Score', 'Application Deadline', 'Application Fee', 'Yearly Tuition Fee',
    'Scholarship Available', 'Average Scholarship', 'Scholarship Detail', 'Backlog Range', 'Remarks', 'Application Mode', 'English Proficiency Exam Waiver', 'Brand New Column'];
  const bytes = xlsx({
    Sheet1: [
      header,
      [1, 'Sample University', 'QS Ranking - 381\nUS News - 36', 'MSc Data', 'https://example.ac.uk/msc/2025-26/jan#', 'Norwich', 'United Kingdom', 'Postgraduate', '12 Months', 'Jan,Sep', 2027,
        '2.2 or equivalent', 6, 5.5, 79, 60, '', 'Sep: 1 Aug 2027, Jan: ASAP', 'No Application Fee', 'GBP 25700.00 (Approx INR 3260999)', 'Yes', 'GBP 5000.00 (Approx INR 634436)',
        'https://example.ac.uk/scholarships', '0 - 30', 'Line one_x000D_\n line two', 'Online', 'MOI accepted', 'extra value'],
      [2, 'Sample University', '', 'MSc Data with Placement', 'https://example.ac.uk/msc/2025-26/jan#', 'Norwich', 'United Kingdom', 'Postgraduate', '24 Months', 'Sep', 2027,
        '', 6, 5.5, 79, 60, 105, 'ASAP', '', 'GBP 25700.00', 'No', '', 'not a link', '', '', '', '', ''],
      [],
      ['*Note: The Tuition Fee is subject to change.'],
    ],
  });
  const r = parseCatalogue(readWorkbook(bytes), 'course finder test');
  assert.equal(r.layout, 'flat');
  assert.deepEqual(r.unmapped, ['Brand New Column'], 'unknown columns are reported');
  assert.equal(r.payload.rows_read, 2);
  assert.deepEqual(r.payload.notes, ['Note: The Tuition Fee is subject to change.']);
  assert.equal(r.payload.courses.length, 2, 'courses sharing a website URL stay separate');
  const [c, p] = r.payload.courses;
  assert.equal(c.tuition, 25700, 'INR approximation is not part of the fee');
  assert.equal(c.currency, 'GBP');
  assert.equal(c.ielts_min, 6);
  assert.deepEqual(c.details, {
    campus: 'Norwich', website_url: 'https://example.ac.uk/msc/2025-26/jan#', scholarship_url: 'https://example.ac.uk/scholarships', open_intakes: 'Jan,Sep',
    intake_year_text: '2027', application_deadline_text: 'Sep: 1 Aug 2027, Jan: ASAP', application_mode: 'Online', application_fee: 'No Application Fee',
    tuition_text: 'GBP 25700.00 (Approx INR 3260999)', scholarship_available: 'Yes', average_scholarship: 'GBP 5000.00 (Approx INR 634436)',
    backlog_range: '0 - 30', remarks: 'Line one\n line two', english_waiver: 'MOI accepted', ielts_band: 5.5, toefl_score: 79, pte_score: 60, source_serial: '1',
  });
  assert.equal(c.details?.det_score, undefined, 'blank DET stays blank');
  assert.equal(c.source_data?.['Brand New Column'], 'extra value');
  assert.equal(c.source_data?.['DET Score'], null);
  assert.equal(Object.keys(c.source_data ?? {}).length, header.length, 'source record has every column');
  assert.deepEqual(c.source_notes, ['Note: The Tuition Fee is subject to change.']);
  assert.deepEqual(c.intakes.map((i) => `${i.month}/${i.year}`), ['1/2027', '9/2027']);
  assert.equal(c.intakes[0].notes, 'Application deadline: ASAP');
  assert.equal(c.intakes[0].application_deadline, null, 'ASAP is never turned into a date');
  assert.equal(c.intakes[1].application_deadline, '2027-08-01');
  assert.equal(r.payload.universities[0].ranking_details, 'QS Ranking - 381\nUS News - 36');
  assert.equal(p.scholarship, 'No');
  assert.equal(p.details?.scholarship_url, undefined);
  assert.ok(r.invalid.some((i) => /Scholarship detail "not a link"/.test(i.reason)));
});

test('toolkit layout: fees by level, dates per course, MOI list', () => {
  const bytes = xlsx({
    'Entry Requirement & Dates': [
      [46388],
      ['University', 'Course', 'Academic Requirement', 'English Requirement', 'Compliance Requirement', 'Induction Date', 'Course Start Date', 'Course End Date', 'CAS Deadline', 'Last Date of Enrolment'],
      ['Sample Uni, Leeds', 'Postgraduate', '55%', 'IELTS - 6.5 (6.0)', 'Passing year 2020+', 'NA', '18th Jan 2027', '20th Jan 2028\n(MSc)\n30th April 2028\n(MBA)', '28th Nov 2026', 'TBC'],
    ],
    'Fees & Scholarships': [
      ['Sample Uni'],
      ['Course', 'Tuition Fee £', 'Scholarship'],
      ['Postgraduate (MSc)', '£17,000', '£2,000'],
      ['Postgraduate (MBA)', '£18,000', 'NA'],
    ],
    'SU - Course List': [
      ['Category', 'Course Instance Title', 'SOP', '', 'MOI Accepted Universities List'],
      ['Masters', 'MSc Finance', 'Required', '', 'Kerala University'],
      ['', 'Master of Business Administration – MBA', 'Required', '', 'Pune University'],
    ],
  });
  const r = parseCatalogue(readWorkbook(bytes), 'toolkit test');
  assert.equal(r.layout, 'toolkit');
  const [msc, mba] = r.payload.courses;
  assert.equal(msc.tuition, 17000);
  assert.equal(mba.tuition, 18000);
  assert.equal(mba.scholarship, null);
  assert.equal(msc.intakes[0].end_date, '2028-01-20');
  assert.equal(mba.intakes[0].end_date, '2028-04-30');
  assert.equal(msc.intakes[0].application_deadline, '2026-11-28');
  assert.equal(msc.intakes[0].enrolment_deadline, null);
  assert.match(msc.intakes[0].notes ?? '', /Enrolment deadline: TBC/);
  assert.equal(msc.ielts_min, 6.5);
  assert.deepEqual(r.payload.universities[0].moi_accepted, ['Kerala University', 'Pune University']);
  assert.equal(r.payload.universities[0].city, 'Leeds');
  assert.equal(r.payload.universities[0].country, 'United Kingdom');
});

test('rejects non-xlsx input', () => {
  assert.throws(() => readWorkbook(new TextEncoder().encode('hello')), /not an \.xlsx/);
});
