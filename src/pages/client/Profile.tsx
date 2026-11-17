import { useEffect, useState } from 'react';
import { Building2, FileSignature, Globe, Mail, MapPin, Phone, ShieldCheck, SunMoon, User } from 'lucide-react';
import { supabase } from '../../auth/auth';
import { ThemeSegmented } from '../../components/ThemeSwitcher';
import { AccountSecurityCard } from '../../components/SecurityPanels';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useScoped, useStore } from '../../store/store';
import { avatarColor, formatDate, initials } from '../../lib/utils';
import { partnerStatusTone, tierTone } from '../admin/Partners';

export default function Profile() {
  const { session, actions } = useStore();
  const canEdit = session?.userRole === 'partner_admin' && !session.previewOf;
  const scoped = useScoped();
  const toast = useToast();
  const p = scoped.partner!;
  const [d, setD] = useState({ contactName: p.contactName, email: p.email, phone: p.phone, website: p.website ?? '', city: p.city });

  // Reset only when a different organisation is shown; background re-syncs (new objects with
  // the same data) must not discard edits in progress.
  useEffect(() => {
    setD({ contactName: p.contactName, email: p.email, phone: p.phone, website: p.website ?? '', city: p.city });
  }, [p.id]);

  const save = () => {
    if (!d.contactName.trim() || !/^\S+@\S+\.\S+$/.test(d.email) || d.phone.replace(/\D/g, '').length < 8) return toast.error('Please enter a valid name, email and phone');
    actions.updatePartner(p.id, d);
    toast.success('Profile updated', 'SSI GLOBAL will see your updated details.');
  };

  return (
    <>
      <PageHeader title="My Profile" subtitle="Your consultancy’s details shared with SSI GLOBAL." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit overflow-hidden">
          <div className="h-20 bg-gradient-to-r from-navy to-navy-500" />
          <div className="-mt-10 px-6 pb-6 text-center">
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl font-display text-2xl font-semibold text-white shadow-lift ring-4 ring-surface" style={{ background: avatarColor(p.name) }}>
              {initials(p.name)}
            </span>
            <h2 className="mt-3 font-display text-lg font-semibold text-heading">{p.name}</h2>
            <p className="text-sm text-ink-soft">Partner code {p.code}</p>
            <div className="mt-3 flex justify-center gap-1.5">
              <Badge tone={partnerStatusTone[p.status]} dot>{p.status}</Badge>
              <Badge tone={tierTone[p.tier]}>{p.tier}</Badge>
            </div>
            <dl className="mt-6 space-y-3 text-left text-sm">
              <div className="flex justify-between"><dt className="text-ink-mute">Partner since</dt><dd className="font-medium text-heading">{formatDate(p.joinedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-mute">Branches</dt><dd className="font-medium text-heading">{p.branches.join(', ')}</dd></div>
              {/* Commission: Partner Admin only, and only while SSI GLOBAL shows it (server-filtered). */}
              {session?.commission && p.commissionRate != null && (
                <div className="flex justify-between"><dt className="text-ink-mute">Commission</dt><dd className="font-medium text-heading">{p.commissionRate}%</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-ink-mute">Students</dt><dd className="font-medium text-heading">{scoped.students.length}</dd></div>
            </dl>
          </div>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Contact details" action={<Building2 className="h-5 w-5 text-ink-mute" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Primary contact"><Input icon={User} value={d.contactName} disabled={!canEdit} onChange={(e) => setD({ ...d, contactName: e.target.value })} /></Field>
              <Field label="Email"><Input icon={Mail} type="email" value={d.email} disabled={!canEdit} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
              <Field label="Phone"><Input icon={Phone} value={d.phone} disabled={!canEdit} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
              <Field label="City"><Input icon={MapPin} value={d.city} disabled={!canEdit} onChange={(e) => setD({ ...d, city: e.target.value })} /></Field>
              <Field label="Website" className="sm:col-span-2"><Input icon={Globe} value={d.website} disabled={!canEdit} onChange={(e) => setD({ ...d, website: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              {canEdit ? <Button onClick={save}>Save changes</Button> : <span className="text-xs text-ink-mute">Only your organisation’s admin can edit these details.</span>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Appearance" subtitle="Saved on this device" action={<SunMoon className="h-5 w-5 text-ink-mute" />} />
            <div className="p-5">
              <ThemeSegmented />
            </div>
          </Card>
          <AccountSecurityCard />
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><ShieldCheck className="h-5 w-5" /></span>
              <div>
                <h3 className="font-display font-semibold text-heading">Private workspace</h3>
                <p className="mt-1 text-sm text-ink-soft">Your students, applications and documents are only visible to your team and SSI GLOBAL administrators.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
      {!session?.previewOf && <PartnershipDocuments />}
    </>
  );
}

/** My Partnership Documents: the partner's own countersigned agreement (0054), through short-lived links. */
function PartnershipDocuments() {
  const [doc, setDoc] = useState<{ name: string; status: string; countersignedAt: string | null; previewUrl: string; url: string } | null | undefined>(undefined);
  useEffect(() => {
    if (!supabase) { setDoc(null); return; }
    void supabase.functions.invoke('partner-registration', { body: { action: 'my_agreement' } }).then(({ data, error }) => setDoc(error ? null : ((data as { agreement: typeof doc })?.agreement ?? null)));
  }, []);
  if (doc === undefined) return null;
  return (
    <Card className="mt-6">
      <CardHeader title="My Partnership Documents" subtitle="Documents signed between your organisation and SSI GLOBAL." />
      <div className="px-5 pb-5">
        {!doc ? <p className="text-sm text-ink-soft">No signed agreement is available here yet.</p> : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
            <FileSignature className="h-6 w-6 shrink-0 text-rust" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-heading">Partnership Agreement</div>
              <div className="text-xs text-ink-mute">Status: <Badge tone="green">Completed</Badge>{doc.countersignedAt ? ` · countersigned ${formatDate(doc.countersignedAt)}` : ''}</div>
            </div>
            <a href={doc.previewUrl} target="_blank" rel="noreferrer noopener" className="rounded-xl border border-line px-3 py-1.5 text-sm font-semibold text-heading hover:bg-canvas">View Agreement</a>
            <a href={doc.url} className="rounded-xl bg-gradient-to-r from-brand to-rust px-3 py-1.5 text-sm font-semibold text-white">Download Signed Copy</a>
          </div>
        )}
      </div>
    </Card>
  );
}
