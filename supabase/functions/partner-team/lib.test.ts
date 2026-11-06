// deno test supabase/functions/partner-team/lib.test.ts
import { cleanPartnerPermissions } from './lib.ts';

function assert(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
}

Deno.test('partner permissions are validated and normalised', () => {
  assert(JSON.stringify(cleanPartnerPermissions(['chat', 'students.view', 'chat'])) === '["chat","students.view"]', 'dedupe + sort');
  assert(cleanPartnerPermissions(['commission.view']) === null, 'commission is not a partner employee permission');
  assert(cleanPartnerPermissions(['finance']) === null, 'finance is not grantable');
  assert(cleanPartnerPermissions('students.view') === null, 'must be a list');
  assert(JSON.stringify(cleanPartnerPermissions([])) === '[]', 'empty list allowed');
});
