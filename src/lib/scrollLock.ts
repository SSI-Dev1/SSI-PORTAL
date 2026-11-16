// One shared page scroll lock for every overlay (modals, drawers, the mobile menu).
//
// Each overlay used to save document.body.style.overflow when it opened and put that value back when
// it closed. With two overlays open (a profile drawer plus a modal, a dialog plus the mobile menu)
// and the first one closing first, the second "restored" the value it had saved — 'hidden' — and the
// page stayed unable to scroll until a reload. Now locks are counted: the page is locked while at
// least one overlay holds a lock, and the original value comes back when the last one is released.
let holders = 0;
let original = '';

export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (holders === 0) original = document.body.style.overflow === 'hidden' ? '' : document.body.style.overflow;
  holders += 1;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) document.body.style.overflow = original;
  };
}

/** Safety net (navigation, bfcache restore): unlock when no overlay is actually on screen. */
export function releaseOrphanedScrollLock() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  holders = 0;
  if (document.body.style.overflow === 'hidden') document.body.style.overflow = original === 'hidden' ? '' : original;
}

/** Test hook. */
export const scrollLockHolders = () => holders;
