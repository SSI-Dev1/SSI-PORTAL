// Super Admin correction of a contact status that may not normally go backwards
// (Connected → anything, Not connected → Not recorded). Shows the current value, needs a reason,
// and the server records the previous and new values (0048).
import { useState } from 'react';
import { Alert, Badge, Button, Field, Modal, Segmented, Textarea } from './ui';
import { CONTACT, type ContactStatus } from '../lib/agencies';

export function ContactCorrection({ name, current, onClose, onSave }: {
  name: string; current: ContactStatus; onClose: () => void; onSave: (to: ContactStatus, reason: string) => Promise<boolean>;
}) {
  const options = (['unknown', 'not_connected', 'connected'] as ContactStatus[]).filter((v) => v !== current);
  const [to, setTo] = useState<ContactStatus>(options[0]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    const ok = await onSave(to, reason.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Correct contact status" subtitle={name} dirty={!!reason.trim()}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void save()}>Confirm correction</Button></>}>
      <p className="text-sm">Current status: <Badge tone={CONTACT[current].tone} dot>{CONTACT[current].label}</Badge></p>
      <Field label="Change to" className="mt-3"><Segmented options={options.map((v) => ({ value: v, label: CONTACT[v].label }))} value={to} onChange={(v) => setTo(v as ContactStatus)} /></Field>
      <Field label="Reason" required className="mt-3"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus /></Field>
      <Alert tone="warning" className="mt-3">Corrections are for mistakes only. The previous and new values and your reason are kept in the history; a reversed connection is no longer counted in reports.</Alert>
    </Modal>
  );
}
