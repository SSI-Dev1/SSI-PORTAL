// deno test supabase/functions/admin-users/lib.test.ts
import { cleanEmail, cleanModules, cleanPartner, cleanPermissions, isPartnerRole, isStaffRole, passwordProblems } from './lib.ts';

function assert(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
}

Deno.test('emails are normalised and validated', () => {
  assert(cleanEmail('  Asha@Example.COM ') === 'asha@example.com', 'normalise');
  assert(cleanEmail('nope') === null, 'invalid');
  assert(cleanEmail('a b@x.io') === null, 'space');
});

Deno.test('password policy', () => {
  assert(passwordProblems('Str0ng!Passw0rd').length === 0, 'strong accepted');
  assert(passwordProblems('short1!A').includes('at least 12 characters'), 'length');
  assert(passwordProblems('alllowercase1!x').includes('upper- and lower-case letters'), 'case');
  assert(passwordProblems('NoDigitsHere!!').includes('a number'), 'digit');
  assert(passwordProblems('NoSymbols12345').includes('a symbol'), 'symbol');
  assert(passwordProblems('Asha#2026Secure', 'asha@x.io').includes('not contain the email name'), 'email name');
  assert(passwordProblems('A1!' + 'x'.repeat(80)).includes('at most 72 bytes'), 'bcrypt limit');
  assert(passwordProblems(undefined).length > 0, 'missing');
});

Deno.test('roles', () => {
  assert(isStaffRole('finance_staff') && !isStaffRole('partner_admin'), 'staff');
  assert(isPartnerRole('partner_staff') && !isPartnerRole('super_admin'), 'partner');
});

Deno.test('permissions and modules', () => {
  assert(cleanPermissions(null) === null, 'null = defaults');
  assert(JSON.stringify(cleanPermissions(['finance', 'finance', 'tasks'])) === '["finance","tasks"]', 'dedupe');
  assert(cleanPermissions(['root']) === undefined, 'unknown permission');
  assert(cleanPermissions('finance') === undefined, 'not an array');
  assert(cleanModules(['students', 'course_finder'])?.length === 2, 'modules');
  assert(cleanModules(['tasks']) === undefined, 'staff module is not a partner module');
});

Deno.test('partner input', () => {
  const ok = cleanPartner({ name: 'Sunrise Overseas', code: 'sun', contactName: 'Ravi K', email: 'R@S.in', phone: '+91 98765 43210', city: 'Kochi' });
  assert(ok !== null && ok.code === 'SUN' && ok.email === 'r@s.in' && ok.branches[0] === 'Kochi', 'valid partner');
  assert(cleanPartner({ name: 'X', code: 'SUN', contactName: 'Ravi', email: 'r@s.in', phone: '+919876543210', city: 'Kochi' }) === null, 'short name');
  assert(cleanPartner({ name: 'Sunrise', code: 'S1', contactName: 'Ravi', email: 'r@s.in', phone: '+919876543210', city: 'Kochi' }) === null, 'bad code');
  assert(cleanPartner({ name: 'Sunrise', code: 'SUN', contactName: 'Ravi', email: 'r@s.in', phone: '+919876543210', city: 'Kochi', commissionRate: 90 }) === null, 'rate');
});
