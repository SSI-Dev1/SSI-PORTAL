// Account security (all users) and access administration (Super Admin only).
// Every action here is authorised again by the database / edge function.
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, MailPlus, ShieldAlert, ShieldCheck, UserCog } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Table } from './ui';
import { useConfirm, useToast } from './feedback';
import { useAuth } from '../auth/AuthProvider';
import { sendPasswordReset, signOut, supabase } from '../auth/auth';
import { useStore } from '../store/store';
import type { UserRole } from '../data/types';
import { formatDateTime } from '../lib/utils';

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin_staff: 'Admin Staff',
  partner_admin: 'Partner Admin',
  partner_staff: 'Partner Staff',
};

export function AccountSecurityCard() {
  const { realSession } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <Card>
      <CardHeader title="Sign-in & security" action={<ShieldCheck className="h-5 w-5 text-ink-mute" />} />
      <div className="space-y-4 p-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={KeyRound}
            onClick={async () => {
              if (!realSession) return;
              await sendPasswordReset(realSession.email);
              toast.success('Check your inbox', 'We sent a secure link to change your password.');
            }}
          >
            Change password
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={LogOut}
            onClick={async () => {
              if (await confirm({ title: 'Sign out everywhere?', message: 'All your sessions on every device will be ended, including this one.', confirmLabel: 'Sign out all', danger: true }))
                await signOut('global');
            }}
          >
            Sign out all devices
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface ProfileRow {
  id: string;
  role: UserRole;
  partner_id: string | null;
  full_name: string | null;
  email: string | null;
  status: 'active' | 'suspended';
  created_at: string;
}

/** Super Admin: list users, change roles, suspend/reactivate, invite. */
export function UsersAccessCard() {
  const { realSession } = useAuth();
  const { db } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase!.from('profiles').select('id, role, partner_id, full_name, email, status, created_at').order('created_at');
    setRows((data as ProfileRow[]) ?? []);
  }, []);
  useEffect(() => void load(), [load]);

  const call = async (body: Record<string, unknown>, ok: string) => {
    const { error } = await supabase!.functions.invoke('admin-users', { body });
    if (error) toast.error('Action failed', 'The admin service rejected the request or is not deployed (see SECURITY.md).');
    else toast.success(ok);
    await load();
  };

  const setRole = async (r: ProfileRow, role: UserRole) => {
    const staffRole = role === 'super_admin' || role === 'admin_staff';
    if (!staffRole && !r.partner_id) return toast.error('Assign a partner first', 'Partner roles need an organisation. Re-invite the user to a partner.');
    const { error } = await supabase!.from('profiles').update({ role, partner_id: staffRole ? null : r.partner_id }).eq('id', r.id);
    if (error) toast.error('Role not changed', 'Only a Super Admin can change roles.');
    else toast.success('Role updated');
    await load();
  };

  return (
    <Card>
      <CardHeader
        title="Users & access"
        subtitle="Roles are enforced by the database. Changes are audit-logged."
        action={<Button size="sm" icon={MailPlus} onClick={() => setInviteOpen(true)}>Invite user</Button>}
      />
      <div className="mt-3">
        <Table head={['User', 'Organisation', 'Role', 'Status', '']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-5 py-3">
                <div className="font-semibold text-heading">{r.full_name || '—'}</div>
                <div className="text-xs text-ink-mute">{r.email || r.id.slice(0, 8)}</div>
              </td>
              <td className="px-5 py-3 text-ink-soft">{r.partner_id ? db.partners.find((p) => p.id === r.partner_id)?.name ?? r.partner_id : 'SSI GLOBAL'}</td>
              <td className="px-5 py-3">
                <Select value={r.role} disabled={r.id === realSession?.userId} onChange={(e) => void setRole(r, e.target.value as UserRole)} className="h-9 w-40 text-[13px]" aria-label="Role">
                  {(Object.keys(ROLE_LABEL) as UserRole[]).map((k) => (
                    <option key={k} value={k}>{ROLE_LABEL[k]}</option>
                  ))}
                </Select>
              </td>
              <td className="px-5 py-3">
                <Badge tone={r.status === 'active' ? 'green' : 'red'} dot>{r.status === 'active' ? 'Active' : 'Suspended'}</Badge>
              </td>
              <td className="px-5 py-3 text-right">
                {r.id !== realSession?.userId && (
                  <Button
                    size="sm"
                    variant={r.status === 'active' ? 'ghost' : 'secondary'}
                    icon={r.status === 'active' ? ShieldAlert : UserCog}
                    onClick={async () => {
                      const suspend = r.status === 'active';
                      if (suspend && !(await confirm({ title: 'Suspend this account?', message: 'They lose all access immediately and are signed out of every device.', confirmLabel: 'Suspend', danger: true }))) return;
                      await call({ action: suspend ? 'suspend' : 'reactivate', userId: r.id }, suspend ? 'Account suspended' : 'Account reactivated');
                    }}
                  >
                    {r.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="px-5 py-6 text-center text-sm text-ink-mute">No users visible.</p>}
      </div>
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvite={(b) => call({ action: 'invite', ...b }, 'Invitation sent')} />
    </Card>
  );
}

function InviteModal({ open, onClose, onInvite }: { open: boolean; onClose: () => void; onInvite: (b: { email: string; fullName: string; role: UserRole; partnerId: string | null }) => Promise<void> }) {
  const { db } = useStore();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('partner_admin');
  const [partnerId, setPartnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const partnerRole = role === 'partner_admin' || role === 'partner_staff';
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email) || fullName.trim().length < 2) return toast.error('Enter a name and a valid email');
    if (partnerRole && !partnerId) return toast.error('Choose the partner organisation');
    setBusy(true);
    await onInvite({ email: email.trim().toLowerCase(), fullName: fullName.trim(), role, partnerId: partnerRole ? partnerId : null });
    setBusy(false);
    setEmail('');
    setFullName('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Invite user" subtitle="They receive an email link to set their own password." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Send invitation</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
          </Select>
        </Field>
        {partnerRole && (
          <Field label="Partner organisation" required>
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Select…</option>
              {db.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  partner_id: string | null;
  changes: { fields?: string[]; status?: [string, string]; role?: [string, string] } | null;
}

/** Super Admin: recent audit events (no personal data is stored in the log). */
export function AuditLogCard() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    let q = supabase!.from('audit_log').select('*').order('at', { ascending: false }).limit(100);
    if (filter) q = q.eq('action', filter);
    void q.then(({ data }) => setRows((data as AuditRow[]) ?? []));
  }, [filter]);
  return (
    <Card>
      <CardHeader
        title="Audit log"
        subtitle="Last 100 events. Failed sign-ins are in Supabase → Authentication → Logs."
        action={
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 w-40 text-[13px]" aria-label="Filter events">
            <option value="">All events</option>
            {['login', 'logout', 'idle_timeout', 'password_changed', 'document_download', 'insert', 'update', 'delete'].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        }
      />
      <div className="mt-3 max-h-[420px] overflow-y-auto">
        <Table head={['When', 'Actor', 'Event', 'Record', 'Details']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-5 py-2.5 text-xs text-ink-soft">{formatDateTime(r.at)}</td>
              <td className="px-5 py-2.5 text-xs">
                <div className="font-mono text-heading">{r.actor_id?.slice(0, 8) ?? 'system'}</div>
                <div className="text-ink-mute">{r.actor_role ?? ''}</div>
              </td>
              <td className="px-5 py-2.5"><Badge tone={r.action === 'delete' ? 'red' : r.action.startsWith('login') ? 'blue' : 'slate'}>{r.action}</Badge></td>
              <td className="px-5 py-2.5 text-xs text-ink-soft">{r.entity ?? '—'} {r.entity_id ? <span className="font-mono">{r.entity_id.slice(0, 8)}</span> : null}</td>
              <td className="px-5 py-2.5 text-xs text-ink-soft">
                {r.changes?.status ? `status: ${r.changes.status[0]} → ${r.changes.status[1]}` : r.changes?.role ? `role: ${r.changes.role[0]} → ${r.changes.role[1]}` : r.changes?.fields?.join(', ') ?? ''}
              </td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="px-5 py-6 text-center text-sm text-ink-mute">No events.</p>}
      </div>
    </Card>
  );
}

