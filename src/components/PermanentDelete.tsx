// Super Admin permanent deletion (0053). The server decides everything: who may delete (Super Admin,
// recently signed in), what each record takes with it, what blocks it, and the confirmation phrase.
// This dialog only shows the server's dry run, offers an export of the selection, and sends the
// typed confirmation. Deactivate / archive are separate actions and stay where they are.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Download, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Input, Modal } from './ui';
import { useToast } from './feedback';
import { useAuth } from '../auth/AuthProvider';
import { rpc } from '../lib/agencies';

export type DeleteKind = 'agency' | 'linkedin' | 'partner' | 'partner_user' | 'branch';
const TYPE_LABEL: Record<DeleteKind, string> = {
  agency: 'Agency record', linkedin: 'LinkedIn prospect', partner: 'Client / partner organisation', partner_user: 'Partner login account', branch: 'Branch',
};

interface PreviewItem {
  id: string; exists: boolean; name?: string; reference?: string; eligible: boolean; affected?: number;
  related?: Record<string, number>; kept?: Record<string, number>; blockers: string[];
}
interface Preview { kind: DeleteKind; items: PreviewItem[]; count: number; eligible: number; confirm: string }
interface Result { deleted: { id: string; name: string }[]; skipped: { id: string; name: string; reasons: string[] }[]; repeated?: boolean }

/** True for the account that may see permanent-delete controls (the server checks again). */
export function useCanPermanentlyDelete() {
  const { realSession } = useAuth();
  return realSession?.userRole === 'super_admin';
}

export function PermanentDeleteDialog({ kind, ids, onClose, onDeleted }: {
  kind: DeleteKind; ids: string[]; onClose: () => void; onDeleted?: (deletedIds: string[]) => void | Promise<void>;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [logins, setLogins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [request] = useState(() => crypto.randomUUID());
  const key = ids.join('|');

  useEffect(() => {
    let alive = true;
    setPreview(null); setError(''); setTyped('');
    void rpc<Preview>('deletion_preview', { p_kind: kind, p_ids: ids }).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data); else setError(r.error);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key]);

  const loginCount = useMemo(() => (preview?.items ?? []).reduce((s, i) => s + (i.related?.['Partner logins (deleted only if included)'] ?? 0), 0), [preview]);
  const affected = useMemo(() => (preview?.items ?? []).filter((i) => i.eligible).reduce((s, i) => s + (i.affected ?? 1), 0)
    + (logins ? loginCount : 0), [preview, logins, loginCount]);
  const blocked = (preview?.items ?? []).filter((i) => !i.eligible);
  const ready = !!preview && preview.eligible > 0 && typed.trim() === preview.confirm.trim() && !busy;

  // Export of exactly what was selected (the server's dry run), before anything is deleted.
  const exportSelection = () => {
    if (!preview) return;
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), type: kind, records: preview.items }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ssi-global-${kind}-deletion-preview-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const run = async () => {
    if (!ready || !preview) return;
    setBusy(true); setError('');
    const r = await rpc<Result>('delete_records', { p_kind: kind, p_ids: ids, p_confirm: typed.trim(), p_include_logins: logins, p_request: request });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const n = r.data.deleted?.length ?? 0;
    const skipped = r.data.skipped ?? [];
    if (n) toast.success(`${n} record${n === 1 ? '' : 's'} permanently deleted`, skipped.length ? `${skipped.length} skipped: ${skipped.map((s) => s.name).join(', ')}` : 'The deletion is recorded in the audit log.');
    else toast.error('Nothing was deleted', skipped.map((s) => `${s.name}: ${s.reasons.join(' ')}`).join(' · ') || undefined);
    await onDeleted?.((r.data.deleted ?? []).map((d) => d.id));
    onClose();
  };

  const single = ids.length === 1;
  return (
    <Modal open onClose={onClose} size="lg" title="Permanently Delete Record?"
      subtitle="This action will permanently remove the selected record from SSI GLOBAL. Deleted information may not be recoverable."
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" icon={Trash2} disabled={!ready} loading={busy} onClick={() => void run()}>Delete Permanently</Button>
      </>}>
      {!preview && !error && <div className="flex items-center gap-2 py-8 text-sm text-ink-soft" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking linked records…</div>}
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {preview && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Record type" value={TYPE_LABEL[kind]} />
            <Stat label={single ? 'Record' : 'Selected records'} value={single ? (preview.items[0]?.name ?? '—') : `${preview.count} selected`} />
            <Stat label="Records affected" value={`${affected}`} hint={`${preview.eligible} can be deleted${blocked.length ? ` · ${blocked.length} blocked` : ''}`} />
          </div>

          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="Deletion impact">
            {preview.items.map((it) => (
              <li key={it.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-heading">{it.name ?? it.id}</span>
                  {it.reference && <span className="text-xs text-ink-mute">{it.reference}</span>}
                  <span className="ml-auto">{it.eligible ? <Badge tone="red">Will be deleted</Badge> : <Badge tone="amber"><Ban className="mr-1 inline h-3 w-3" />Blocked</Badge>}</span>
                </div>
                {it.blockers.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[13px] text-amber-700 dark:text-amber-300">
                    {it.blockers.map((b) => <li key={b} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{b}</li>)}
                  </ul>
                )}
                {it.eligible && <Counts title="Deleted with it" values={it.related} />}
                <Counts title="Kept" values={it.kept} muted />
              </li>
            ))}
          </ul>

          {kind === 'partner' && loginCount > 0 && (
            <Checkbox checked={logins} onCheckedChange={setLogins}
              label={`Also delete the ${loginCount} partner login${loginCount === 1 ? '' : 's'} of ${single ? 'this client' : 'these clients'} (they can no longer sign in)`} />
          )}

          {preview.eligible > 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-500/30 dark:bg-red-500/10">
              <label className="block text-sm text-heading" htmlFor="perm-delete-confirm">
                <ShieldAlert className="mr-1 inline h-4 w-4 text-red-600" />
                To confirm, type <b className="select-all font-mono">{preview.confirm}</b>
              </label>
              <Input id="perm-delete-confirm" className="mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
              <p className="mt-2 text-xs text-ink-mute">Only Super Admins signed in within the last 12 hours can delete. Every deletion is kept in the audit log. Submitted Daily Work Reports are never changed.</p>
            </div>
          ) : (
            <Alert tone="warning" title="Nothing here can be deleted">Resolve the blocked items above first, or use Deactivate / Archive to keep the records but remove access.</Alert>
          )}

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" icon={Download} onClick={exportSelection}>Export selection (JSON)</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-canvas/50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-1 truncate font-semibold text-heading" title={value}>{value}</div>
      {hint && <div className="text-xs text-ink-mute">{hint}</div>}
    </div>
  );
}

function Counts({ title, values, muted }: { title: string; values?: Record<string, number>; muted?: boolean }) {
  const rows = Object.entries(values ?? {}).filter(([, n]) => n > 0);
  if (!rows.length) return null;
  return (
    <div className={muted ? 'mt-2 text-xs text-ink-mute' : 'mt-2 text-xs text-ink-soft'}>
      <span className="font-semibold">{title}: </span>
      {rows.map(([k, n]) => `${k} ${n}`).join(' · ')}
    </div>
  );
}
