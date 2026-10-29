// Account security (all users) and the audit log (Super Admin only).
// Every action here is authorised again by the database / edge function.
import { useEffect, useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Select, Table } from './ui';
import { useConfirm, useToast } from './feedback';
import { useAuth } from '../auth/AuthProvider';
import { sendPasswordReset, signOut, supabase } from '../auth/auth';
import { formatDateTime } from '../lib/utils';


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
            {['login', 'logout', 'idle_timeout', 'password_changed', 'account_created', 'account_updated', 'password_reset', 'status_changed', 'partner_created', 'partner_deleted', 'document_download', 'insert', 'update', 'delete'].map((a) => (
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
              <td className="px-5 py-2.5"><Badge tone={r.action === 'delete' || r.action === 'partner_deleted' ? 'red' : r.action === 'password_reset' || r.action === 'status_changed' ? 'amber' : r.action.startsWith('account') || r.action === 'partner_created' ? 'green' : r.action.startsWith('login') ? 'blue' : 'slate'}>{r.action}</Badge></td>
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

