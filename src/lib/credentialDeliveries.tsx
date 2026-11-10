// Login-credential emails: the "Email login details" option on account forms, the delivery status
// shown next to each account, and "Resend login access". The browser never sees a password here:
// emails are built and sent by the account functions on the server, and resending issues a new
// temporary password there.
import { useCallback, useEffect, useState } from 'react';
import { MailCheck, MailQuestion, MailWarning, Mail, Send } from 'lucide-react';
import { supabase } from '../auth/auth';
import { Alert, Badge, Checkbox, Tooltip } from '../components/ui';
import { useConfirm, useToast } from '../components/feedback';

export type DeliveryStatus = 'pending' | 'accepted' | 'delivered' | 'failed';
export interface Delivery {
  id: string | null;
  status: DeliveryStatus;
  detail: string | null;
  expiresAt?: string;
}
export interface DeliveryRow extends Delivery {
  userId: string;
  kind: 'initial' | 'resend';
  createdAt: string;
}

const LABEL: Record<DeliveryStatus, string> = {
  pending: 'Email pending',
  accepted: 'Accepted by provider',
  delivered: 'Email delivered',
  failed: 'Email failed',
};
const TONE: Record<DeliveryStatus, 'amber' | 'blue' | 'green' | 'red'> = { pending: 'amber', accepted: 'blue', delivered: 'green', failed: 'red' };

/** Latest credentials email per account, for the accounts this user may manage (RLS), kept live. */
export function useCredentialDeliveries(refreshKey?: unknown) {
  const [map, setMap] = useState<Record<string, DeliveryRow>>({});
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('account_credential_deliveries')
      .select('id, user_id, kind, status, detail, temp_expires_at, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) return; // migration not applied yet: no status shown
    const next: Record<string, DeliveryRow> = {};
    for (const r of data ?? []) {
      const id = r.user_id as string;
      if (!next[id]) next[id] = { id: r.id as string, userId: id, kind: r.kind as DeliveryRow['kind'], status: r.status as DeliveryStatus, detail: (r.detail as string | null) ?? null, expiresAt: (r.temp_expires_at as string | null) ?? undefined, createdAt: r.created_at as string };
    }
    setMap(next);
  }, []);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const sb = supabase;
    const ch = sb.channel(`credential-deliveries-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_credential_deliveries' }, () => void load())
      .subscribe();
    return () => void sb.removeChannel(ch);
  }, [load, refreshKey]);
  return { deliveries: map, reloadDeliveries: load };
}

/** "Account created — …" status next to an account. Delivered only after Brevo confirms it. */
export function DeliveryBadge({ row }: { row?: DeliveryRow | Delivery | null }) {
  if (!row) return null;
  const Icon = row.status === 'delivered' ? MailCheck : row.status === 'failed' ? MailWarning : row.status === 'accepted' ? Mail : MailQuestion;
  const tip = row.status === 'accepted'
    ? 'Brevo accepted the email. It is shown as delivered once Brevo confirms delivery.'
    : row.status === 'failed' ? `Not delivered${row.detail ? `: ${row.detail}` : ''}. Use “Resend login access” to send new login details.`
    : row.status === 'pending' ? 'The email is being sent.' : 'The login email reached the recipient’s mail server.';
  return (
    <Tooltip content={tip}>
      <span className="inline-flex"><Badge tone={TONE[row.status]}><Icon className="h-3 w-3" aria-hidden /> {LABEL[row.status]}</Badge></span>
    </Tooltip>
  );
}

/** The form option: on by default; the password then becomes temporary and must be changed. */
export function SendCredentialsOption({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-2">
      <Checkbox
        checked={checked}
        onCheckedChange={onChange}
        label="Email the login details to this user"
        description="Sends a welcome email with the login email, this temporary password and the portal link."
      />
      {checked && (
        <Alert tone="info">
          This password is <b>temporary</b> and will be sent to the registered email address. It expires after a few days and the user must
          create their own password at first sign-in. It is not stored and will not be shown again.
        </Alert>
      )}
    </div>
  );
}

/** Message for the account creator after creating an account. */
export function deliveryMessage(d: Delivery | null | undefined): { tone: 'success' | 'warning'; title: string; detail: string } {
  if (!d) return { tone: 'success', title: 'Account created', detail: 'No email was sent.' };
  if (d.status === 'failed')
    return { tone: 'warning', title: 'Account created — Email failed', detail: `${d.detail ?? 'The email could not be sent'}. Use “Resend login access” to send new login details.` };
  return { tone: 'success', title: 'Account created — Email accepted by provider', detail: 'Delivery status updates in the account list once Brevo reports it.' };
}

/** Confirms and runs "Resend login access" (a new temporary password; the old one stops working). */
export function useResendLoginAccess(send: (userId: string) => Promise<{ delivery?: Delivery | null }>, after?: () => void) {
  const confirm = useConfirm();
  const toast = useToast();
  return async (u: { id: string; name: string; email: string }) => {
    const ok = await confirm({
      title: 'Resend login access?',
      message: `${u.name}${u.email ? ` (${u.email})` : ''} will get an email with a new temporary password. Their current password stops working, they are signed out everywhere, and they must set their own password at the next sign-in.`,
      confirmLabel: 'Send new login details',
    });
    if (!ok) return;
    try {
      const r = await send(u.id);
      const d = r.delivery;
      if (d?.status === 'failed') toast.error('Login email failed', `${d.detail ?? 'The email could not be sent'}. The new password was not shared; try again later.`);
      else toast.success('Login access sent', 'Email accepted by provider. The status updates when delivery is confirmed.');
    } catch (e) {
      toast.error('Could not resend login access', e instanceof Error ? e.message : undefined);
    }
    after?.();
  };
}

export const ResendIcon = Send;
