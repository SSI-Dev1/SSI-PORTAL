// Floating layers (selects, menus, pickers) render in a portal. Inside a modal they
// must portal *into* the modal so its focus trap still allows them to receive focus.
import { createContext, useContext } from 'react';

export const PortalContainerContext = createContext<HTMLElement | null>(null);
export const usePortalContainer = () => useContext(PortalContainerContext) ?? undefined;

/** Shared look for every floating panel. */
export const floatingPanel =
  'rounded-xl border border-line bg-surface p-1.5 text-sm text-ink shadow-lift outline-none ' +
  'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';

/**
 * React delivers events from portalled content (dialogs, menus, popovers) to the component
 * that rendered it — so a click inside a dialog opened from a clickable table row or card would
 * also run that row's or card's onClick. Portal roots stop the bubbling here; handlers inside
 * the portal still run normally.
 */
export const stopPortalBubble = (e: { stopPropagation: () => void }) => e.stopPropagation();
