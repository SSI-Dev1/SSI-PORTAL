// node --test scripts/roles.test.ts — which HR Portal / Employee Workspace pages each account may open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenPath } from '../src/auth/roles.ts';

const base = { role: 'staff' as const, partnerModules: [] as string[] };
const hr = { ...base, userRole: 'support_staff' as const, permissions: ['hr', 'hr_accounts', 'tasks'], employee: true, hasTeam: false };
const accountsOnly = { ...base, userRole: 'support_staff' as const, permissions: ['hr_accounts', 'tasks'], employee: true, hasTeam: false };
const manager = { ...base, userRole: 'application_manager' as const, permissions: ['tasks'], employee: true, hasTeam: true };
const employee = { ...base, userRole: 'support_staff' as const, permissions: ['tasks'], employee: true, hasTeam: false };
const partner = { role: 'client' as const, userRole: 'partner_staff' as const, permissions: [], partnerModules: ['students'] };

test('HR opens every HR page', () => {
  for (const p of ['hr/dashboard', 'hr/employees', 'hr/departments', 'hr/exceptions', 'hr/leave-calendar', 'hr/workforce-calendar', 'hr/work', 'hr/assets', 'hr/documents', 'hr/management']) {
    assert.equal(canOpenPath(hr, p), true, p);
  }
});

test('hr_accounts without HR: only employees, departments and designations', () => {
  for (const p of ['hr/employees', 'hr/departments', 'hr/designations']) assert.equal(canOpenPath(accountsOnly, p), true, p);
  for (const p of ['hr/dashboard', 'hr/documents', 'hr/assets', 'hr/exceptions', 'hr/work', 'hr/management']) assert.equal(canOpenPath(accountsOnly, p), false, p);
});

test('managers get team pages, not HR', () => {
  assert.equal(canOpenPath(manager, 'work/assignments'), true);
  assert.equal(canOpenPath(manager, 'work/team'), true);
  assert.equal(canOpenPath(manager, 'hr/documents'), false);
  assert.equal(canOpenPath(manager, 'hr/employees'), false);
});

test('employees: own workspace only', () => {
  assert.equal(canOpenPath(employee, 'work/assigned'), true);
  assert.equal(canOpenPath(employee, 'work/profile'), true);
  assert.equal(canOpenPath(employee, 'work/documents'), true);
  assert.equal(canOpenPath(employee, 'work/team-members'), true);
  assert.equal(canOpenPath(employee, 'work/assignments'), false);
  assert.equal(canOpenPath(employee, 'hr/dashboard'), false);
  assert.equal(canOpenPath(employee, 'hr/documents'), false);
});

test('partner users never open internal HR or workspace pages', () => {
  for (const p of ['hr/dashboard', 'hr/documents', 'hr/employees', 'work/documents', 'work/team-members', 'work/profile']) assert.equal(canOpenPath(partner, p), false, p);
});

test('commission pages', () => {
  const viewer = { ...base, userRole: 'support_staff' as const, permissions: ['partners', 'commission_view'], employee: true, hasTeam: false };
  assert.equal(canOpenPath(viewer, 'commissions'), true);
  assert.equal(canOpenPath(employee, 'commissions'), false, 'no commission permission → no page');
  const pAdmin = { role: 'client' as const, userRole: 'partner_admin' as const, permissions: [], partnerModules: ['students', 'finance'], commission: true };
  const pAdminHidden = { ...pAdmin, commission: false };
  const pStaff = { role: 'client' as const, userRole: 'partner_staff' as const, permissions: [], partnerModules: ['students', 'finance'], partnerPermissions: ['students.view'], commission: false };
  assert.equal(canOpenPath(pAdmin, 'commission'), true, 'Partner Admin sees Commission');
  assert.equal(canOpenPath(pAdminHidden, 'commission'), false, 'not when SSI hides commission for the organisation');
  assert.equal(canOpenPath(pStaff, 'commission'), false, 'partner employees never see Commission');
  assert.equal(canOpenPath(pAdmin, 'commissions'), false, 'partners never open Commission Management');
});

test('partner registrations: Super Admin and Admin Staff with the permission only', () => {
  const superAdmin = { role: 'admin' as const, userRole: 'super_admin' as const, permissions: ['partners', 'partner_onboarding'], partnerModules: [] };
  const adminWith = { role: 'admin' as const, userRole: 'admin_staff' as const, permissions: ['partners', 'partner_onboarding'], partnerModules: [] };
  const adminWithout = { role: 'admin' as const, userRole: 'admin_staff' as const, permissions: ['partners'], partnerModules: [] };
  const officer = { ...base, userRole: 'support_staff' as const, permissions: ['partners', 'partner_onboarding'], employee: true, hasTeam: false };
  assert.equal(canOpenPath(superAdmin, 'partners/registrations'), true);
  assert.equal(canOpenPath(adminWith, 'partners/registrations'), true);
  assert.equal(canOpenPath(adminWithout, 'partners/registrations'), false);
  assert.equal(canOpenPath(officer, 'partners/registrations'), false, 'non-admin staff never, even with the permission');
  assert.equal(canOpenPath(adminWithout, 'partners'), true, 'Clients & Branches itself is unchanged');
});
