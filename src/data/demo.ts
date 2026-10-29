import type { Partner, Session } from './types';

/** UI-only preview of a partner's portal for SSI GLOBAL staff (data access is unchanged). */
export const partnerPreviewSession = (p: Partner, staff: Session): Session => ({
  ...staff,
  role: 'client',
  partnerId: p.id,
  title: p.name,
  partnerModules: p.modules ?? [],
  previewOf: staff,
});
