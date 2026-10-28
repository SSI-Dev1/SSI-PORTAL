import { useEffect, useState } from 'react';
import { Building2, Globe, Mail, MapPin, Phone, ShieldCheck, SunMoon, User } from 'lucide-react';
import { ThemeSegmented } from '../../components/ThemeSwitcher';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useScoped, useStore } from '../../store/store';
import { avatarColor, formatDate, initials } from '../../lib/utils';
import { partnerStatusTone, tierTone } from '../admin/Partners';

export default function Profile() {
  const { session, actions } = useStore();
  const scoped = useScoped();
  const toast = useToast();
  const p = scoped.partner!;
  const [d, setD] = useState({ contactName: p.contactName, email: p.email, phone: p.phone, website: p.website ?? '', city: p.city });

  useEffect(() => {
    setD({ contactName: p.contactName, email: p.email, phone: p.phone, website: p.website ?? '', city: p.city });
  }, [p]);

  const save = () => {
    if (!d.contactName.trim() || !/^\S+@\S+\.\S+$/.test(d.email) || d.phone.replace(/\D/g, '').length < 8) return toast.error('Please enter a valid name, email and phone');
    actions.updatePartner(p.id, d);
    if (session) actions.login({ ...session, name: d.contactName, email: session.provider === 'supabase' ? session.email : d.email }, true);
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
              <div className="flex justify-between"><dt className="text-ink-mute">Commission</dt><dd className="font-medium text-heading">{p.commissionRate}%</dd></div>
              <div className="flex justify-between"><dt className="text-ink-mute">Students</dt><dd className="font-medium text-heading">{scoped.students.length}</dd></div>
            </dl>
          </div>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Contact details" action={<Building2 className="h-5 w-5 text-ink-mute" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Primary contact"><Input icon={User} value={d.contactName} onChange={(e) => setD({ ...d, contactName: e.target.value })} /></Field>
              <Field label="Email"><Input icon={Mail} type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
              <Field label="Phone"><Input icon={Phone} value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
              <Field label="City"><Input icon={MapPin} value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></Field>
              <Field label="Website" className="sm:col-span-2"><Input icon={Globe} value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button onClick={save}>Save changes</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Appearance" subtitle="Saved on this device" action={<SunMoon className="h-5 w-5 text-ink-mute" />} />
            <div className="p-5">
              <ThemeSegmented />
            </div>
          </Card>
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
    </>
  );
}
