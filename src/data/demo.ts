import type { Partner, Session } from './types';

/** Session used when an admin previews a partner's Client Portal. */
export const partnerPreviewSession = (p: Partner, admin: Session): Session => ({
  role: 'client',
  partnerId: p.id,
  name: p.contactName,
  email: p.email,
  title: p.name,
  previewOf: admin,
});
