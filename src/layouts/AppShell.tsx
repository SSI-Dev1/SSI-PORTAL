import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CheckCheck,
  ChevronDown,
  Eye,
  ClipboardCheck,
  FileStack,
  FileText,
  Landmark,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Megaphone,
  Menu as MenuIcon,
  Search,
  Settings,
  Sparkles,
  UserCircle2,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/brand';
import { Avatar, Badge, IconButton, Menu, useClickOutside } from '../components/ui';
import { useConfirm, useToast } from '../components/feedback';
import { useScoped, useStore } from '../store/store';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { signOut as authSignOut } from '../auth/auth';
import { cn, countryFlag, fullName, matches, timeAgo, updateStatus } from '../lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const adminNav: NavItem[] = [
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'partners', label: 'Clients & Branches', icon: Building2 },
  { to: 'students', label: 'Students', icon: Users },
  { to: 'applications', label: 'Applications', icon: FileStack },
  { to: 'assessments', label: 'Assessments', icon: ClipboardCheck },
  { to: 'providers', label: 'Education Providers', icon: Landmark },
  { to: 'courses', label: 'Courses', icon: BookOpen },
  { to: 'documents', label: 'Documents', icon: FileText },
  { to: 'finance', label: 'Finance', icon: Wallet },
  { to: 'tasks', label: 'Tasks & Reminders', icon: ListTodo },
  { to: 'updates', label: 'Important Updates', icon: Megaphone },
  { to: 'reports', label: 'Reports', icon: BarChart3 },
  { to: 'settings', label: 'Settings', icon: Settings },
];

const clientNav: NavItem[] = [
  { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'students', label: 'My Students', icon: Users },
  { to: 'applications', label: 'Applications', icon: FileStack },
  { to: 'course-finder', label: 'Course Finder', icon: Sparkles },
  { to: 'assessments', label: 'Assessments', icon: ClipboardCheck },
  { to: 'documents', label: 'Documents', icon: FileText },
  { to: 'finance', label: 'Finance', icon: Wallet },
  { to: 'updates', label: 'Important Updates', icon: Megaphone },
  { to: 'profile', label: 'My Profile', icon: UserCircle2 },
];

export default function AppShell() {
  const { session, actions } = useStore();
  const scoped = useScoped();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = session?.role === 'admin';
  const nav = isAdmin ? adminNav : clientNav;
  const base = scoped.base;

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Unread "Important Updates" badge for partners.
  const liveUpdates = scoped.announcements.filter((a) => updateStatus(a) === 'Active').length;

  const signOut = async () => {
    const ok = await confirm({ title: 'Sign out?', message: 'You will be returned to the login screen.', confirmLabel: 'Sign out' });
    if (ok) {
      await authSignOut().catch(() => {});
      actions.logout();
      toast.info('Signed out', 'See you soon.');
      navigate('/login');
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 pb-6 pt-6">
        <Logo />
        <IconButton icon={X} label="Close menu" className="lg:hidden" onClick={() => setMobileOpen(false)} />
      </div>
      <div className="mx-4 mb-4 rounded-xl bg-gradient-to-br from-navy to-navy-600 px-3.5 py-3 text-white">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-300">{isAdmin ? 'Super Admin Portal' : 'Partner Portal'}</div>
        <div className="mt-0.5 truncate text-[13px] font-semibold">{isAdmin ? 'SSI GLOBAL · Head Office' : scoped.partner?.name}</div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={`${base}/${item.to}`}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition-all duration-200',
                isActive ? 'bg-gradient-to-r from-brand-50 to-brand-50/30 text-rust' : 'text-ink-soft hover:bg-canvas hover:text-heading',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-rust" />}
                <item.icon className={cn('h-[18px] w-[18px] transition', isActive ? 'text-rust' : 'text-ink-mute group-hover:text-heading')} strokeWidth={1.9} />
                <span className="flex-1">{item.label}</span>
                {item.to === 'updates' && !isAdmin && liveUpdates > 0 && (
                  <span className="rounded-full bg-rust px-1.5 py-px text-[10.5px] font-bold text-white">{liveUpdates}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <Menu
          align="left"
          width="w-56"
          trigger={(open) => (
            <button type="button" className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-canvas">
              <Avatar name={session?.name ?? 'User'} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-heading">{session?.name}</div>
                <div className="truncate text-xs text-ink-mute">{session?.title}</div>
              </div>
              <ChevronDown className={cn('h-4 w-4 text-ink-mute transition', open && 'rotate-180')} />
            </button>
          )}
          items={[
            { label: isAdmin ? 'Settings' : 'My Profile', icon: isAdmin ? Settings : UserCircle2, onClick: () => navigate(`${base}/${isAdmin ? 'settings' : 'profile'}`) },
            { label: 'Sign out', icon: LogOut, onClick: signOut, danger: true },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-line bg-surface lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-navy/40 dark:bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] animate-fade-up bg-surface shadow-2xl">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-[264px]">
        {session?.previewOf && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-r from-rust to-[#D9671A] px-4 py-2 text-center text-[13px] font-medium text-white">
            <Eye className="h-4 w-4" />
            Previewing {scoped.partner?.name}’s portal as an administrator.
            <button
              type="button"
              onClick={() => {
                actions.login(session.previewOf!, true);
                navigate(`/admin/partners/${session.partnerId}`);
              }}
              className="rounded-lg bg-white/20 px-2.5 py-1 font-semibold transition hover:bg-white/30"
            >
              Exit preview
            </button>
          </div>
        )}
        <Topbar onMenu={() => setMobileOpen(true)} onSignOut={signOut} />
        <main key={location.pathname} className="mx-auto max-w-[1440px] animate-fade-up px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Topbar({ onMenu, onSignOut }: { onMenu: () => void; onSignOut: () => void }) {
  const { session } = useStore();
  const scoped = useScoped();
  const navigate = useNavigate();
  const isAdmin = session?.role === 'admin';

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <IconButton icon={MenuIcon} label="Open menu" className="lg:hidden" onClick={onMenu} />
        <div className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-heading md:flex">
          <Building2 className="h-4 w-4 text-ink-mute" />
          {isAdmin ? 'Head Office' : scoped.partner?.city ?? 'Workspace'}
          <Badge tone={isAdmin ? 'navy' : 'orange'} className="ml-1">
            {isAdmin ? 'Admin' : 'Partner'}
          </Badge>
        </div>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-1">
          <ThemeMenu />
          <Notifications />
          <div className="mx-2 hidden h-8 w-px bg-line sm:block" />
          <Menu
            width="w-60"
            trigger={(open) => (
              <button type="button" className="flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-canvas" aria-label="Profile menu">
                <Avatar name={session?.name ?? 'U'} size={34} />
                <ChevronDown className={cn('hidden h-4 w-4 text-ink-mute transition sm:block', open && 'rotate-180')} />
              </button>
            )}
            items={[
              { label: isAdmin ? 'Settings' : 'My Profile', icon: isAdmin ? Settings : UserCircle2, onClick: () => navigate(`${scoped.base}/${isAdmin ? 'settings' : 'profile'}`) },
              { label: 'Sign out', icon: LogOut, onClick: onSignOut, danger: true },
            ]}
          />
        </div>
      </div>
    </header>
  );
}


function GlobalSearch() {
  const scoped = useScoped();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const out: { label: string; sub: string; to: string; kind: string }[] = [];
    scoped.students
      .filter((s) => matches(q, fullName(s), s.email, s.passportNo))
      .slice(0, 5)
      .forEach((s) => out.push({ label: fullName(s), sub: s.email, to: `${scoped.base}/students/${s.id}`, kind: 'Student' }));
    scoped.applications
      .filter((a) => matches(q, a.ref))
      .slice(0, 3)
      .forEach((a) => out.push({ label: a.ref, sub: a.status, to: `${scoped.base}/applications?open=${a.id}`, kind: 'Application' }));
    if (scoped.isAdmin)
      scoped.partners
        .filter((p) => matches(q, p.name, p.code, p.city))
        .slice(0, 3)
        .forEach((p) => out.push({ label: p.name, sub: p.city, to: `/admin/partners/${p.id}`, kind: 'Partner' }));
    scoped.universities
      .filter((u) => matches(q, u.name))
      .slice(0, 3)
      .forEach((u) =>
        out.push({ label: u.name, sub: `${countryFlag[u.country] ?? ''} ${u.country}`, to: scoped.isAdmin ? `/admin/providers?q=${encodeURIComponent(u.name)}` : `/client/course-finder?university=${u.id}`, kind: 'University' }),
      );
    return out;
  }, [q, scoped]);

  const go = (to: string) => {
    setQ('');
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="relative mx-auto hidden w-full max-w-md sm:block" ref={ref}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) go(results[0].to);
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search students, applications, universities…"
        aria-label="Global search"
        className="h-10 w-full rounded-xl border border-line bg-canvas/70 pl-10 pr-14 text-sm placeholder:text-ink-mute focus:border-brand focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand/15"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-mute">⌘K</kbd>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-40 animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lift">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink-mute">No results for “{q}”</div>
          ) : (
            results.map((r, i) => (
              <button key={i} type="button" onClick={() => go(r.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-canvas">
                <Badge tone={r.kind === 'Student' ? 'orange' : r.kind === 'Partner' ? 'navy' : r.kind === 'Application' ? 'blue' : 'slate'}>{r.kind}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-heading">{r.label}</span>
                  <span className="block truncate text-xs text-ink-mute">{r.sub}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { db, session, actions } = useStore();
  const scoped = useScoped();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const readAt = session?.role === 'client' && session.partnerId ? db.readAt.client[session.partnerId] ?? '' : db.readAt.admin;
  const items = scoped.activities.slice(0, 12);
  const unread = items.filter((a) => a.at > readAt).length;

  return (
    <div className="relative" ref={ref}>
      <IconButton icon={Bell} label="Notifications" badge={unread} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="fixed inset-x-3 top-[72px] z-40 animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[380px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="font-display text-sm font-semibold text-heading">Notifications</div>
              <div className="text-xs text-ink-mute">{unread} unread</div>
            </div>
            <button type="button" onClick={() => actions.markNotificationsRead()} className="flex items-center gap-1 text-xs font-semibold text-rust hover:underline">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[380px] overflow-y-auto p-1.5">
            {items.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-mute">You’re all caught up.</div>}
            {items.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(`${scoped.base}/${a.kind === 'update' ? 'updates' : a.kind === 'student' ? 'students' : a.kind === 'document' ? 'documents' : a.kind === 'partner' ? 'partners' : a.kind === 'assessment' ? 'assessments' : a.kind === 'payment' ? 'finance' : 'applications'}`);
                }}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-canvas"
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.at > readAt ? 'bg-rust' : 'bg-transparent')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-heading">{a.title}</span>
                  <span className="block truncate text-xs text-ink-soft">{a.detail}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-mute">{timeAgo(a.at)}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(`${scoped.base}/${session?.role === 'admin' ? 'dashboard' : 'updates'}`);
              }}
              className="w-full rounded-lg py-2 text-center text-xs font-semibold text-heading hover:bg-canvas"
            >
              {session?.role === 'admin' ? 'Back to dashboard' : 'View important updates'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

