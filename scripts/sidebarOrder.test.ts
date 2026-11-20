// node --test scripts/sidebarOrder.test.ts — saved sidebar order only sorts permitted sections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSections } from '../src/lib/navOrder.ts';

const S = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (x: { id: string }[]) => x.map((s) => s.id);
const def = S('ps-overview', 'ps-tools', 'ps-work', 'ps-workspace', 'ps-self');

test('no saved order: the approved default order', () => {
  assert.deepEqual(ids(orderSections(def, undefined)), ['ps-overview', 'ps-tools', 'ps-work', 'ps-workspace', 'ps-self']);
});
test('saved order is applied; Dashboard stays first', () => {
  assert.deepEqual(ids(orderSections(def, ['ps-workspace', 'ps-tools', 'ps-self', 'ps-work'])), ['ps-overview', 'ps-workspace', 'ps-tools', 'ps-self', 'ps-work']);
  // A saved list that names Dashboard cannot move it.
  assert.equal(ids(orderSections(def, ['ps-self', 'ps-overview']))[0], 'ps-overview');
});
test('a section the user may not see is never added by a saved order', () => {
  const visible = S('overview', 'work', 'self');
  assert.deepEqual(ids(orderSections(visible, ['admin-only', 'self', 'work'])), ['overview', 'self', 'work']);
});
test('a newly permitted section appears in its default position', () => {
  const now = S('overview', 'a', 'b', 'c', 'd');
  assert.deepEqual(ids(orderSections(now, ['c', 'a', 'd'])), ['overview', 'c', 'b', 'a', 'd']);
});
test('every section appears exactly once', () => {
  const out = ids(orderSections(def, ['ps-self', 'ps-self', 'ps-tools']));
  assert.equal(new Set(out).size, out.length);
  assert.equal(out.length, def.length);
});
