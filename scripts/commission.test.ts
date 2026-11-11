// node --test scripts/commission.test.ts — commission sheet parsing (synthetic rows, never real rates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommissionSheet, parseValue, times100 } from '../src/lib/commissionImport.ts';

const sheet = (rows: Record<string, string>[]) => [{ name: 'Sheet1', rows: rows.map((cells, i) => ({ r: i + 1, cells })) }];
const header = { C: 'WHAT WE GETTING', D: 'PORTAL', E: 'OUR COMMISSION TIER 1', F: 'PROFIT', G: 'TIER 2', H: 'TIER 3' };

test('exact decimal percentages', () => {
  assert.equal(times100('0.175'), '17.5');
  assert.equal(times100('0.2'), '20');
  assert.equal(times100('0.025'), '2.5');
  assert.equal(times100('1'), '100');
});

test('cell values', () => {
  assert.deepEqual(parseValue('0.18'), { raw: '0.18', kind: 'percent', value: '18', currency: null, note: null, needsReview: false });
  assert.equal(parseValue('18% (GST)').note, 'GST');
  assert.equal(parseValue('15%%').needsReview, true);
  assert.equal(parseValue('15.0').kind, 'unclear');
  assert.deepEqual([parseValue('500 GBP').kind, parseValue('500 GBP').value, parseValue('500 GBP').currency], ['amount', '500', 'GBP']);
  assert.deepEqual([parseValue('£250 extra').value, parseValue('£250 extra').currency], ['250', 'GBP']);
  assert.equal(parseValue('4000').currency, null);
  assert.equal(parseValue('4000').needsReview, true);
  assert.equal(parseValue('4000', 'GBP').needsReview, false);
  assert.equal(parseValue('22.5 / 750 GBP Bonus').kind, 'unclear', 'a currency elsewhere in the cell does not make the first number an amount');
});

test('rows, routes, levels, campuses and keys', () => {
  const p = parseCommissionSheet(sheet([
    header,
    { A: 'Sample University\nJanuary 2027', B: 'India', C: 'UG - 5500', D: 'UG - PORTAL ONE', E: '5000', F: '500', G: '4000', H: '4000' },
    { A: 'Sample University\nJanuary 2027', B: 'India', C: 'PG - 4500', D: 'PG - PORTAL TWO', E: '4200', F: '300', G: '4000', H: '4000' },
    { A: 'Campus College', B: 'India', C: 'North - 22%', D: 'PORTAL ONE', E: '0.2', F: '0.02', G: '0.2', H: '0.2' },
    { A: 'Campus College', B: 'India', C: 'South - 24%', D: 'PORTAL ONE', E: '0.22', F: '0.01', G: '0.2', H: '0.2' },
    { A: 'Direct University', B: 'India', C: '0.2', D: 'Direct', E: '0.18', F: '0.02', G: '0.17', H: '0.16', Z: 'extra info' },
    { A: 'Two Portal University', B: 'India', C: '0.2', D: 'PORTAL ONE/PORTAL TWO', E: '0.18', F: '0.02', G: '0.17', H: '0.16' },
  ]), 'United Kingdom');
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 6);
  assert.equal(new Set(p.rows.map((r) => r.source_key)).size, 6, 'different portals, levels and campuses stay separate records');
  const [ug, pg, north, south, direct, two] = p.rows;
  assert.deepEqual([ug.study_level, ug.provider_label, ug.intake], ['UG', 'PORTAL ONE', 'January 2027']);
  assert.equal(pg.study_level, 'PG');
  assert.ok(ug.needs_review && /Currency not stated/.test(ug.review_notes ?? ''), 'amounts without a currency are flagged');
  assert.deepEqual([north.variant, south.variant], ['North', 'South']);
  assert.ok(south.needs_review && /Tier 1 \+ profit/.test(south.review_notes ?? ''), '22% + 1% ≠ 24% is flagged');
  assert.equal(north.needs_review, false);
  assert.deepEqual([direct.route, direct.provider_label], ['direct', null]);
  assert.equal(direct.source_row['(column Z)'], 'extra info', 'unknown columns are kept');
  assert.equal(direct.source_row['OUR COMMISSION TIER 1'], '0.18', 'original headers and values are kept');
  assert.ok(two.needs_review && /More than one portal/.test(two.review_notes ?? ''));
  assert.equal(ug.internal.received_value, '5500');
  assert.equal(ug.conditions, null, 'internal bonus terms never become partner conditions');
});

test('missing tier columns are reported', () => {
  const p = parseCommissionSheet(sheet([{ A: 'University', D: 'PORTAL', E: 'TIER 1' }, { A: 'X', D: 'Y', E: '0.2' }]), 'United Kingdom');
  assert.ok(p.errors.some((e) => /tier 2/.test(e)));
});
