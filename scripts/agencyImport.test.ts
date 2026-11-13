// node --test scripts/agencyImport.test.ts — agency sheet parsing (synthetic data only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandNumber, parseAgencySheet, statusLabel } from '../src/lib/agencyImport.ts';

const sheet = { name: 'Sheet1', rows: [
  { r: 1, cells: { A: 'Agent Name', B: 'POC', C: 'Number', D: 'Email', E: 'bpq' } },
  { r: 2, cells: { A: 'Alpha Overseas', B: 'Asha', C: '9.87654321E9', D: 'a@alpha.test', E: 'Proposal send' } },
  { r: 3, cells: { A: 'Beta Consultants', C: '98470 12345', E: 'MOU Send' } },
  { r: 4, cells: { A: 'Gamma Group', B: 'G', C: '9.1987654321E11', E: 'Onboarded' } },
  { r: 5, cells: { A: 'Delta', C: '+44 20 7946 0000', D: 'n/a', E: 'Closed' } },
  { r: 6, cells: {} },
] };

test('exact expansion of numbers Excel stored as numeric cells', () => {
  assert.equal(expandNumber('9.87654321E9'), '9876543210');
  assert.equal(expandNumber('9.1987654321E11'), '919876543210');
  assert.equal(expandNumber('9876543210.0'), '9876543210');
  assert.equal(expandNumber('98470 12345'), null, 'text phones are left as written');
  assert.equal(expandNumber('1.5E0'), null, 'not a whole number');
});

test('rows keep what is there and invent nothing', () => {
  const p = parseAgencySheet([sheet]);
  assert.equal(p.sheet, 'Sheet1');
  assert.deepEqual(Object.keys(p.headers).sort(), ['email', 'name', 'phone', 'poc', 'status']);
  assert.equal(p.rows.length, 4, 'blank rows are ignored');
  assert.deepEqual(p.rows[0], { row: 2, name: 'Alpha Overseas', poc: 'Asha', phone: '9876543210', email: 'a@alpha.test', status: 'Proposal send', phoneFromNumber: true });
  assert.equal(p.rows[1].poc, null);
  assert.equal(p.rows[1].email, null);
  assert.equal(p.rows[1].phone, '98470 12345');
  assert.equal(p.rows[3].phone, '+44 20 7946 0000', 'international numbers untouched');
  assert.equal(p.rows[3].email, null, '"n/a" is empty');
  assert.equal(p.rows[2].phone, '919876543210', 'no + added, no country guessed');
});

test('status labels normalise but keep unknown text', () => {
  assert.equal(statusLabel('Proposal send'), 'Proposal Sent');
  assert.equal(statusLabel('MOU Send'), 'MOU Sent');
  assert.equal(statusLabel('Onboarded'), 'Onboarded');
  assert.equal(statusLabel('Hot lead'), 'Hot lead (not recognised)');
});
