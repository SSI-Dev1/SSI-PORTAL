import type { Partner, Session } from './types';
import { partnerKeysFor } from '../auth/roles';

/** UI-only preview of a partner's portal for SSI GLOBAL staff (data access is unchanged). */
export const partnerPreviewSession = (p: Partner, staff: Session): Session => ({
  ...staff,
  role: 'client',
  partnerId: p.id,
  title: p.name,
  partnerModules: p.modules ?? [],
  // Staff see the portal as the organisation's Partner Admin would (data access is unchanged).
  partnerPermissions: partnerKeysFor(p.modules ?? []),
  previewOf: staff,
});
