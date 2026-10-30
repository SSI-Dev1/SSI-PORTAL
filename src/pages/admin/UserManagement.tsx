// Super Admin: create and manage every account — partner organisations with their login
// accounts, partner staff, and SSI GLOBAL employees. No invitations: the admin sets the
// initial password. All writes go through the admin-users Edge Function or Super-Admin-only
// database rules; this page cannot grant anything the server would refuse.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowDownUp,
  Ban,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  MoreHorizontal,
  Pencil,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  Wand2,
  X,
} from 'lucide-react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  FilterSelect,
  Input,
  Menu,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Switch,
  Table,
  Tabs,
  usePaged,
} from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { useConfirm, useToast } from '../../components/feedback';
import { useStore } from '../../store/store';
import { useAuth } from '../../auth/AuthProvider';
import { passwordProblems } from '../../auth/auth';
import {
  isStaffRole,
  PARTNER_MODULES,
  PARTNER_ROLES,
  ROLE_DEFAULTS,
  ROLE_LABEL,
  STAFF_MODULES,
  STAFF_ROLES,
  type StaffRole,
} from '../../auth/roles';
import { adminApi, AdminApiError, generatePassword, loadDirectory, setPartnerAccess, type DirectoryUser } from '../../lib/adminApi';
import type { Partner, UserRole } from '../../data/types';
import { cn, formatDate, formatDateTime, timeAgo } from '../../lib/utils';

type TabKey = 'directory' | 'partners' | 'employees';
type SortKey = 'name' | 'created' | 'login';
const STATUS_LABEL: Record<DirectoryUser['status'], string> = { active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' };
const STATUS_TONE = { active: 'green', suspended: 'red', deactivated: 'slate' } as const;
const errMsg = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Something went wrong. Please try again.');

export default function UserManagement() {
  const { db, actions, profilesRev } = useStore();
  const { realSession } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<TabKey>('directory');
  const [dialog, setDialog] = useState<
    | { kind: 'employee' }
    | { kind: 'partner-user'; partnerId?: string }
    | { kind: 'edit'; user: DirectoryUser }
    | { kind: 'reset'; user: DirectoryUser }
    | { kind: 'access'; partner: Partner }
    | { kind: 'delete-partner'; partner: Partner }
    | null
  >(null);
  const [details, setDetails] = useState<DirectoryUser | null>(null);
  const [created, setCreated] = useState<{ title: string; email: string; password: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await loadDirectory());
      setLoadError('');
    } catch (e) {
      setLoadError(errMsg(e));
    }
    setLoading(false);
  }, []);
  // Re-query when any account changes (Realtime), e.g. another admin creates or suspends a user.
  useEffect(() => void reload(), [reload, profilesRev]);
  const reloadAll = async () => {
    await Promise.all([reload(), actions.reload()]);
  };

  const partners = db.partners;
  const isPartnerOpen = (p: Partner) => p.portalEnabled !== false && p.status !== 'Inactive' && !p.archivedAt;
  const employees = users.filter((u) => isStaffRole(u.role));
  const monthAgo = Date.now() - 30 * 86400_000;
  const stats = {
    partners: partners.filter((p) => !p.archivedAt).length,
    activePartners: partners.filter(isPartnerOpen).length,
    employees: employees.length,
    activeEmployees: employees.filter((u) => u.status === 'active').length,
    suspended: users.filter((u) => u.status !== 'active').length,
    recent: users.filter((u) => new Date(u.createdAt).getTime() > monthAgo).length,
  };

  const changeStatus = async (u: DirectoryUser, status: DirectoryUser['status']) => {
    const verb = status === 'active' ? 'Activate' : status === 'suspended' ? 'Suspend' : 'Deactivate';
    const ok = await confirm({
      title: `${verb} ${u.fullName || u.email}?`,
      message:
        status === 'active'
          ? 'They can sign in again with their current password.'
          : 'They are signed out of every device immediately and cannot sign in until reactivated. Their records are kept.',
      confirmLabel: verb,
      danger: status !== 'active',
    });
    if (!ok) return;
    try {
      await adminApi.setStatus(u.id, status);
      toast.success(`Account ${STATUS_LABEL[status].toLowerCase()}`, u.email);
      await reload();
    } catch (e) {
      toast.error('Status not changed', errMsg(e));
    }
  };

  const userActions = (u: DirectoryUser) => {
    const self = u.id === realSession?.userId;
    return [
      { label: 'View details', icon: Eye, onClick: () => setDetails(u) },
      ...(self
        ? []
        : [
            { label: 'Edit account', icon: Pencil, onClick: () => setDialog({ kind: 'edit', user: u }) },
            { label: 'Change role', icon: ShieldCheck, onClick: () => setDialog({ kind: 'edit', user: u }) },
            { label: 'Reset password', icon: KeyRound, onClick: () => setDialog({ kind: 'reset', user: u }) },
            ...(u.status !== 'active' ? [{ label: 'Activate', icon: PlayCircle, onClick: () => void changeStatus(u, 'active') }] : []),
            ...(u.status !== 'deactivated' ? [{ label: 'Deactivate', icon: PauseCircle, onClick: () => void changeStatus(u, 'deactivated') }] : []),
            ...(u.status !== 'suspended' ? [{ label: 'Suspend', icon: Ban, onClick: () => void changeStatus(u, 'suspended'), danger: true }] : []),
          ]),
    ];
  };

  return (
    <>
      <PageHeader
        title="User Management"
        subtitle="Create partner and employee accounts, set passwords, roles and access. No invitations or self-registration."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => void reloadAll()}>Refresh</Button>
            <Button variant="secondary" icon={Briefcase} onClick={() => setDialog({ kind: 'employee' })}>Add employee</Button>
            <Button icon={Plus} onClick={() => navigate('/admin/partners?new=1')}>Add partner</Button>
          </>
        }
      />

      {loadError && <Alert tone="error" title="Accounts could not be loaded" className="mb-5">{loadError}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Partners" value={stats.partners} icon={Building2} tone="navy" />
        <StatCard label="Active Partners" value={stats.activePartners} icon={CheckCircle2} tone="green" delay={40} />
        <StatCard label="Total Employees" value={stats.employees} icon={Briefcase} tone="navy" delay={80} />
        <StatCard label="Active Employees" value={stats.activeEmployees} icon={UsersRound} tone="green" delay={120} />
        <StatCard label="Suspended / Inactive" value={stats.suspended} icon={Ban} tone="red" delay={160} />
        <StatCard label="Created (30 days)" value={stats.recent} icon={UserPlus} tone="orange" delay={200} />
      </div>

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'directory', label: 'All accounts', count: users.length },
          { value: 'partners', label: 'Partner Management', count: stats.partners },
          { value: 'employees', label: 'Employee Management', count: employees.length },
        ]}
      />

      {tab === 'partners' ? (
        <PartnersPanel
          partners={partners}
          users={users}
          onAdd={() => navigate('/admin/partners?new=1')}
          onAddUser={(id) => setDialog({ kind: 'partner-user', partnerId: id })}
          onAccess={(p) => setDialog({ kind: 'access', partner: p })}
          onDelete={(p) => setDialog({ kind: 'delete-partner', partner: p })}
          onOpen={(p) => navigate(`/admin/partners/${p.id}`)}
          onArchive={async (p) => {
            const archive = !p.archivedAt;
            const ok = await confirm({
              title: archive ? `Archive ${p.name}?` : `Restore ${p.name}?`,
              message: archive
                ? 'All partner users lose portal access immediately. Students, applications and invoices are kept and stay visible to SSI GLOBAL.'
                : 'The partner returns to the list. Portal access stays off until you turn it on again.',
              confirmLabel: archive ? 'Archive partner' : 'Restore',
              danger: archive,
            });
            if (!ok) return;
            try {
              await setPartnerAccess(p.id, archive ? { archived: true, portalEnabled: false } : { archived: false });
              toast.success(archive ? 'Partner archived' : 'Partner restored', p.name);
              await reloadAll();
            } catch (e) {
              toast.error('Not changed', errMsg(e));
            }
          }}
        />
      ) : (
        <DirectoryPanel
          key={tab}
          users={tab === 'employees' ? employees : users}
          loading={loading}
          employeesOnly={tab === 'employees'}
          actionsFor={userActions}
          onView={setDetails}
          onAdd={() => setDialog(tab === 'employees' ? { kind: 'employee' } : { kind: 'partner-user' })}
          addLabel={tab === 'employees' ? 'Add employee' : 'Add partner user'}
        />
      )}

      {/* ----------------------------------------------------------- dialogs */}
      <EmployeeDialog
        open={dialog?.kind === 'employee'}
        onClose={() => setDialog(null)}
        onCreated={async (email, password) => {
          setDialog(null);
          setCreated({ title: 'Employee account created', email, password });
          await reload();
        }}
      />
      <PartnerUserDialog
        open={dialog?.kind === 'partner-user'}
        partnerId={dialog?.kind === 'partner-user' ? dialog.partnerId : undefined}
        partners={partners.filter((p) => !p.archivedAt)}
        onClose={() => setDialog(null)}
        onCreated={async (email, password) => {
          setDialog(null);
          setCreated({ title: 'Partner user created', email, password });
          await reload();
        }}
      />
      <EditUserDialog user={dialog?.kind === 'edit' ? dialog.user : null} onClose={() => setDialog(null)} onSaved={reload} />
      <ResetPasswordDialog
        user={dialog?.kind === 'reset' ? dialog.user : null}
        onClose={() => setDialog(null)}
        onDone={async (email, password) => {
          setDialog(null);
          setCreated({ title: 'Password reset — existing sessions signed out', email, password });
          await reload();
        }}
      />
      <PartnerAccessDialog partner={dialog?.kind === 'access' ? dialog.partner : null} onClose={() => setDialog(null)} onSaved={reloadAll} />
      <DeletePartnerDialog partner={dialog?.kind === 'delete-partner' ? dialog.partner : null} onClose={() => setDialog(null)} onDeleted={reloadAll} />
      <CredentialsOnce data={created} onClose={() => setCreated(null)} />
      <UserDetails user={details} onClose={() => setDetails(null)} actionsFor={userActions} />
    </>
  );
}

/* ================================================================== directory */

function DirectoryPanel({
  users,
  loading,
  employeesOnly,
  actionsFor,
  onView,
  onAdd,
  addLabel,
}: {
  users: DirectoryUser[];
  loading: boolean;
  employeesOnly: boolean;
  actionsFor: (u: DirectoryUser) => { label: string; icon: typeof Eye; onClick: () => void; danger?: boolean }[];
  onView: (u: DirectoryUser) => void;
  onAdd: () => void;
  addLabel: string;
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = users.filter(
      (u) =>
        (!needle || [u.fullName, u.email, u.partnerName ?? 'ssi global'].some((v) => v.toLowerCase().includes(needle))) &&
        (!type || (type === 'employee') === isStaffRole(u.role)) &&
        (!role || u.role === role) &&
        (!status || u.status === status),
    );
    const val = (u: DirectoryUser) =>
      sort.key === 'name' ? (u.fullName || u.email).toLowerCase() : sort.key === 'created' ? u.createdAt : u.lastSignInAt ?? '';
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [users, q, type, role, status, sort]);
  const paged = usePaged(rows, 10, `${q}|${type}|${role}|${status}|${sort.key}${sort.dir}`);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}
      className={cn('inline-flex items-center gap-1 rounded uppercase hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300', sort.key === key && 'text-heading')}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <ArrowDownUp className="h-3 w-3" />
    </button>
  );

  const roleOptions = (employeesOnly ? STAFF_ROLES : [...STAFF_ROLES, ...PARTNER_ROLES]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, email or organisation…" className="w-full sm:w-72" />
        {!employeesOnly && <FilterSelect label="All account types" value={type} onChange={setType} options={[{ value: 'employee', label: 'Employees' }, { value: 'partner', label: 'Partner users' }]} />}
        <FilterSelect label="All roles" value={role} onChange={setRole} options={roleOptions} />
        <FilterSelect label="All statuses" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'deactivated', label: 'Deactivated' }]} />
        <Button size="sm" icon={UserPlus} className="ml-auto" onClick={onAdd}>{addLabel}</Button>
      </div>
      {loading && users.length === 0 ? (
        <div className="flex justify-center py-14" role="status" aria-label="Loading accounts">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-rust border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="No accounts found" description="Try another search or filter, or create a new account." />
      ) : (
        <>
          <Table head={[sortBtn('name', 'Name'), 'Account type', 'Organisation', 'Role', 'Status', sortBtn('created', 'Created'), sortBtn('login', 'Last login'), '']}>
            {paged.rows.map((u) => (
              <tr key={u.id} className="transition hover:bg-canvas/60">
                <td className="px-5 py-3">
                  <button type="button" onClick={() => onView(u)} className="flex items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                    <Avatar name={u.fullName || u.email} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-heading">{u.fullName || '—'}</span>
                      <span className="block truncate text-xs text-ink-mute">{u.email}</span>
                    </span>
                  </button>
                </td>
                <td className="px-5 py-3"><Badge tone={isStaffRole(u.role) ? 'navy' : 'orange'}>{isStaffRole(u.role) ? 'Employee' : 'Partner'}</Badge></td>
                <td className="px-5 py-3 text-ink-soft">{u.partnerName ?? 'SSI GLOBAL'}</td>
                <td className="whitespace-nowrap px-5 py-3 text-ink-soft">
                  {ROLE_LABEL[u.role]}
                  {u.department && <span className="block text-xs text-ink-mute">{u.department}{u.designation ? ` · ${u.designation}` : ''}</span>}
                </td>
                <td className="px-5 py-3"><Badge tone={STATUS_TONE[u.status]} dot>{STATUS_LABEL[u.status]}</Badge></td>
                <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-soft">{formatDate(u.createdAt)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-soft">{u.lastSignInAt ? timeAgo(u.lastSignInAt) : 'Never'}</td>
                <td className="px-5 py-3 text-right">
                  <Menu
                    width="w-52"
                    trigger={() => (
                      <button type="button" aria-label={`Actions for ${u.fullName || u.email}`} className="rounded-lg p-1.5 text-ink-mute transition hover:bg-canvas hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                    items={actionsFor(u)}
                  />
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="accounts" />
        </>
      )}
    </Card>
  );
}

function UserDetails({ user, onClose, actionsFor }: { user: DirectoryUser | null; onClose: () => void; actionsFor: (u: DirectoryUser) => { label: string; icon: typeof Eye; onClick: () => void; danger?: boolean }[] }) {
  const u = user;
  const staff = u ? isStaffRole(u.role) : false;
  return (
    <Drawer open={!!u} onClose={onClose} title={u?.fullName || u?.email || ''} subtitle={u ? ROLE_LABEL[u.role] : ''}>
      {u && (
        <div className="space-y-5 text-sm">
          <div className="flex items-center gap-3">
            <Avatar name={u.fullName || u.email} size={48} />
            <div className="min-w-0">
              <div className="truncate font-semibold text-heading">{u.email}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone={STATUS_TONE[u.status]} dot>{STATUS_LABEL[u.status]}</Badge>
                <Badge tone={staff ? 'navy' : 'orange'}>{staff ? 'Employee' : 'Partner'}</Badge>
                {u.mustChangePassword && <Badge tone="amber">Must change password</Badge>}
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-canvas p-4 ring-1 ring-line">
            <div><dt className="text-xs text-ink-mute">Organisation</dt><dd className="font-semibold text-heading">{u.partnerName ?? 'SSI GLOBAL'}</dd></div>
            <div><dt className="text-xs text-ink-mute">Role</dt><dd className="font-semibold text-heading">{ROLE_LABEL[u.role]}</dd></div>
            <div><dt className="text-xs text-ink-mute">Phone</dt><dd className="text-heading">{u.phone || '—'}</dd></div>
            {staff && <div><dt className="text-xs text-ink-mute">Department</dt><dd className="text-heading">{[u.department, u.designation].filter(Boolean).join(' · ') || '—'}</dd></div>}
            <div><dt className="text-xs text-ink-mute">Created</dt><dd className="text-heading">{formatDateTime(u.createdAt)}</dd></div>
            <div><dt className="text-xs text-ink-mute">Last login</dt><dd className="text-heading">{u.lastSignInAt ? formatDateTime(u.lastSignInAt) : 'Never'}</dd></div>
          </dl>
          {staff && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-mute">Access permissions</div>
              <div className="flex flex-wrap gap-1.5">
                {STAFF_MODULES.map((m) => {
                  const on = u.permissions?.includes(m.id);
                  return (
                    <span key={m.id} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1', on ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' : 'bg-canvas text-ink-mute ring-line')}>
                      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {m.label}
                    </span>
                  );
                })}
              </div>
              {u.role === 'super_admin' && <p className="mt-2 text-xs text-ink-mute">Super Admins always have every permission, plus account management.</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {actionsFor(u)
              .filter((a) => a.label !== 'View details')
              .map((a) => (
                <Button key={a.label} size="sm" variant={a.danger ? 'danger' : 'secondary'} icon={a.icon} onClick={() => { onClose(); a.onClick(); }}>
                  {a.label}
                </Button>
              ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ================================================================== partners */

function PartnersPanel({
  partners,
  users,
  onAdd,
  onAddUser,
  onAccess,
  onArchive,
  onDelete,
  onOpen,
}: {
  partners: Partner[];
  users: DirectoryUser[];
  onAdd: () => void;
  onAddUser: (id: string) => void;
  onAccess: (p: Partner) => void;
  onArchive: (p: Partner) => void;
  onDelete: (p: Partner) => void;
  onOpen: (p: Partner) => void;
}) {
  const { db } = useStore();
  const [q, setQ] = useState('');
  const [show, setShow] = useState('current');
  const rows = partners
    .filter((p) => (show === 'archived' ? !!p.archivedAt : !p.archivedAt))
    .filter((p) => !q.trim() || [p.name, p.code, p.city, p.email].some((v) => (v ?? '').toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
  const paged = usePaged(rows, 10, `${q}|${show}`);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search partners…" className="w-full sm:w-72" />
        <FilterSelect label="Current partners" value={show === 'current' ? '' : show} onChange={(v) => setShow(v || 'current')} options={[{ value: 'archived', label: 'Archived partners' }]} />
        <Button size="sm" icon={Plus} className="ml-auto" onClick={onAdd}>Add partner</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Building2} title={show === 'archived' ? 'No archived partners' : 'No partners yet'} description="Add a partner to create its private workspace and login account." />
      ) : (
        <>
          <Table head={['Partner', 'Users', 'Students', 'Applications', 'Portal access', 'Modules', '']}>
            {paged.rows.map((p) => {
              const open = p.portalEnabled !== false && p.status !== 'Inactive' && !p.archivedAt;
              const members = users.filter((u) => u.partnerId === p.id);
              return (
                <tr key={p.id} className="transition hover:bg-canvas/60">
                  <td className="px-5 py-3">
                    <button type="button" onClick={() => onOpen(p)} className="rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                      <span className="block font-semibold text-heading">{p.name}</span>
                      <span className="block text-xs text-ink-mute">{p.code} · {p.city} · {p.status}</span>
                    </button>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">
                    {members.length} <span className="text-xs text-ink-mute">({members.filter((m) => m.status === 'active').length} active)</span>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{db.students.filter((s) => s.partnerId === p.id).length}</td>
                  <td className="px-5 py-3 text-ink-soft">{db.applications.filter((a) => a.partnerId === p.id).length}</td>
                  <td className="px-5 py-3">
                    <Badge tone={open ? 'green' : p.archivedAt ? 'slate' : 'red'} dot>{p.archivedAt ? 'Archived' : open ? 'Enabled' : 'Disabled'}</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-soft">{(p.modules ?? []).length} / {PARTNER_MODULES.length}</td>
                  <td className="px-5 py-3 text-right">
                    <Menu
                      width="w-56"
                      trigger={() => (
                        <button type="button" aria-label={`Actions for ${p.name}`} className="rounded-lg p-1.5 text-ink-mute transition hover:bg-canvas hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      )}
                      items={[
                        { label: 'View students & applications', icon: Eye, onClick: () => onOpen(p) },
                        ...(p.archivedAt
                          ? [{ label: 'Restore partner', icon: ArchiveRestore, onClick: () => onArchive(p) }]
                          : [
                              { label: 'Portal access & permissions', icon: SlidersHorizontal, onClick: () => onAccess(p) },
                              { label: 'Add partner user', icon: UserPlus, onClick: () => onAddUser(p.id) },
                              { label: 'Archive partner', icon: Archive, onClick: () => onArchive(p), danger: true },
                            ]),
                        { label: 'Delete partner', icon: Trash2, onClick: () => onDelete(p), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="partners" />
        </>
      )}
    </Card>
  );
}

function ModulePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PARTNER_MODULES.map((m) => (
        <Checkbox
          key={m.id}
          checked={value.includes(m.id)}
          onCheckedChange={(on) => onChange(on ? [...value, m.id] : value.filter((x) => x !== m.id))}
          label={m.label}
          description={m.id === 'finance' ? 'Visible to Partner Admins only' : undefined}
        />
      ))}
    </div>
  );
}

function PartnerAccessDialog({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [portal, setPortal] = useState(true);
  const [modules, setModules] = useState<string[]>([]);
  const [status, setStatus] = useState('Active');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!partner) return;
    setPortal(partner.portalEnabled !== false);
    setModules(partner.modules ?? PARTNER_MODULES.map((m) => m.id));
    setStatus(partner.status);
  }, [partner]);
  const save = async () => {
    if (!partner) return;
    setBusy(true);
    try {
      await setPartnerAccess(partner.id, { portalEnabled: portal, modules, status });
      toast.success('Partner access updated', partner.name);
      await onSaved();
      onClose();
    } catch (e) {
      toast.error('Not saved', errMsg(e));
    }
    setBusy(false);
  };
  return (
    <Modal
      open={!!partner}
      onClose={onClose}
      title="Portal access & permissions"
      subtitle={partner?.name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save access</Button></>}
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-canvas p-4 ring-1 ring-line">
          <div>
            <div className="font-semibold text-heading">Client Portal access</div>
            <div className="text-xs text-ink-mute">When off, every user of this partner loses access immediately.</div>
          </div>
          <Switch checked={portal} onCheckedChange={setPortal} label="Client Portal access" />
        </div>
        <Field label="Partner status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Partner status">
            <option value="Active">Active</option>
            <option value="Onboarding">Onboarding</option>
            <option value="Inactive">Inactive (no access)</option>
          </Select>
        </Field>
        <div>
          <div className="mb-2 text-sm font-semibold text-heading">Modules this partner can use</div>
          <ModulePicker value={modules} onChange={setModules} />
        </div>
        <p className="text-xs text-ink-mute">Partners cannot change these settings themselves. The database enforces them on every request.</p>
      </div>
    </Modal>
  );
}

function DeletePartnerDialog({ partner, onClose, onDeleted }: { partner: Partner | null; onClose: () => void; onDeleted: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setName('');
    setError('');
  }, [partner]);
  const del = async () => {
    if (!partner) return;
    setBusy(true);
    setError('');
    try {
      await adminApi.deletePartner(partner.id, name);
      toast.success('Partner deleted', partner.name);
      await onDeleted();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };
  return (
    <Modal
      open={!!partner}
      onClose={onClose}
      size="sm"
      title="Delete partner permanently?"
      subtitle={partner?.name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" icon={Trash2} onClick={del} loading={busy} disabled={name !== partner?.name}>Delete partner</Button></>}
    >
      <div className="space-y-4">
        <Alert tone="warning">
          Deletion is only allowed for partners with no students or invoices, and removes all of the partner's login accounts. Use <strong>Archive</strong> to keep records.
        </Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={`Type “${partner?.name ?? ''}” to confirm`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </Modal>
  );
}

/* ================================================================== forms */

export function PasswordInput({
  value,
  onChange,
  email,
  error,
  confirm,
  onConfirm,
  confirmError,
}: {
  value: string;
  onChange: (v: string) => void;
  email: string;
  error?: string;
  /** When given, a "Confirm password" field is shown (Generate fills both). */
  confirm?: string;
  onConfirm?: (v: string) => void;
  confirmError?: string;
}) {
  const [show, setShow] = useState(false);
  const toast = useToast();
  const problems = value ? passwordProblems(value, email) : [];
  return (
    <div className={cn('grid gap-4', onConfirm && 'sm:grid-cols-2')}>
      <Field label="Initial password" required error={error} hint={!error ? (value && !problems.length ? 'Strong password ✓' : '12+ characters with upper, lower, number and symbol') : undefined}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              icon={KeyRound}
              type={show ? 'text' : 'password'}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoComplete="new-password"
              invalid={!!error}
              className="pr-10 font-mono"
              aria-label="Initial password"
            />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-mute hover:text-heading">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            type="button"
            variant="secondary"
            icon={Wand2}
            onClick={() => {
              const pw = generatePassword();
              onChange(pw);
              onConfirm?.(pw);
              setShow(true);
              toast.info('Secure password generated', 'Share it with the user privately — it will not be shown again after this window.');
            }}
          >
            Generate
          </Button>
        </div>
      </Field>
      {onConfirm && (
        <Field label="Confirm password" required error={confirmError}>
          <Input
            icon={KeyRound}
            type={show ? 'text' : 'password'}
            value={confirm ?? ''}
            onChange={(e) => onConfirm(e.target.value)}
            autoComplete="new-password"
            invalid={!!confirmError}
            className="font-mono"
            aria-label="Confirm password"
          />
        </Field>
      )}
    </div>
  );
}

export const pwError = (pw: string, email: string) => {
  if (!pw) return 'Set an initial password or generate one.';
  const p = passwordProblems(pw, email);
  return p.length ? `Password must have ${p.join(', ')}.` : undefined;
};
export const confirmError = (pw: string, confirm: string) => (confirm === pw ? undefined : 'The passwords do not match.');

function PermissionPicker({ role, value, onChange }: { role: StaffRole; value: string[] | null; onChange: (v: string[] | null) => void }) {
  if (role === 'super_admin') return <Alert tone="info">Super Admins always have every permission and can manage accounts.</Alert>;
  const effective = value ?? ROLE_DEFAULTS[role];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-heading">Access permissions</div>
        <Checkbox checked={value === null} onCheckedChange={(on) => onChange(on ? null : [...ROLE_DEFAULTS[role]])} label="Use role defaults" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {STAFF_MODULES.map((m) => (
          <Checkbox
            key={m.id}
            checked={effective.includes(m.id)}
            disabled={value === null}
            onCheckedChange={(on) => onChange(on ? [...effective, m.id] : effective.filter((x) => x !== m.id))}
            label={m.label}
            description={m.hint}
          />
        ))}
      </div>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy(false);
  };
  return { busy, error, setError, run };
}

function EmployeeDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (email: string, password: string) => Promise<void> }) {
  const blank = { fullName: '', email: '', phone: '', department: '', designation: '', role: 'support_staff' as StaffRole, status: 'active', password: '', confirm: '', mustChange: false };
  const [f, setF] = useState(blank);
  const [perms, setPerms] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const s = useSubmit();
  useEffect(() => {
    if (!open) return;
    setF(blank);
    setPerms(null);
    setErrors({});
    s.setError('');
  }, [open]);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const e = {
      fullName: f.fullName.trim().length < 2 ? 'Enter the employee name.' : undefined,
      email: /^\S+@\S+\.\S+$/.test(f.email.trim()) ? undefined : 'Enter a valid email address.',
      password: pwError(f.password, f.email),
      confirm: confirmError(f.password, f.confirm),
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    void s.run(async () => {
      const email = f.email.trim().toLowerCase();
      await adminApi.createEmployee({
        email, fullName: f.fullName.trim(), role: f.role, permissions: f.role === 'super_admin' ? null : perms, password: f.password,
        mustChangePassword: f.mustChange, phone: f.phone, department: f.department, designation: f.designation, status: f.status as DirectoryUser['status'],
      });
      await onCreated(email, f.password);
    });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={!!(f.fullName || f.email || f.password)}
      title="Add employee"
      subtitle="Creates an SSI GLOBAL staff account. Admin Staff and Super Admins use the Admin Portal; other roles use the Staff Portal."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Check} onClick={save} loading={s.busy}>Create employee account</Button></>}
    >
      <div className="space-y-6">
        {s.error && <Alert tone="error">{s.error}</Alert>}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">1 · Employee details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee name" required error={errors.fullName}><Input value={f.fullName} invalid={!!errors.fullName} onChange={set('fullName')} autoFocus /></Field>
            <Field label="Employee email (login)" required error={errors.email}><Input icon={Mail} type="email" value={f.email} invalid={!!errors.email} onChange={set('email')} autoComplete="off" /></Field>
            <Field label="Phone number"><Input value={f.phone} onChange={set('phone')} placeholder="+91 …" /></Field>
            <Field label="Department"><Input value={f.department} onChange={set('department')} placeholder="e.g. Admissions" /></Field>
            <Field label="Designation"><Input value={f.designation} onChange={set('designation')} placeholder="e.g. Senior Counsellor" /></Field>
            <Field label="Assigned role" required>
              <Select value={f.role} onChange={(e) => { setF({ ...f, role: e.target.value as StaffRole }); setPerms(null); }} aria-label="Assigned role">
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </Field>
            <Field label="Account status">
              <Select value={f.status} onChange={set('status')} aria-label="Account status">
                <option value="active">Active — can sign in now</option>
                <option value="deactivated">Deactivated — create now, activate later</option>
              </Select>
            </Field>
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">2 · Login credentials</h3>
          <PasswordInput value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} confirm={f.confirm} onConfirm={(v) => setF((x) => ({ ...x, confirm: v }))} email={f.email} error={errors.password} confirmError={errors.confirm} />
          <div className="mt-3"><Checkbox checked={f.mustChange} onCheckedChange={(v) => setF({ ...f, mustChange: v })} label="Require a password change at first sign-in" description="Off by default." /></div>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">3 · Access permissions</h3>
          <PermissionPicker role={f.role} value={perms} onChange={setPerms} />
        </section>
      </div>
    </Modal>
  );
}

const emptyOrg = { name: '', code: '', branch: '', contactName: '', email: '', phone: '', country: 'India', address: '', status: 'Active' };

/** Clients & Branches → Add Partner: the organisation and its first login, in one step. */
export function PartnerDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (email: string, password: string) => Promise<void> }) {
  const { db } = useStore();
  const [org, setOrg] = useState(emptyOrg);
  const [acct, setAcct] = useState({ email: '', password: '', confirm: '', mustChange: false });
  const [modules, setModules] = useState<string[]>(PARTNER_MODULES.map((m) => m.id));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const s = useSubmit();
  useEffect(() => {
    if (!open) return;
    setOrg(emptyOrg);
    setAcct({ email: '', password: '', confirm: '', mustChange: false });
    setModules(PARTNER_MODULES.map((m) => m.id));
    setErrors({});
    s.setError('');
  }, [open]);
  const loginEmail = acct.email || org.email;
  // Suggest a code from the name (editable).
  const suggestedCode = org.name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  const code = org.code || (suggestedCode.length >= 2 ? suggestedCode : '');
  const save = () => {
    const e = {
      name: org.name.trim().length < 3 ? 'Organisation name is required.' : undefined,
      code: !/^[A-Z]{2,5}$/.test(code) ? '2–5 uppercase letters.' : db.partners.some((p) => p.code === code) ? 'Code already in use — choose another.' : undefined,
      branch: org.branch.trim() ? undefined : 'Branch name is required.',
      contactName: org.contactName.trim().length < 2 ? 'Contact person is required.' : undefined,
      email: /^\S+@\S+\.\S+$/.test(org.email) ? undefined : 'Valid email required.',
      phone: org.phone.replace(/\D/g, '').length < 8 ? 'Valid phone required.' : undefined,
      loginEmail: /^\S+@\S+\.\S+$/.test(loginEmail) ? undefined : 'Valid login email required.',
      password: pwError(acct.password, loginEmail),
      confirm: confirmError(acct.password, acct.confirm),
      modules: modules.length ? undefined : 'Enable at least one module.',
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    void s.run(async () => {
      const email = loginEmail.trim().toLowerCase();
      const active = org.status === 'Active';
      await adminApi.createPartner({
        partner: {
          name: org.name, code, contactName: org.contactName, email: org.email, phone: org.phone, country: org.country,
          city: org.branch, branches: [org.branch.trim()], address: org.address, tier: 'Silver',
        },
        account: { email, fullName: org.contactName.trim(), password: acct.password, mustChangePassword: acct.mustChange },
        portalEnabled: active,
        modules,
      });
      await onCreated(email, acct.password);
    });
  };
  const o = (k: keyof typeof emptyOrg) => (e: { target: { value: string } }) => setOrg({ ...org, [k]: e.target.value });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={!!(org.name || org.email || acct.password)}
      title="Add partner"
      subtitle="Creates the partner organisation, its private workspace and its Partner Admin login. No invitation is sent."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Check} onClick={save} loading={s.busy}>Create Partner &amp; Account</Button></>}
    >
      <div className="space-y-6">
        {s.error && <Alert tone="error">{s.error}</Alert>}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">1 · Partner information</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Partner organisation name" required error={errors.name} className="sm:col-span-2"><Input icon={Building2} value={org.name} invalid={!!errors.name} onChange={o('name')} placeholder="e.g. Sunrise Overseas Education" autoFocus /></Field>
            <Field label="Branch name" required error={errors.branch}><Input value={org.branch} invalid={!!errors.branch} onChange={o('branch')} placeholder="e.g. Kochi" /></Field>
            <Field label="Partner code" required error={errors.code} hint={org.code ? 'Short unique code' : code ? `Suggested: ${code}` : 'Short unique code'}>
              <Input value={org.code} placeholder={code || 'SOE'} invalid={!!errors.code} onChange={(e) => setOrg({ ...org, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) })} />
            </Field>
            <Field label="Contact person" required error={errors.contactName}><Input value={org.contactName} invalid={!!errors.contactName} onChange={o('contactName')} /></Field>
            <Field label="Email address" required error={errors.email}><Input icon={Mail} type="email" value={org.email} invalid={!!errors.email} onChange={o('email')} /></Field>
            <Field label="Phone number" required error={errors.phone}><Input value={org.phone} invalid={!!errors.phone} onChange={o('phone')} placeholder="+91 …" /></Field>
            <Field label="Country">
              <Select value={org.country} onChange={o('country')} aria-label="Country">
                {['India', 'UAE', 'Sri Lanka', 'Nepal', 'Bangladesh', 'Nigeria', 'Vietnam'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Address" className="sm:col-span-2"><Input value={org.address} onChange={o('address')} placeholder="Street, city, PIN" /></Field>
            <Field label="Account status">
              <Select value={org.status} onChange={o('status')} aria-label="Account status">
                <option value="Active">Active — can sign in now</option>
                <option value="Inactive">Inactive — create now, enable later</option>
              </Select>
            </Field>
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">2 · Login credentials</h3>
          <div className="space-y-4">
            <Field label="Registered login email" required error={errors.loginEmail} hint="Defaults to the email address above">
              <Input icon={Mail} type="email" value={acct.email} placeholder={org.email} invalid={!!errors.loginEmail} onChange={(e) => setAcct({ ...acct, email: e.target.value })} autoComplete="off" />
            </Field>
            <PasswordInput value={acct.password} onChange={(v) => setAcct((x) => ({ ...x, password: v }))} confirm={acct.confirm} onConfirm={(v) => setAcct((x) => ({ ...x, confirm: v }))} email={loginEmail} error={errors.password} confirmError={errors.confirm} />
            <Checkbox checked={acct.mustChange} onCheckedChange={(v) => setAcct({ ...acct, mustChange: v })} label="Require a password change at first sign-in" />
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">3 · Access permissions</h3>
          {errors.modules && <Alert tone="error" className="mb-3">{errors.modules}</Alert>}
          <ModulePicker value={modules} onChange={setModules} />
        </section>
      </div>
    </Modal>
  );
}

function PartnerUserDialog({ open, partnerId, partners, onClose, onCreated }: { open: boolean; partnerId?: string; partners: Partner[]; onClose: () => void; onCreated: (email: string, password: string) => Promise<void> }) {
  const [f, setF] = useState({ partnerId: '', fullName: '', email: '', role: 'partner_staff' as UserRole, password: '', mustChange: false });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const s = useSubmit();
  useEffect(() => {
    if (!open) return;
    setF({ partnerId: partnerId ?? '', fullName: '', email: '', role: 'partner_staff', password: '', mustChange: false });
    setErrors({});
    s.setError('');
  }, [open, partnerId]);
  const save = () => {
    const e = {
      partnerId: f.partnerId ? undefined : 'Choose the partner organisation.',
      fullName: f.fullName.trim().length < 2 ? 'Enter the full name.' : undefined,
      email: /^\S+@\S+\.\S+$/.test(f.email.trim()) ? undefined : 'Enter a valid email address.',
      password: pwError(f.password, f.email),
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    void s.run(async () => {
      const email = f.email.trim().toLowerCase();
      await adminApi.createPartnerUser({ partnerId: f.partnerId, email, fullName: f.fullName.trim(), role: f.role, password: f.password, mustChangePassword: f.mustChange });
      await onCreated(email, f.password);
    });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={!!(f.fullName || f.email || f.password)}
      title="Add partner user"
      subtitle="Partner users only ever see their own organisation's data."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Check} onClick={save} loading={s.busy}>Save & create account</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {s.error && <Alert tone="error" className="sm:col-span-2">{s.error}</Alert>}
        <Field label="Partner organisation" required error={errors.partnerId} className="sm:col-span-2">
          <Select value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })} aria-label="Partner organisation">
            <option value="">Select partner…</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Full name" required error={errors.fullName}><Input value={f.fullName} invalid={!!errors.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Login email" required error={errors.email}><Input icon={Mail} type="email" value={f.email} invalid={!!errors.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></Field>
        <Field label="Role" className="sm:col-span-2" hint="Partner Admins also see the partner's finance (when enabled).">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as UserRole })} aria-label="Partner role">
            {PARTNER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><PasswordInput value={f.password} onChange={(v) => setF({ ...f, password: v })} email={f.email} error={errors.password} /></div>
        <div className="sm:col-span-2"><Checkbox checked={f.mustChange} onCheckedChange={(v) => setF({ ...f, mustChange: v })} label="Require a password change at first sign-in" /></div>
      </div>
    </Modal>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: DirectoryUser | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('admin_staff');
  const [perms, setPerms] = useState<string[] | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [contact, setContact] = useState({ phone: '', department: '', designation: '' });
  const s = useSubmit();
  const staff = user ? isStaffRole(user.role) : false;
  useEffect(() => {
    if (!user) return;
    setFullName(user.fullName);
    setRole(user.role);
    // Show explicit permissions only when they differ from the role defaults.
    const defaults = isStaffRole(user.role) ? ROLE_DEFAULTS[user.role] : [];
    const same = !!user.permissions && user.permissions.length === defaults.length && user.permissions.every((p) => defaults.includes(p as never));
    setPerms(same ? null : user.permissions);
    setMustChange(user.mustChangePassword);
    setContact({ phone: user.phone ?? '', department: user.department ?? '', designation: user.designation ?? '' });
    s.setError('');
  }, [user]);
  const save = () =>
    void s.run(async () => {
      if (!user) return;
      if (fullName.trim().length < 2) throw new AdminApiError('Enter the full name.');
      await adminApi.updateUser({
        userId: user.id,
        fullName: fullName.trim(),
        role,
        ...(staff ? { permissions: role === 'super_admin' ? null : perms, department: contact.department, designation: contact.designation } : {}),
        phone: contact.phone,
        mustChangePassword: mustChange,
      });
      toast.success('Account updated', user.email);
      await onSaved();
      onClose();
    });
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="lg"
      title="Edit account"
      subtitle={user?.email}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={s.busy}>Save changes</Button></>}
    >
      {user && (
        <div className="space-y-5">
          {s.error && <Alert tone="error">{s.error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
            <Field label="Login email" hint="Email cannot be changed here — create a new account instead."><Input value={user.email} disabled /></Field>
            <Field label="Phone number"><Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
            {staff && <Field label="Department"><Input value={contact.department} onChange={(e) => setContact({ ...contact, department: e.target.value })} /></Field>}
            {staff && <Field label="Designation"><Input value={contact.designation} onChange={(e) => setContact({ ...contact, designation: e.target.value })} /></Field>}
            <Field label="Role" className="sm:col-span-2">
              <Select value={role} onChange={(e) => { setRole(e.target.value as UserRole); setPerms(null); }} aria-label="Role">
                {(staff ? STAFF_ROLES : PARTNER_ROLES).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </Field>
          </div>
          {staff && isStaffRole(role) && <PermissionPicker role={role} value={perms} onChange={setPerms} />}
          {!staff && <Alert tone="info">Partner users get their module access from the partner organisation (Partner Management → Portal access).</Alert>}
          <Checkbox checked={mustChange} onCheckedChange={setMustChange} label="Require a password change at next sign-in" />
        </div>
      )}
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: DirectoryUser | null; onClose: () => void; onDone: (email: string, password: string) => Promise<void> }) {
  const confirm = useConfirm();
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [err, setErr] = useState<string>();
  const s = useSubmit();
  useEffect(() => {
    setPassword('');
    setMustChange(false);
    setErr(undefined);
    s.setError('');
  }, [user]);
  const submit = async () => {
    if (!user) return;
    const e = pwError(password, user.email);
    setErr(e);
    if (e) return;
    const ok = await confirm({
      title: `Reset password for ${user.fullName || user.email}?`,
      message: 'Their current password stops working and they are signed out of every device.',
      confirmLabel: 'Reset password',
      danger: true,
    });
    if (!ok) return;
    void s.run(async () => {
      await adminApi.resetPassword(user.id, password, mustChange);
      await onDone(user.email, password);
    });
  };
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      dirty={!!password}
      title="Reset password"
      subtitle={user?.email}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={KeyRound} onClick={() => void submit()} loading={s.busy}>Set new password</Button></>}
    >
      {user && (
        <div className="space-y-4">
          {s.error && <Alert tone="error">{s.error}</Alert>}
          <PasswordInput value={password} onChange={setPassword} email={user.email} error={err} />
          <Checkbox checked={mustChange} onCheckedChange={setMustChange} label="Require a password change at next sign-in" />
          <p className="text-xs text-ink-mute">Existing passwords are never shown. The new password is not emailed — share it with the user privately.</p>
        </div>
      )}
    </Modal>
  );
}

/** Shows a just-set password exactly once; it is cleared from memory when closed. */
export function CredentialsOnce({ data, onClose }: { data: { title: string; email: string; password: string } | null; onClose: () => void }) {
  const toast = useToast();
  const [show, setShow] = useState(false);
  useEffect(() => setShow(false), [data]);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Copy not available', 'Select the text and copy it manually.');
    }
  };
  return (
    <Modal open={!!data} onClose={onClose} size="sm" title={data?.title ?? ''} subtitle="The account is ready to sign in." footer={<Button onClick={onClose}>Done</Button>}>
      {data && (
        <div className="space-y-4">
          <Alert tone="warning" title="Shown once">This password will not be displayed again. Share it with the user privately (not by email).</Alert>
          <div className="space-y-2 rounded-xl bg-canvas p-4 ring-1 ring-line">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><div className="text-xs text-ink-mute">Login email</div><div className="truncate font-semibold text-heading">{data.email}</div></div>
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy(data.email, 'Email')}>Copy</Button>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
              <div className="min-w-0"><div className="text-xs text-ink-mute">Password</div><div className="truncate font-mono font-semibold text-heading">{show ? data.password : '•'.repeat(Math.min(16, data.password.length))}</div></div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" icon={show ? EyeOff : Eye} onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Button>
                <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy(data.password, 'Password')}>Copy</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
