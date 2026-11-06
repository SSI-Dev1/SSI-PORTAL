// Supabase Edge Function: Partner Company Admins (and team managers they appoint) manage their
// own organisation's employee accounts from the Partner Portal.
//
// Every request is authorised twice: the caller's token must be valid, and the database decides
// with the caller's own identity (public.partner_team_authorize) whether this action, target
// account and permission set are allowed. The organisation always comes from that answer, never
// from the request body. Only then does the function write with the service-role key.
//
// * Accounts are always role partner_staff in the caller's organisation (never Partner Admin or
//   SSI GLOBAL accounts). Permissions come from the fixed partner catalogue and can never exceed
//   the modules SSI GLOBAL enabled for the organisation; commission and finance are not grantable.
// * Passwords go straight to Supabase Auth (bcrypt) and are never stored, logged, emailed or
//   returned. Nobody can read an existing password; a reset sets a new one and signs the
//   employee out everywhere. Suspending blocks sign-in and revokes current sessions.
//
// Deploy:  supabase functions deploy partner-team --project-ref <ref>
// Secrets: the same ALLOWED_ORIGINS as admin-users.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { cleanEmail, cleanName, cleanOptional, passwordProblems, STATUSES, UUID_RE } from '../admin-users/lib.ts';
import { cleanPartnerPermissions } from './lib.ts';

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

function checkPassword(pw: unknown, email: string) {
  const problems = passwordProblems(pw, email);
  if (problems.length) throw bad(`Password must have ${problems.join(', ')}.`);
  return pw as string;
}

/** Asks the database, as the caller, whether this action is allowed; returns the caller's organisation. */
async function authorize(asCaller: SupabaseClient, action: string, target: string | null, permissions: string[] | null) {
  const { data, error } = await asCaller.rpc('partner_team_authorize', { p_action: action, p_target: target, p_permissions: permissions });
  if (error || typeof data !== 'string') {
    const m = error?.message ?? '';
    const text = m.replace(/^TEAM_(DENIED|INVALID):\s*/, '');
    if (m.startsWith('TEAM_INVALID')) throw bad(text || 'Invalid request');
    throw new Fail(403, m.startsWith('TEAM_DENIED') ? text : 'You cannot manage this account.');
  }
  return data;
}

function contact(b: Record<string, unknown>) {
  const phone = cleanOptional(b.phone, 40);
  const department = cleanOptional(b.department);
  const designation = cleanOptional(b.designation);
  if (phone === undefined || department === undefined || designation === undefined) throw bad('Phone, department or designation is too long.');
  return { phone, department, designation };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin);
  if (ALLOWED_ORIGINS.length && (!origin || !ALLOWED_ORIGINS.includes(origin))) return json(403, { error: 'Forbidden' }, origin);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Unauthorized' }, origin);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser(token);
  if (whoErr || !who.user) return json(401, { error: 'Unauthorized' }, origin);
  const me = who.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request' }, origin);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const audit = (action: string, entityId: string, partnerId: string, changes: unknown = null) =>
    admin.from('audit_log').insert({ actor_id: me, actor_role: 'partner_team', action, entity: 'profiles', entity_id: entityId, partner_id: partnerId, changes });
  const activity = (partnerId: string, title: string, detail: string | null, refId: string) =>
    admin.from('activities').insert({ partner_id: partnerId, kind: 'account', title, detail, ref_id: refId, actor_id: me });
  const targetId = () => {
    const id = String(body.userId ?? '');
    if (!UUID_RE.test(id)) throw bad();
    return id;
  };

  try {
    switch (body.action) {
      case 'create_member': {
        const email = cleanEmail(body.email);
        const fullName = cleanName(body.fullName);
        const permissions = cleanPartnerPermissions(body.permissions);
        const status = body.status === undefined ? 'active' : String(body.status);
        if (!email || !fullName || !permissions || !(STATUSES as readonly string[]).includes(status)) throw bad('Check the name, email, status and permissions.');
        const partnerId = await authorize(asCaller, 'create', null, permissions);
        const extra = contact(body);
        const password = checkPassword(body.password, email);
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).ilike('email', email);
        if (count) throw new Fail(409, 'An account with this email already exists.');
        const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
        if (error || !created.user) {
          const code = (error as { code?: string } | null)?.code;
          if (code === 'email_exists' || /already (been )?registered|exists/i.test(error?.message ?? '')) throw new Fail(409, 'An account with this email already exists.');
          if (code === 'weak_password') throw bad('The password does not meet the security policy.');
          throw new Fail(500, 'Could not create the account.');
        }
        const id = created.user.id;
        const { error: profErr } = await admin.from('profiles').insert({
          id, role: 'partner_staff', partner_id: partnerId, full_name: fullName, email, status, ...extra,
          partner_permissions: permissions, must_change_password: body.mustChangePassword === true, created_by: me,
        });
        if (profErr) {
          await admin.auth.admin.deleteUser(id);
          throw new Fail(500, 'Could not create the account.');
        }
        if (status !== 'active') await admin.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
        await audit('account_created', id, partnerId, { role: [null, 'partner_staff'], permissions });
        await activity(partnerId, 'Team member added', fullName, id);
        return json(200, { ok: true, userId: id }, origin);
      }

      case 'update_member': {
        const id = targetId();
        const permissions = body.permissions === undefined ? null : cleanPartnerPermissions(body.permissions);
        if (body.permissions !== undefined && !permissions) throw bad('Unknown permission.');
        const partnerId = await authorize(asCaller, 'update', id, permissions);
        const patch: Record<string, unknown> = {};
        if (body.fullName !== undefined) {
          const n = cleanName(body.fullName);
          if (!n) throw bad('Enter a full name.');
          patch.full_name = n;
        }
        for (const k of ['phone', 'department', 'designation'] as const) {
          if (body[k] === undefined) continue;
          const v = cleanOptional(body[k], k === 'phone' ? 40 : 80);
          if (v === undefined) throw bad(`The ${k} is too long.`);
          patch[k] = v;
        }
        if (permissions) patch.partner_permissions = permissions;
        if (body.mustChangePassword !== undefined) patch.must_change_password = body.mustChangePassword === true;
        if (!Object.keys(patch).length) return json(200, { ok: true }, origin);
        const { data: before } = await admin.from('profiles').select('partner_permissions').eq('id', id).single();
        const { error } = await admin.from('profiles').update(patch).eq('id', id).eq('partner_id', partnerId);
        if (error) throw new Fail(500, 'Could not update the account.');
        if (patch.full_name) await admin.auth.admin.updateUserById(id, { user_metadata: { full_name: patch.full_name } });
        await audit('account_updated', id, partnerId, {
          fields: Object.keys(patch),
          ...(permissions ? { permissions: [before?.partner_permissions ?? null, permissions] } : {}),
        });
        if (permissions) await activity(partnerId, 'Team permissions changed', null, id);
        return json(200, { ok: true }, origin);
      }

      case 'set_member_status': {
        const id = targetId();
        const status = String(body.status ?? '');
        if (!(STATUSES as readonly string[]).includes(status)) throw bad();
        const partnerId = await authorize(asCaller, 'status', id, null);
        const { data: t } = await admin.from('profiles').select('status').eq('id', id).single();
        if (t?.status === status) return json(200, { ok: true }, origin);
        const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: status === 'active' ? 'none' : BAN_FOREVER });
        if (banErr) throw new Fail(500, 'Could not update the sign-in status.');
        const { error } = await admin.from('profiles').update({ status }).eq('id', id).eq('partner_id', partnerId);
        if (error) throw new Fail(500, 'Could not update the account.');
        if (status !== 'active') await admin.rpc('admin_revoke_sessions', { p_user: id });
        await audit('status_changed', id, partnerId, { status: [t?.status ?? null, status] });
        await activity(partnerId, status === 'active' ? 'Team member activated' : 'Team member suspended', null, id);
        return json(200, { ok: true }, origin);
      }

      case 'reset_member_password': {
        const id = targetId();
        const partnerId = await authorize(asCaller, 'reset_password', id, null);
        const { data: t } = await admin.from('profiles').select('email').eq('id', id).single();
        const password = checkPassword(body.password, (t?.email as string | null) ?? '');
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw new Fail(500, 'Could not reset the password.');
        await admin.rpc('admin_revoke_sessions', { p_user: id });
        await admin.from('profiles').update({ must_change_password: body.mustChangePassword !== false }).eq('id', id).eq('partner_id', partnerId);
        await audit('password_reset', id, partnerId); // never the password itself
        return json(200, { ok: true }, origin);
      }

      default:
        return json(400, { error: 'Unknown action' }, origin);
    }
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.message }, origin);
    console.error('partner-team: unexpected error', e instanceof Error ? e.name : 'unknown'); // no request data
    return json(500, { error: 'Something went wrong. Please try again.' }, origin);
  }
});
