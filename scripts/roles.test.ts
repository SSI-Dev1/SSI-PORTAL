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
  assert.equal(canOpenPath(employee, 'work/assignments'), false);
  assert.equal(canOpenPath(employee, 'hr/dashboard'), false);
  assert.equal(canOpenPath(employee, 'hr/documents'), false);
});

test('partner users never open internal HR or workspace pages', () => {
  for (const p of ['hr/dashboard', 'hr/documents', 'hr/employees']) assert.equal(canOpenPath(partner, p), false, p);
});
