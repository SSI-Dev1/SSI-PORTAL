// deno test supabase/functions/admin-users/lib.test.ts
import { cleanEmail, cleanEmployee, cleanModules, cleanPartner, cleanPermissions, cleanSalary, hrPermissionProblem, isPartnerRole, isStaffRole, passwordProblems } from './lib.ts';

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

Deno.test('employee records are validated', () => {
  const ok = cleanEmployee({ employee_code: 'SSI-010', designation_id: 'partnership_officer', additional_designations: ['application_team', 'partnership_officer'],
    reporting_manager_id: '00000000-0000-0000-0000-0000000000f2', joining_date: '2026-01-05', employment_status: 'Probation', shift_id: 'standard' });
  assert(!!ok && ok.additional_designations.join() === 'application_team', 'valid record, primary designation not repeated');
  assert(cleanEmployee({ employee_code: '', designation_id: 'x' }) === null, 'employee ID required');
  assert(cleanEmployee({ employee_code: 'A1', designation_id: 'x', joining_date: '05/01/2026' }) === null, 'dates must be ISO');
  assert(cleanEmployee({ employee_code: 'A1', designation_id: 'x', employment_status: 'Fired' }) === null, 'unknown employment status');
  assert(cleanEmployee({ employee_code: 'A1', designation_id: 'x', reporting_manager_id: 'me' }) === null, 'manager must be an id');
});

Deno.test('HR cannot grant HR or finance permissions', () => {
  assert(hrPermissionProblem(['students', 'tasks'], ['tasks']) === null, 'business modules allowed');
  assert(hrPermissionProblem(['tasks', 'hr'], ['tasks']) !== null, 'adding hr refused');
  assert(hrPermissionProblem(['tasks'], ['tasks', 'hr_salary']) !== null, 'removing hr_salary refused');
  assert(hrPermissionProblem(['tasks', 'finance'], ['tasks']) !== null, 'adding finance refused');
  assert(cleanSalary({ amount: -1 }) === undefined && cleanSalary({ amount: 50000, currency: 'INR' })?.amount === 50000, 'salary validation');
});
