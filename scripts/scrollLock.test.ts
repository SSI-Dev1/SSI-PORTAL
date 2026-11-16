// node --test scripts/scrollLock.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

const body = { style: { overflow: '' } };
let dialogs = 0;
(globalThis as { document?: unknown }).document = { body, querySelector: () => (dialogs ? {} : null) };
const { lockScroll, releaseOrphanedScrollLock, scrollLockHolders } = await import('../src/lib/scrollLock.ts');

test('overlays closing out of order leave the page scrollable', () => {
  const drawer = lockScroll();
  const modal = lockScroll();
  assert.equal(body.style.overflow, 'hidden');
  drawer(); // the first overlay closes first
  assert.equal(body.style.overflow, 'hidden', 'still locked while the modal is open');
  modal();
  assert.equal(body.style.overflow, '', 'unlocked after the last overlay closes');
  assert.equal(scrollLockHolders(), 0);
});

test('releasing twice does not unlock another overlay', () => {
  const a = lockScroll();
  const b = lockScroll();
  a();
  a();
  assert.equal(body.style.overflow, 'hidden');
  b();
  assert.equal(body.style.overflow, '');
});

test('navigation safety net unlocks only when no dialog is on screen', () => {
  lockScroll(); // leaked lock (never released)
  dialogs = 1;
  releaseOrphanedScrollLock();
  assert.equal(body.style.overflow, 'hidden', 'a visible dialog keeps its lock');
  dialogs = 0;
  releaseOrphanedScrollLock();
  assert.equal(body.style.overflow, '');
  assert.equal(scrollLockHolders(), 0);
});
