// Partner Portal → Team Management: the Partner Company Admin (or a team manager they appoint)
// adds and manages their own organisation's employee accounts. The list comes from the server
// (partner_team), every change goes through the partner-team function, and the database decides
// what may be granted, so nothing here can reach another organisation or raise anyone's access.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, MoreHorizontal, Pencil, RefreshCw, ShieldCheck, UserCheck, UserPlus, UserX, Users, Wand2 } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, Checkbox, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, SearchInput, Select, Table, Tooltip } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { supabase, passwordProblems } from '../../auth/auth';
import { PARTNER_PERMISSIONS, PARTNER_PRESETS, type PartnerPermission } from '../../auth/roles';
import { generatePassword } from '../../lib/adminApi';
import { loadGrantable, loadTeam, teamApi, TeamApiError, type TeamMember } from '../../lib/partnerTeamApi';
import { cn, timeAgo } from '../../lib/utils';

const statusTone = { active: 'green', suspended: 'amber', deactivated: 'slate' } as const;
const permLabel = (p: string) => PARTNER_PERMISSIONS.find((x) => x.id === p)?.label ?? p;
const errMsg = (e: unknown) => (e instanceof TeamApiError ? e.message : 'Something went wrong. Please try again.');

export default function TeamManagement() {
  const { session } = useStore();
  const toast = useToast();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [grantable, setGrantable] = useState<PartnerPermission[]>([]);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [perm, setPerm] = useState('');
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const preview = !!session?.previewOf;

  const load = useCallback(async () => {
    try {
      const [t, g] = await Promise.all([loadTeam(), loadGrantable()]);
      setTeam(t);
      setGrantable(g);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Live directory: any change to this organisation's accounts (RLS limits the events to it).
  useEffect(() => {
    if (!supabase || !session?.partnerId || preview) return;
    const sb = supabase;
    let t = 0;
    const ch = sb
      .channel(`team-${session.partnerId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `partner_id=eq.${session.partnerId}` }, () => {
        window.clearTimeout(t);
        t = window.setTimeout(() => void load(), 300);
      })
      .subscribe();
    return () => {
      window.clearTimeout(t);
      void sb.removeChannel(ch);
    };
  }, [session?.partnerId, preview, load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (team ?? []).filter((m) =>
      (!s || [m.fullName, m.email, m.designation, m.department, m.phone].some((v) => v?.toLowerCase().includes(s)))
      && (!status || m.status === status)
      && (!perm || m.effectivePermissions.includes(perm as PartnerPermission)));
  }, [team, q, status, perm]);
  const count = (st: TeamMember['status']) => (team ?? []).filter((m) => m.status === st).length;

  const setMemberStatus = async (m: TeamMember, next: 'active' | 'suspended') => {
    try {
      await teamApi.setStatus(m.id, next);
      toast.success(next === 'active' ? 'Employee activated' : 'Employee suspended', next === 'active' ? `${m.fullName} can sign in again.` : `${m.fullName} was signed out and can no longer sign in.`);
      void load();
    } catch (e) {
      toast.error('Not changed', errMsg(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Team Management"
        subtitle="Give your employees their own sign-in to your partner workspace, with only the access they need."
        actions={<Button icon={UserPlus} disabled={preview || !grantable.length} onClick={() => setEditing('new')}>Add Employee</Button>}
      />
      {preview && <Alert tone="info" className="mb-5">Preview: SSI GLOBAL staff can view this team but accounts are managed by the partner, or in User Management.</Alert>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total employees" value={team?.length ?? 0} icon={Users} tone="navy" />
        <StatCard label="Active" value={count('active')} icon={UserCheck} tone="green" delay={60} />
        <StatCard label="Suspended" value={count('suspended') + count('deactivated')} icon={UserX} tone="red" delay={120} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, email, designation…" className="lg:w-80" />
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'deactivated', label: 'Deactivated' }]} />
            <FilterSelect label="Permission" value={perm} onChange={setPerm} options={[{ value: '', label: 'Any permission' }, ...PARTNER_PERMISSIONS.map((p) => ({ value: p.id, label: p.label }))]} />
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()} aria-label="Refresh">Refresh</Button>
          </div>
        </div>
        {failed && !team ? (
          <EmptyState icon={Users} title="Your team could not be loaded" description="Check your connection and try again." action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
        ) : !team ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-canvas" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title={team.length <= 1 ? 'No employees yet' : 'No matches'} description={team.length <= 1 ? 'Add your first employee to give them their own sign-in.' : 'Try a different search or filter.'} />
        ) : (
          <Table head={['Employee', 'Designation', 'Status', 'Access', 'Last sign-in', '']}>
            {rows.map((m) => (
              <tr key={m.id} className="transition hover:bg-canvas/60">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={m.fullName} size={36} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-heading">
                        <span className="truncate">{m.fullName}</span>
                        {m.role === 'partner_admin' && <Badge tone="navy">Partner Admin</Badge>}
                        {m.role === 'partner_staff' && m.effectivePermissions.includes('team.manage') && <Badge tone="violet">Team manager</Badge>}
                        {m.id === session?.userId && <span className="text-xs font-normal text-ink-mute">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-ink-mute">{m.email}{m.phone ? ` · ${m.phone}` : ''}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm">
                  <div className="text-heading">{m.designation || '—'}</div>
                  <div className="text-xs text-ink-mute">{m.department || ''}</div>
                </td>
                <td className="px-5 py-3.5"><Badge tone={statusTone[m.status]} dot>{m.status[0].toUpperCase() + m.status.slice(1)}</Badge></td>
                <td className="px-5 py-3.5">
                  {m.role === 'partner_admin' ? <span className="text-xs text-ink-soft">Full workspace access</span> : (
                    <Tooltip content={m.effectivePermissions.map(permLabel).join(' · ') || 'No access'}>
                      <span className="inline-flex flex-wrap gap-1">
                        {m.effectivePermissions.slice(0, 3).map((p) => <Badge key={p} tone="slate">{permLabel(p)}</Badge>)}
                        {m.effectivePermissions.length > 3 && <Badge tone="slate">+{m.effectivePermissions.length - 3}</Badge>}
                        {m.effectivePermissions.length === 0 && <span className="text-xs text-ink-mute">No access</span>}
                      </span>
                    </Tooltip>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-sm text-ink-soft">{m.lastSignInAt ? timeAgo(m.lastSignInAt) : 'Never'}</td>
                <td className="px-5 py-3.5 text-right">
                  {m.manageable && !preview && (
                    <Menu
                      width="w-52"
                      trigger={() => <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line text-ink-soft hover:text-heading" aria-label={`Actions for ${m.fullName}`}><MoreHorizontal className="h-4 w-4" /></span>}
                      items={[
                        { label: 'Edit details & access', icon: Pencil, onClick: () => setEditing(m) },
                        { label: 'Reset password', icon: KeyRound, onClick: () => setResetting(m) },
                        m.status === 'active'
                          ? { label: 'Suspend account', icon: UserX, danger: true, onClick: () => void setMemberStatus(m, 'suspended') }
                          : { label: 'Activate account', icon: UserCheck, onClick: () => void setMemberStatus(m, 'active') },
                      ]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="flex items-center gap-1.5 border-t border-line px-5 py-3 text-xs text-ink-mute">
          <ShieldCheck className="h-3.5 w-3.5" /> Employees never see commission or finance. They can only use modules SSI GLOBAL has enabled for your organisation.
        </p>
      </Card>

      <MemberModal member={editing} grantable={grantable} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ResetPasswordModal member={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

// ------------------------------------------------------------------ add / edit

interface Draft {
  fullName: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  status: 'active' | 'suspended';
  permissions: PartnerPermission[];
  password: string;
  confirm: string;
  mustChange: boolean;
}
const blank: Draft = { fullName: '', email: '', phone: '', designation: '', department: '', status: 'active', permissions: [...PARTNER_PRESETS[0].permissions], password: '', confirm: '', mustChange: true };

function MemberModal({ member, grantable, onClose, onSaved }: { member: TeamMember | 'new' | null; grantable: PartnerPermission[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = member === 'new';
  const [d, setD] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!member) return;
    setError('');
    setTouched(false);
    setD(member === 'new'
      ? { ...blank, permissions: blank.permissions.filter((p) => grantable.includes(p)) }
      : { ...blank, fullName: member.fullName, email: member.email, phone: member.phone ?? '', designation: member.designation ?? '', department: member.department ?? '',
          status: member.status === 'active' ? 'active' : 'suspended', permissions: member.effectivePermissions.filter((p) => p !== 'team.manage' || grantable.includes('team.manage')) });
  }, [member, grantable]);
  if (!member) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setTouched(true);
    setD((x) => ({ ...x, [k]: v }));
  };
  const toggle = (p: PartnerPermission, on: boolean) => set('permissions', on ? [...new Set([...d.permissions, p])] : d.permissions.filter((x) => x !== p));

  const pwProblems = isNew ? passwordProblems(d.password, d.email) : [];
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim());
  const problems = [
    d.fullName.trim().length < 2 && 'Enter the full name.',
    isNew && !emailOk && 'Enter a valid email address.',
    isNew && pwProblems.length > 0 && `Password needs ${pwProblems.join(', ')}.`,
    isNew && d.password !== d.confirm && 'The passwords do not match.',
  ].filter(Boolean) as string[];

  const groups = [...new Set(PARTNER_PERMISSIONS.map((p) => p.group))];
  const save = async () => {
    setTouched(true);
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError('');
    try {
      if (isNew) {
        await teamApi.create({ ...d, fullName: d.fullName.trim(), email: d.email.trim().toLowerCase(), mustChangePassword: d.mustChange });
        toast.success('Employee created', `${d.fullName.trim()} can now sign in on the SSI GLOBAL login page with their email and the password you set.`);
      } else {
        await teamApi.update(member.id, {
          fullName: d.fullName.trim(), phone: d.phone.trim() || null, designation: d.designation.trim() || null, department: d.department.trim() || null,
          permissions: d.permissions,
        });
        toast.success('Employee updated', d.fullName.trim());
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dirty={touched}
      title={isNew ? 'Add Employee' : `Edit ${member.fullName}`}
      subtitle={isNew ? 'They sign in at the SSI GLOBAL login page and land in your partner workspace.' : member.email}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? 'Create Employee' : 'Save changes'}</Button></>}
    >
      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Full Name" required><Input value={d.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="off" /></Field>
          <Field label="Email Address" required hint={isNew ? undefined : 'The sign-in email cannot be changed here.'}>
            <Input type="email" value={d.email} disabled={!isNew} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Phone Number"><Input value={d.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Designation"><Input value={d.designation} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. Senior Counsellor" /></Field>
          <Field label="Department"><Input value={d.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. Admissions" /></Field>
          {isNew && (
            <Field label="Account Status">
              <Select value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])} aria-label="Account Status">
                <option value="active">Active — can sign in</option>
                <option value="suspended">Suspended — cannot sign in yet</option>
              </Select>
            </Field>
          )}
        </section>

        {isNew && (
          <section className="rounded-2xl border border-line bg-canvas/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-heading">Initial password</div>
                <div className="text-xs text-ink-mute">Share it privately. It is never emailed, stored or shown again.</div>
              </div>
              <Button size="sm" variant="secondary" icon={Wand2} onClick={() => { const p = generatePassword(); setTouched(true); setD((x) => ({ ...x, password: p, confirm: p })); }}>Generate secure password</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Initial Password" required><Input type="text" value={d.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" className="font-mono" /></Field>
              <Field label="Confirm Password" required error={d.confirm && d.password !== d.confirm ? 'Does not match' : undefined}>
                <Input type="text" value={d.confirm} onChange={(e) => set('confirm', e.target.value)} autoComplete="new-password" className="font-mono" />
              </Field>
            </div>
            {d.password && pwProblems.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Needs {pwProblems.join(', ')}.</p>}
            <div className="mt-3"><Checkbox checked={d.mustChange} onCheckedChange={(v) => set('mustChange', v)} label="Ask them to choose their own password at first sign-in" /></div>
          </section>
        )}

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-heading">Access Permissions</div>
              <div className="text-xs text-ink-mute">Greyed out: not enabled for your organisation by SSI GLOBAL{grantable.includes('team.manage') ? '' : ', or only your Partner Admin can grant it'}.</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PARTNER_PRESETS.map((p) => (
                <Button key={p.id} size="sm" variant="secondary" onClick={() => set('permissions', p.permissions.filter((x) => grantable.includes(x)))}>{p.label}</Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g} className="rounded-2xl border border-line p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{g}</div>
                <div className="space-y-2">
                  {PARTNER_PERMISSIONS.filter((p) => p.group === g).map((p) => {
                    const allowed = grantable.includes(p.id);
                    return (
                      <div key={p.id} className={cn(!allowed && 'opacity-50')}>
                        <Checkbox checked={d.permissions.includes(p.id)} disabled={!allowed} onCheckedChange={(v) => toggle(p.id, v)} label={p.label} description={p.hint} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-mute">Commission and finance are never available to employees.</p>
        </section>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ password reset

function ResetPasswordModal({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (member) { setPw(''); setMustChange(true); setError(''); }
  }, [member]);
  if (!member) return null;
  const problems = passwordProblems(pw, member.email);
  const save = async () => {
    if (problems.length) return setError(`Password needs ${problems.join(', ')}.`);
    setBusy(true);
    try {
      await teamApi.resetPassword(member.id, pw, mustChange);
      toast.success('Password reset', `${member.fullName} was signed out everywhere. Share the new password privately.`);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Reset password" subtitle={member.fullName} dirty={!!pw}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Reset password</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-ink-soft">Existing passwords can never be viewed. Set a new one; the employee is signed out of every device.</p>
        <Field label="New password" required>
          <div className="flex gap-2">
            <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} className="font-mono" autoComplete="new-password" />
            <Button variant="secondary" icon={Wand2} onClick={() => setPw(generatePassword())} aria-label="Generate secure password" />
          </div>
        </Field>
        <Checkbox checked={mustChange} onCheckedChange={setMustChange} label="Ask them to choose their own password at next sign-in" />
      </div>
    </Modal>
  );
}
