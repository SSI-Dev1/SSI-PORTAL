import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, Building2, Palette, SunMoon, User, UsersRound } from 'lucide-react';
import { AccountSecurityCard, AuditLogCard } from '../../components/SecurityPanels';
import { supabase } from '../../auth/auth';
import { useAuth } from '../../auth/AuthProvider';
import { ThemeSegmented } from '../../components/ThemeSwitcher';
import { Avatar, Button, Card, CardHeader, Field, Input, PageHeader, Switch } from '../../components/ui';
import { LogoMark } from '../../components/brand';
import { useToast } from '../../components/feedback';

const BRAND = [
  ['Primary navy', '#06242F'],
  ['Primary orange', '#FBA51E'],
  ['Secondary orange', '#B94A12'],
  ['White', '#FFFFFF'],
];

export default function Settings() {
  const { realSession, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(realSession?.name ?? '');
  const superAdmin = realSession?.userRole === 'super_admin';
  const [prefs, setPrefs] = useState({ statusEmails: true, weeklyDigest: true, partnerSignups: false, smsAlerts: false });

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, security and organisation preferences." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" subtitle={realSession?.title} action={<User className="h-5 w-5 text-ink-mute" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <Avatar name={name || 'A'} size={56} />
              <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Email" hint="Managed by your sign-in account."><Input type="email" value={realSession?.email ?? ''} disabled /></Field>
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button
                onClick={async () => {
                  const clean = name.trim().slice(0, 100);
                  if (clean.length < 2) return toast.error('Enter your name');
                  const { error } = await supabase!.from('profiles').update({ full_name: clean }).eq('id', realSession!.userId);
                  if (error) return toast.error('Profile not saved');
                  await refresh();
                  toast.success('Profile saved');
                }}
              >
                Save profile
              </Button>
            </div>
          </Card>
          {superAdmin && (
            <Card>
              <CardHeader title="Users & access" subtitle="Create partner and employee accounts, set passwords, roles and permissions." action={<UsersRound className="h-5 w-5 text-ink-mute" />} />
              <div className="flex flex-wrap items-center justify-between gap-3 p-5 pt-2 text-sm text-ink-soft">
                Accounts are created directly by a Super Admin — there are no invitations or self-registration.
                <Link to="/admin/users" className="inline-flex items-center gap-1.5 rounded-xl bg-rust px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                  Open User Management <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Card>
          )}
          {superAdmin && <AuditLogCard />}
          <Card>
            <CardHeader title="Organisation" action={<Building2 className="h-5 w-5 text-ink-mute" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Company"><Input defaultValue="SSI GLOBAL" /></Field>
              <Field label="Head office"><Input defaultValue="Kochi, Kerala, India" /></Field>
              <Field label="Support email"><Input defaultValue="partners@ssiglobal.com" /></Field>
              <Field label="Time zone"><Input defaultValue="Asia/Kolkata (IST)" /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Notifications" action={<Bell className="h-5 w-5 text-ink-mute" />} />
            <ul className="divide-y divide-line px-5 py-2">
              {(
                [
                  ['statusEmails', 'Application status emails', 'Notify partners when an application changes status.'],
                  ['weeklyDigest', 'Weekly digest', 'Summary of applications and deadlines every Monday.'],
                  ['partnerSignups', 'New partner sign-ups', 'Alert when a partner requests onboarding.'],
                  ['smsAlerts', 'SMS alerts', 'Critical visa updates by SMS.'],
                ] as const
              ).map(([k, t, d]) => (
                <li key={k} className="flex items-center gap-4 py-3.5">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-heading">{t}</div>
                    <div className="text-xs text-ink-mute">{d}</div>
                  </div>
                  <Toggle
                    checked={prefs[k]}
                    label={t}
                    onChange={(v) => {
                      setPrefs({ ...prefs, [k]: v });
                      toast.info(`${t} ${v ? 'enabled' : 'disabled'}`);
                    }}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Appearance" subtitle="Saved on this device" action={<SunMoon className="h-5 w-5 text-ink-mute" />} />
            <div className="p-5">
              <ThemeSegmented />
            </div>
          </Card>
          <Card>
            <CardHeader title="Brand" action={<Palette className="h-5 w-5 text-ink-mute" />} />
            <div className="p-5">
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-navy p-4">
                <LogoMark size={40} />
                <span className="font-display text-xl text-white"><b>SSI</b> <span className="font-light">GLOBAL</span></span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {BRAND.map(([n, c]) => (
                  <div key={c} className="text-center">
                    <div className="mx-auto h-11 w-11 rotate-45 rounded-xl ring-1 ring-line" style={{ background: c }} />
                    <div className="mt-2.5 text-[10px] font-semibold text-ink-soft">{c}</div>
                    <div className="text-[10px] text-ink-mute">{n}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <AccountSecurityCard />
        </div>
      </div>
    </>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Switch checked={checked} onCheckedChange={onChange} label={label} />;
}
