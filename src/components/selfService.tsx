// Employee self-service pieces shared by My Profile and HR's view of a profile: the profile photo
// (private staff-only storage) and personal details (contact and emergency contact). The employee
// and HR may change these; managers and colleagues never see personal details (RLS, 0028).
import { useEffect, useRef, useState } from 'react';
import { Camera, HeartPulse, Home, Mail, Pencil, Phone, Trash2 } from 'lucide-react';
import { Alert, Avatar, Button, Card, CardHeader, Field, Input, Modal, Textarea } from './ui';
import { useToast } from './feedback';
import { useHR } from '../store/hr';
import { useStore } from '../store/store';
import { supabase } from '../auth/auth';
import { PHOTO_BUCKET, checkPhoto, usePhotoUrls } from '../lib/photos';
import { serverMessage } from '../data/hr';

export interface PersonalDetails {
  personalEmail: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyRelation: string | null;
  emergencyPhone: string | null;
  updatedAt: string | null;
}

/** May the signed-in user change this employee's photo and personal details? */
export function useCanEditPersonal(employeeId: string) {
  const { session } = useStore();
  return !!session && (session.userId === employeeId || session.userRole === 'super_admin' || (session.permissions ?? []).includes('hr'));
}

/** Account contact (email, phone, photo) plus personal details, re-read when they change. */
export function usePersonal(employeeId: string) {
  const { data } = useHR();
  const [contact, setContact] = useState<{ email: string | null; phone: string | null; photoPath: string | null } | null>(null);
  const [details, setDetails] = useState<PersonalDetails | null>(null);
  const [rev, setRev] = useState(0);
  const emp = data.employees.find((e) => e.id === employeeId)?.updatedAt;
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    let alive = true;
    void sb.from('profiles').select('email, phone, photo_path').eq('id', employeeId).maybeSingle().then(({ data: p }) => {
      if (!alive) return;
      const r = p as { email: string | null; phone: string | null; photo_path?: string | null } | null;
      setContact(r ? { email: r.email, phone: r.phone, photoPath: r.photo_path ?? null } : null);
    });
    void sb.from('employee_personal_details').select('*').eq('employee_id', employeeId).maybeSingle().then(({ data: d, error }) => {
      if (!alive || error) return;
      const r = d as Record<string, string | null> | null;
      setDetails(r ? { personalEmail: r.personal_email, address: r.address, emergencyName: r.emergency_name, emergencyRelation: r.emergency_relation, emergencyPhone: r.emergency_phone, updatedAt: r.updated_at } : null);
    });
    // Live: HR edits show up for the employee (and the other way round) without a refresh.
    const ch = sb.channel(`personal-${employeeId}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_personal_details', filter: `employee_id=eq.${employeeId}` }, () => setRev((n) => n + 1))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${employeeId}` }, () => setRev((n) => n + 1))
      .subscribe();
    return () => {
      alive = false;
      void sb.removeChannel(ch);
    };
  }, [employeeId, rev, emp]);
  return { contact, details, reload: () => setRev((n) => n + 1) };
}

/** Profile photo with "Change photo" for the employee and HR. */
export function ProfilePhoto({ employeeId, name, photoPath, size = 72, onChanged }: { employeeId: string; name: string; photoPath: string | null; size?: number; onChanged: () => void }) {
  const canEdit = useCanEditPersonal(employeeId);
  const urls = usePhotoUrls([photoPath]);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    if (!supabase) return;
    setBusy(true);
    try {
      const kind = await checkPhoto(file);
      const path = `${employeeId}/${crypto.randomUUID()}.${kind.ext}`;
      const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: kind.mime, upsert: false });
      if (up.error) throw new Error('The photo was rejected by the server.');
      const { error } = await supabase.rpc('set_profile_photo', { p_emp: employeeId, p_path: path });
      if (error) {
        await supabase.storage.from(PHOTO_BUCKET).remove([path]);
        throw new Error(serverMessage(error));
      }
      if (photoPath) void supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
      toast.success('Photo updated');
      onChanged();
    } catch (e) {
      toast.error('Photo not changed', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async () => {
    if (!supabase || !photoPath) return;
    const { error } = await supabase.rpc('set_profile_photo', { p_emp: employeeId, p_path: null });
    if (error) return toast.error('Photo not removed', serverMessage(error));
    void supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
    toast.success('Photo removed');
    onChanged();
  };
  return (
    <div className="relative shrink-0">
      <Avatar name={name} size={size} src={photoPath ? urls[photoPath] : null} className="ring-4 ring-surface" />
      {canEdit && (
        <>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} aria-label="Change photo"
            className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-rust text-white shadow transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-60">
            <Camera className="h-4 w-4" />
          </button>
          {photoPath && (
            <button type="button" onClick={() => void remove()} aria-label="Remove photo"
              className="absolute -bottom-1 -left-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-surface text-ink-soft shadow transition hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </>
      )}
    </div>
  );
}

/** Contact and emergency details card (employee and HR only — RLS hides it from everyone else). */
export function PersonalDetailsCard({ employeeId, self, contact, details, onChanged }: {
  employeeId: string; self?: boolean;
  contact: { email: string | null; phone: string | null } | null;
  details: PersonalDetails | null;
  onChanged: () => void;
}) {
  const canEdit = useCanEditPersonal(employeeId);
  const [editing, setEditing] = useState(false);
  const field = (k: string, v: React.ReactNode, Icon?: typeof Mail) => (
    <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt>
      <dd className="mt-1 text-sm text-heading">{v ? <span className="inline-flex items-start gap-1.5">{Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute" />}<span className="break-words">{v}</span></span> : '—'}</dd></div>
  );
  return (
    <Card>
      <CardHeader title={canEdit ? 'Personal & contact details' : 'Contact'} subtitle={self ? 'You can keep these up to date. Only you and HR can see your personal details.' : canEdit ? 'Personal details are visible to the employee and HR only.' : undefined}
        action={canEdit ? <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button> : undefined} />
      <dl className="grid gap-x-6 gap-y-4 px-5 pb-5 sm:grid-cols-2">
        {field('Work email', contact?.email, Mail)}
        {field('Phone', contact?.phone, Phone)}
        {canEdit && field('Personal email', details?.personalEmail, Mail)}
        {canEdit && field('Address', details?.address, Home)}
        {canEdit && field('Emergency contact', details?.emergencyName ? `${details.emergencyName}${details.emergencyRelation ? ` (${details.emergencyRelation})` : ''}${details.emergencyPhone ? ` · ${details.emergencyPhone}` : ''}` : null, HeartPulse)}
      </dl>
      <PersonalDetailsModal open={editing} onClose={() => setEditing(false)} employeeId={employeeId} contact={contact} details={details} onSaved={onChanged} />
    </Card>
  );
}

const PHONE = /^[+0-9 ()-]{6,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function PersonalDetailsModal({ open, onClose, employeeId, contact, details, onSaved }: {
  open: boolean; onClose: () => void; employeeId: string;
  contact: { email: string | null; phone: string | null } | null; details: PersonalDetails | null; onSaved: () => void;
}) {
  const { call } = useHR();
  const [f, setF] = useState({ phone: '', personalEmail: '', address: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ phone: contact?.phone ?? '', personalEmail: details?.personalEmail ?? '', address: details?.address ?? '', emergencyName: details?.emergencyName ?? '', emergencyRelation: details?.emergencyRelation ?? '', emergencyPhone: details?.emergencyPhone ?? '' });
  }, [open, contact, details]);
  const errs = {
    phone: f.phone.trim() && !PHONE.test(f.phone.trim()) ? 'Use digits, spaces, + ( ) - only (6–20 characters)' : '',
    personalEmail: f.personalEmail.trim() && !EMAIL.test(f.personalEmail.trim()) ? 'Enter a valid email address' : '',
    emergencyPhone: f.emergencyPhone.trim() && !PHONE.test(f.emergencyPhone.trim()) ? 'Use digits, spaces, + ( ) - only (6–20 characters)' : '',
  };
  const bad = Object.values(errs).some(Boolean) || f.address.length > 500;
  const save = async () => {
    if (bad) return;
    setBusy(true);
    const r = await call('update_personal_details', { p_emp: employeeId, p_phone: f.phone.trim() || null, p_personal_email: f.personalEmail.trim() || null, p_address: f.address.trim() || null,
      p_emergency_name: f.emergencyName.trim() || null, p_emergency_relation: f.emergencyRelation.trim() || null, p_emergency_phone: f.emergencyPhone.trim() || null }, { success: 'Details saved' });
    setBusy(false);
    if (r.ok) { onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit personal details" subtitle="Employment details (designation, department, manager, joining date, shift) are maintained by HR."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || bad} onClick={save}>{busy ? 'Saving…' : 'Save details'}</Button></>}>
      <div className="space-y-4">
        <Alert tone="info">The work email is the sign-in address and can only be changed by an administrator.</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errs.phone || undefined}><Input type="tel" value={f.phone} maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 98765 43210" /></Field>
          <Field label="Personal email" error={errs.personalEmail || undefined}><Input type="email" value={f.personalEmail} maxLength={200} onChange={(e) => setF({ ...f, personalEmail: e.target.value })} /></Field>
        </div>
        <Field label="Address" hint={`${f.address.length}/500`}><Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Emergency contact"><Input value={f.emergencyName} maxLength={120} onChange={(e) => setF({ ...f, emergencyName: e.target.value })} placeholder="Name" /></Field>
          <Field label="Relation"><Input value={f.emergencyRelation} maxLength={60} onChange={(e) => setF({ ...f, emergencyRelation: e.target.value })} placeholder="e.g. Brother" /></Field>
          <Field label="Their phone" error={errs.emergencyPhone || undefined}><Input type="tel" value={f.emergencyPhone} maxLength={20} onChange={(e) => setF({ ...f, emergencyPhone: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
