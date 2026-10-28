// Supabase Edge Function: user administration for SSI GLOBAL Super Admins.
//
// Runs server-side with the service-role key (provided by Supabase as an environment
// secret — never shipped to the browser). Every request is re-authorised here:
// the caller must be an active super_admin whose JWT is MFA-verified (aal2).
//
// Deploy:  supabase functions deploy admin-users --project-ref <ref>
// Secrets: supabase secrets set ALLOWED_ORIGINS="https://crm.example.com" SITE_URL="https://crm.example.com/"
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SITE_URL = Deno.env.get('SITE_URL') ?? '';

const ROLES = ['super_admin', 'admin_staff', 'partner_admin', 'partner_staff'] as const;
type Role = (typeof ROLES)[number];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin);
  if (ALLOWED_ORIGINS.length && (!origin || !ALLOWED_ORIGINS.includes(origin))) return json(403, { error: 'Forbidden' }, origin);

  // --- authenticate the caller (token is verified by Supabase Auth, not just decoded)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Unauthorized' }, origin);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser(token);
  if (whoErr || !who.user) return json(401, { error: 'Unauthorized' }, origin);
  if (jwtClaims(token).aal !== 'aal2') return json(403, { error: 'Two-step verification required' }, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: me } = await admin.from('profiles').select('role, status').eq('id', who.user.id).maybeSingle();
  if (!me || me.status !== 'active' || me.role !== 'super_admin') return json(403, { error: 'Forbidden' }, origin);

  // --- validate input
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request' }, origin);
  }
  const action = body.action;
  const audit = (act: string, entityId: string, changes: unknown = null) =>
    admin.from('audit_log').insert({ actor_id: who.user.id, actor_role: 'super_admin', action: act, entity: 'profiles', entity_id: entityId, changes });

  if (action === 'invite') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.fullName ?? '').trim().slice(0, 100);
    const role = String(body.role ?? '') as Role;
    const partnerId = body.partnerId ? String(body.partnerId) : null;
    if (!EMAIL_RE.test(email) || fullName.length < 2 || !ROLES.includes(role)) return json(400, { error: 'Invalid request' }, origin);
    const partnerRole = role === 'partner_admin' || role === 'partner_staff';
    if (partnerRole !== !!partnerId) return json(400, { error: 'Invalid request' }, origin);
    if (partnerId) {
      const { data: p } = await admin.from('partners').select('id').eq('id', partnerId).maybeSingle();
      if (!p) return json(400, { error: 'Invalid request' }, origin);
    }
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL ? `${SITE_URL}?recovery=1` : undefined });
    if (error || !invited.user) return json(400, { error: 'Could not invite this user' }, origin);
    const { error: pErr } = await admin.from('profiles').upsert({ id: invited.user.id, role, partner_id: partnerId, full_name: fullName, email, status: 'active' });
    if (pErr) return json(500, { error: 'Could not create profile' }, origin);
    await audit('invite', invited.user.id, { role: [null, role] });
    return json(200, { ok: true }, origin);
  }

  if (action === 'suspend' || action === 'reactivate') {
    const userId = String(body.userId ?? '');
    if (!UUID_RE.test(userId) || userId === who.user.id) return json(400, { error: 'Invalid request' }, origin);
    const suspend = action === 'suspend';
    // Ban blocks new sign-ins and token refresh; status removes data access immediately (RLS).
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: suspend ? '876000h' : 'none' });
    if (error) return json(400, { error: 'Could not update user' }, origin);
    await admin.from('profiles').update({ status: suspend ? 'suspended' : 'active' }).eq('id', userId);
    await audit(action, userId);
    return json(200, { ok: true }, origin);
  }

  return json(400, { error: 'Unknown action' }, origin);
});
