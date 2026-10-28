// Floating layers (selects, menus, pickers) render in a portal. Inside a modal they
// must portal *into* the modal so its focus trap still allows them to receive focus.
import { createContext, useContext } from 'react';

export const PortalContainerContext = createContext<HTMLElement | null>(null);
export const usePortalContainer = () => useContext(PortalContainerContext) ?? undefined;

/** Shared look for every floating panel. */
export const floatingPanel =
  'rounded-xl border border-line bg-surface p-1.5 text-sm text-ink shadow-lift outline-none ' +
  'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';
