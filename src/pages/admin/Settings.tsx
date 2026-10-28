import { useState } from 'react';
import { Bell, Building2, Database, Palette, RotateCcw, ShieldCheck, SunMoon, User } from 'lucide-react';
import { ThemeSegmented } from '../../components/ThemeSwitcher';
import { Avatar, Button, Card, CardHeader, Field, Input, PageHeader } from '../../components/ui';
import { LogoMark } from '../../components/brand';
import { useConfirm, useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { cn } from '../../lib/utils';

const BRAND = [
  ['Primary navy', '#06242F'],
  ['Primary orange', '#FBA51E'],
  ['Secondary orange', '#B94A12'],
  ['White', '#FFFFFF'],
];

export default function Settings() {
  const { session, actions } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(session?.name ?? '');
  const [email, setEmail] = useState(session?.email ?? '');
  const [prefs, setPrefs] = useState({ statusEmails: true, weeklyDigest: true, partnerSignups: false, smsAlerts: false });

  return (
    <>
      <PageHeader title="Settings" subtitle="Organisation, profile and prototype preferences." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" subtitle="Your Super Admin account" action={<User className="h-5 w-5 text-ink-mute" />} />
            <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <Avatar name={name || 'A'} size={56} />
              <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button
                onClick={() => {
                  if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) return toast.error('Enter a valid name and email');
                  actions.login({ ...session!, name: name.trim(), email }, true);
                  toast.success('Profile saved');
                }}
              >
                Save profile
              </Button>
            </div>
          </Card>
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
          <Card>
            <CardHeader title="Security" action={<ShieldCheck className="h-5 w-5 text-ink-mute" />} />
            <p className="p-5 text-sm leading-relaxed text-ink-soft">
              With Supabase configured, sign-in and roles come from Supabase Auth and the profiles table (row-level security). Without it, built-in prototype accounts are used and CRM data stays in this browser — see README before going live.
            </p>
          </Card>
          <Card>
            <CardHeader title="Demo data" action={<Database className="h-5 w-5 text-ink-mute" />} />
            <div className="p-5">
              <p className="mb-4 text-sm text-ink-soft">Data is saved in this browser. Reset to restore the original sample records before a presentation.</p>
              <Button
                variant="secondary"
                icon={RotateCcw}
                className="w-full"
                onClick={async () => {
                  if (await confirm({ title: 'Reset demo data?', message: 'All changes made in this browser will be replaced with the original sample data.', confirmLabel: 'Reset data', danger: true })) {
                    actions.resetDemo();
                    toast.success('Demo data restored');
                  }
                }}
              >
                Reset demo data
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-rust' : 'bg-slate-200')}
    >
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}
