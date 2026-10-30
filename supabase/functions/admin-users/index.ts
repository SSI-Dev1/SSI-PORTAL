// Supabase Edge Function: account administration for SSI GLOBAL Super Admins and HR.
//
// Runs server-side with the service-role key (provided by Supabase as an environment
// secret — never shipped to the browser). Every request is re-authorised here: the caller's
// own token must pass public.is_super_admin() (active, not revoked), or hold the
// "hr_accounts" permission. HR account managers can only manage employee accounts below
// Admin level, never their own account, and never grant HR or finance permissions.
//
// Accounts are created directly with an admin-chosen initial password (no invitations).
// Passwords go straight to Supabase Auth (bcrypt) and are never stored, logged, emailed or
// returned. Password resets and suspensions revoke the user's existing sessions.
//
// Deploy:  supabase functions deploy admin-users --project-ref <ref>
// Secrets: supabase secrets set ALLOWED_ORIGINS="https://crm.example.com"
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import {
  cleanEmail,
  cleanEmployee,
  cleanModules,
  cleanName,
  cleanOptional,
  cleanPartner,
  cleanPermissions,
  cleanSalary,
  HR_MANAGEABLE_ROLES,
  hrPermissionProblem,
  isPartnerRole,
  isStaffRole,
  passwordProblems,
  STATUSES,
  UUID_RE,
} from './lib.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const BAN_FOREVER = '876000h';

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

class Fail extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const bad = (m = 'Invalid request') => new Fail(400, m);

/** Creates the auth user with a confirmed email and the admin-chosen password. */
async function createAuthUser(admin: SupabaseClient, email: string, password: string, fullName: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'email_exists' || /already (been )?registered|exists/i.test(error?.message ?? '')) throw new Fail(409, 'An account with this email already exists.');
    if (code === 'weak_password') throw bad('The password does not meet the security policy.');
    throw new Fail(500, 'Could not create the account.');
  }
  return data.user.id;
}

async function emailTaken(admin: SupabaseClient, email: string) {
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).ilike('email', email);
  return (count ?? 0) > 0;
}

function checkPassword(pw: unknown, email: string) {
  const problems = passwordProblems(pw, email);
  if (problems.length) throw bad(`Password must have ${problems.join(', ')}.`);
  return pw as string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin);
  if (ALLOWED_ORIGINS.length && (!origin || !ALLOWED_ORIGINS.includes(origin))) return json(403, { error: 'Forbidden' }, origin);

  // --- authenticate the caller (token verified by Supabase Auth, then checked by the database)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Unauthorized' }, origin);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser(token);
  if (whoErr || !who.user) return json(401, { error: 'Unauthorized' }, origin);
  const { data: isSuper } = await asCaller.rpc('is_super_admin');
  const { data: hrAccounts } = isSuper === true ? { data: false } : await asCaller.rpc('staff_can', { m: 'hr_accounts' });
  const { data: salaryRights } = isSuper === true ? { data: true } : await asCaller.rpc('staff_can', { m: 'hr_salary' });
  if (isSuper !== true && hrAccounts !== true) return json(403, { error: 'Only a Super Admin or authorised HR can manage accounts.' }, origin);
  const hrMode = isSuper !== true;
  const me = who.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request' }, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const audit = (action: string, entity: string, entityId: string, partnerId: string | null, changes: unknown = null) =>
    admin.from('audit_log').insert({ actor_id: me, actor_role: hrMode ? 'hr' : 'super_admin', action, entity, entity_id: entityId, partner_id: partnerId, changes });
  // Live Activity entry (Super Admins only); actor details are stamped by the database.
  const activity = (title: string, detail: string | null, refId: string) =>
    admin.from('activities').insert({ kind: 'account', title, detail, ref_id: refId, actor_id: me });
  const contact = (b: Record<string, unknown>) => {
    const phone = cleanOptional(b.phone, 40);
    const department = cleanOptional(b.department);
    const designation = cleanOptional(b.designation);
    if (phone === undefined || department === undefined || designation === undefined) throw bad('Phone, department or designation is too long.');
    return { phone, department, designation };
  };

  const loadTarget = async (userId: unknown) => {
    const id = String(userId ?? '');
    if (!UUID_RE.test(id)) throw bad();
    const { data } = await admin.from('profiles').select('id, role, status, partner_id, email').eq('id', id).maybeSingle();
    if (!data) throw new Fail(404, 'Account not found.');
    return data as { id: string; role: string; status: string; partner_id: string | null; email: string | null };
  };
  // Never leave the system without an active Super Admin.
  const ensureAnotherSuperAdmin = async (excluding: string) => {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'super_admin').eq('status', 'active').neq('id', excluding);
    if (!count) throw bad('At least one other active Super Admin must remain.');
  };

  // HR account managers: employee accounts below Admin level only, never their own.
  const hrTarget = (t: { id: string; role: string }) => {
    if (!hrMode) return;
    if (t.id === me) throw new Fail(403, 'You cannot manage your own account.');
    if (!(HR_MANAGEABLE_ROLES as readonly string[]).includes(t.role)) throw new Fail(403, 'Only a Super Admin can manage this account.');
  };
  try {
    if (hrMode && !['create_employee', 'update_user', 'set_status', 'reset_password'].includes(String(body.action))) {
      throw new Fail(403, 'Only a Super Admin can do this.');
    }
    switch (body.action) {
      // ------------------------------------------------------------ employees
      case 'create_employee': {
        const email = cleanEmail(body.email);
        const fullName = cleanName(body.fullName);
        const role = body.role;
        const permissions = cleanPermissions(body.permissions ?? null);
        const status = body.status === undefined ? 'active' : String(body.status);
        if (!email || !fullName || !isStaffRole(role) || permissions === undefined || !(STATUSES as readonly string[]).includes(status)) throw bad();
        if (hrMode) {
          if (!(HR_MANAGEABLE_ROLES as readonly string[]).includes(role)) throw new Fail(403, 'Only a Super Admin can create Admin accounts.');
          const problem = hrPermissionProblem(permissions, null);
          if (problem) throw new Fail(403, problem);
        }
        const employee = body.employee === undefined ? null : cleanEmployee(body.employee);
        if (body.employee !== undefined && !employee) throw bad('Check the employee details (ID, designation, dates).');
        const salary = cleanSalary(body.salary);
        if (salary === undefined) throw bad('Enter a valid salary.');
        if (employee) {
          const { count: codeUsed } = await admin.from('employees').select('id', { count: 'exact', head: true }).ilike('employee_code', employee.employee_code);
          if (codeUsed) throw new Fail(409, 'This employee ID is already in use.');
          const { data: des } = await admin.from('designations').select('id').in('id', [employee.designation_id, ...employee.additional_designations]);
          if ((des ?? []).length !== 1 + employee.additional_designations.length) throw bad('Unknown designation.');
        }
        const extra = contact(body);
        const password = checkPassword(body.password, email);
        if (await emailTaken(admin, email)) throw new Fail(409, 'An account with this email already exists.');
        const id = await createAuthUser(admin, email, password, fullName);
        const { error } = await admin.from('profiles').insert({
          id, role, partner_id: null, full_name: fullName, email, status, ...extra,
          permissions: role === 'super_admin' ? null : permissions, must_change_password: body.mustChangePassword === true, created_by: me,
        });
        if (!error && status !== 'active') await admin.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
        if (error) {
          await admin.auth.admin.deleteUser(id);
          throw new Fail(500, 'Could not create the account.');
        }
        if (employee) {
          const { error: empErr } = await admin.from('employees').insert({ id, ...employee, created_by: me });
          if (empErr) {
            await admin.auth.admin.deleteUser(id);   // profile row is removed by the cascade
            throw new Fail(empErr.code === '23503' ? 400 : 500, empErr.code === '23503' ? 'Unknown department, shift or reporting manager.' : 'Could not save the employee record.');
          }
          if (salary && salaryRights === true) await admin.from('employee_salaries').insert({ employee_id: id, ...salary, updated_by: me });
        }
        await audit('account_created', 'profiles', id, null, { role: [null, role], ...(employee ? { designation: employee.designation_id } : {}) });
        await activity('Employee account created', fullName, id);
        return json(200, { ok: true, userId: id }, origin);
      }

      // ------------------------------------------------------------ partners
      case 'create_partner': {
        const partner = cleanPartner(body.partner);
        const account = (body.account ?? {}) as Record<string, unknown>;
        const email = cleanEmail(account.email);
        const fullName = cleanName(account.fullName);
        const modules = cleanModules(body.modules);
        if (!partner || !email || !fullName || !modules) throw bad();
        const password = checkPassword(account.password, email);
        const { count: codeUsed } = await admin.from('partners').select('id', { count: 'exact', head: true }).eq('code', partner.code);
        if (codeUsed) throw new Fail(409, 'This partner code is already in use.');
        if (await emailTaken(admin, email)) throw new Fail(409, 'An account with this email already exists.');

        const portalEnabled = body.portalEnabled !== false;
        const accountPhone = cleanOptional(account.phone, 40);
        if (accountPhone === undefined) throw bad();
        const { data: org, error: orgErr } = await admin
          .from('partners')
          .insert({ ...partner, status: portalEnabled ? 'Active' : 'Onboarding', portal_enabled: portalEnabled, modules })
          .select('id')
          .single();
        if (orgErr || !org) throw new Fail(500, 'Could not create the partner.');
        let userId = '';
        try {
          userId = await createAuthUser(admin, email, password, fullName);
          const { error } = await admin.from('profiles').insert({
            id: userId, role: 'partner_admin', partner_id: org.id, full_name: fullName, email, status: 'active',
            phone: accountPhone ?? partner.phone, must_change_password: account.mustChangePassword === true, created_by: me,
          });
          if (error) throw new Fail(500, 'Could not create the partner account.');
        } catch (e) {
          if (userId) await admin.auth.admin.deleteUser(userId);
          await admin.from('partners').delete().eq('id', org.id);
          throw e;
        }
        await audit('partner_created', 'partners', org.id, org.id);
        await audit('account_created', 'profiles', userId, org.id, { role: [null, 'partner_admin'] });
        await activity('Partner and login account created', partner.name, org.id);
        return json(200, { ok: true, partnerId: org.id, userId }, origin);
      }

      case 'create_partner_user': {
        const partnerId = String(body.partnerId ?? '');
        const email = cleanEmail(body.email);
        const fullName = cleanName(body.fullName);
        const role = body.role;
        if (!partnerId || !email || !fullName || !isPartnerRole(role)) throw bad();
        const password = checkPassword(body.password, email);
        const { data: org } = await admin.from('partners').select('id, archived_at').eq('id', partnerId).maybeSingle();
        if (!org || org.archived_at) throw bad('Partner not found or archived.');
        if (await emailTaken(admin, email)) throw new Fail(409, 'An account with this email already exists.');
        const id = await createAuthUser(admin, email, password, fullName);
        const { error } = await admin.from('profiles').insert({
          id, role, partner_id: partnerId, full_name: fullName, email, status: 'active',
          must_change_password: body.mustChangePassword === true, created_by: me,
        });
        if (error) {
          await admin.auth.admin.deleteUser(id);
          throw new Fail(500, 'Could not create the account.');
        }
        await audit('account_created', 'profiles', id, partnerId, { role: [null, role] });
        await activity('Partner user created', fullName, id);
        return json(200, { ok: true, userId: id }, origin);
      }

      case 'delete_partner': {
        const partnerId = String(body.partnerId ?? '');
        const { data: org } = await admin.from('partners').select('id, name').eq('id', partnerId).maybeSingle();
        if (!org) throw new Fail(404, 'Partner not found.');
        if (cleanName(body.confirmName, 1, 200) !== org.name) throw bad('Type the partner name exactly to confirm.');
        const { count: students } = await admin.from('students').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId);
        const { count: invoices } = await admin.from('payments').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId);
        if (students || invoices) throw new Fail(409, 'This partner has students or invoices. Archive it instead — records are kept and access is removed.');
        const { data: users } = await admin.from('profiles').select('id').eq('partner_id', partnerId);
        for (const u of users ?? []) await admin.auth.admin.deleteUser(u.id);
        const { error } = await admin.from('partners').delete().eq('id', partnerId);
        if (error) throw new Fail(500, 'Could not delete the partner.');
        await audit('partner_deleted', 'partners', partnerId, null);
        await activity('Partner deleted', org.name, partnerId);
        return json(200, { ok: true }, origin);
      }

      // ------------------------------------------------------------ any account
      case 'update_user': {
        const t = await loadTarget(body.userId);
        hrTarget(t);
        if (hrMode && body.role !== undefined && !(HR_MANAGEABLE_ROLES as readonly string[]).includes(String(body.role))) {
          throw new Fail(403, 'Only a Super Admin can assign Admin roles.');
        }
        const patch: Record<string, unknown> = {};
        if (body.fullName !== undefined) {
          const n = cleanName(body.fullName);
          if (!n) throw bad('Enter a full name.');
          patch.full_name = n;
        }
        if (body.role !== undefined && body.role !== t.role) {
          if (t.id === me) throw bad('You cannot change your own role.');
          const staffNow = isStaffRole(t.role);
          if (staffNow ? !isStaffRole(body.role) : !isPartnerRole(body.role)) throw bad('Employees and partner users cannot switch account type.');
          if (t.role === 'super_admin' && t.status === 'active') await ensureAnotherSuperAdmin(t.id);
          patch.role = body.role;
        }
        if (body.permissions !== undefined) {
          if (!isStaffRole(t.role)) throw bad('Partner users get their access from the partner organisation.');
          const p = cleanPermissions(body.permissions);
          if (p === undefined) throw bad('Unknown permission.');
          if (t.id === me) throw bad('You cannot change your own permissions.');
          if (hrMode) {
            const { data: cur } = await admin.from('profiles').select('permissions').eq('id', t.id).single();
            const { data: defaults } = await admin.rpc('role_default_permissions', { r: t.role });
            const problem = hrPermissionProblem(p, (cur?.permissions as string[] | null) ?? (defaults as string[] | null));
            if (problem) throw new Fail(403, problem);
          }
          patch.permissions = (patch.role ?? t.role) === 'super_admin' ? null : p;
        }
        if (body.mustChangePassword !== undefined) patch.must_change_password = body.mustChangePassword === true;
        for (const k of ['phone', 'department', 'designation'] as const) {
          if (body[k] === undefined) continue;
          const v = cleanOptional(body[k], k === 'phone' ? 40 : 80);
          if (v === undefined) throw bad(`The ${k} is too long.`);
          patch[k] = v;
        }
        if (!Object.keys(patch).length) return json(200, { ok: true }, origin);
        const { error } = await admin.from('profiles').update(patch).eq('id', t.id);
        if (error) throw new Fail(500, 'Could not update the account.');
        if (patch.full_name) await admin.auth.admin.updateUserById(t.id, { user_metadata: { full_name: patch.full_name } });
        await audit('account_updated', 'profiles', t.id, t.partner_id, {
          fields: Object.keys(patch),
          ...(patch.role ? { role: [t.role, patch.role] } : {}),
        });
        if (patch.role || patch.permissions !== undefined) await activity(patch.role ? 'Role changed' : 'Permissions changed', null, t.id);
        return json(200, { ok: true }, origin);
      }

      case 'set_status': {
        const t = await loadTarget(body.userId);
        hrTarget(t);
        const status = String(body.status ?? '');
        if (!(STATUSES as readonly string[]).includes(status)) throw bad();
        if (t.id === me) throw bad('You cannot change the status of your own account.');
        if (status === t.status) return json(200, { ok: true }, origin);
        if (t.role === 'super_admin' && status !== 'active') await ensureAnotherSuperAdmin(t.id);
        // Ban blocks new sign-ins and refreshes; the status change revokes data access and
        // existing sessions in the database immediately.
        const { error: banErr } = await admin.auth.admin.updateUserById(t.id, { ban_duration: status === 'active' ? 'none' : BAN_FOREVER });
        if (banErr) throw new Fail(500, 'Could not update the sign-in status.');
        const { error } = await admin.from('profiles').update({ status }).eq('id', t.id);
        if (error) throw new Fail(500, 'Could not update the account.');
        await audit('status_changed', 'profiles', t.id, t.partner_id, { status: [t.status, status] });
        await activity(status === 'active' ? 'Account activated' : status === 'suspended' ? 'Account suspended' : 'Account deactivated', null, t.id);
        return json(200, { ok: true }, origin);
      }

      case 'reset_password': {
        const t = await loadTarget(body.userId);
        hrTarget(t);
        if (t.id === me) throw bad('Use "Change password" for your own account.');
        const password = checkPassword(body.password, t.email ?? '');
        const { error } = await admin.auth.admin.updateUserById(t.id, { password });
        if (error) throw new Fail(500, 'Could not reset the password.');
        await admin.rpc('admin_revoke_sessions', { p_user: t.id });
        if (body.mustChangePassword !== undefined)
          await admin.from('profiles').update({ must_change_password: body.mustChangePassword === true }).eq('id', t.id);
        await audit('password_reset', 'profiles', t.id, t.partner_id); // never the password itself
        await activity('Password reset by admin', null, t.id);
        return json(200, { ok: true }, origin);
      }

      default:
        return json(400, { error: 'Unknown action' }, origin);
    }
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message }, origin);
    console.error('admin-users: unexpected error', e instanceof Error ? e.name : 'unknown'); // no request data
    return json(500, { error: 'Something went wrong. Please try again.' }, origin);
  }
});
