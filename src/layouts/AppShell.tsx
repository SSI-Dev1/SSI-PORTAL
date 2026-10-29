import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Building2, CheckCheck, ChevronDown, Eye, Lock, LogOut, Menu as MenuIcon, Search, Settings, UserCircle2 } from 'lucide-react';
import { DesktopSidebar, MobileDrawer, navFor, useSidebarPrefs } from './Sidebar';
import { canOpen } from '../auth/roles';
import { Alert, Avatar, Badge, Button, Card, EmptyState, IconButton, Menu, Modal, useClickOutside } from '../components/ui';
import { useConfirm, useToast } from '../components/feedback';
import { useScoped, useStore } from '../store/store';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { useAuth } from '../auth/AuthProvider';
import { cn, countryFlag, fullName, matches, timeAgo, updateStatus } from '../lib/utils';

export default function AppShell() {
  const { session, loading } = useStore();
  const auth = useAuth();
  const scoped = useScoped();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeDrawer = useCallback(() => setMobileOpen(false), []);
  const sidebarPrefs = useSidebarPrefs();
  const isAdmin = session?.role === 'admin';
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
      await auth.signOut().catch(() => {});
      toast.info('Signed out', 'See you soon.');
      navigate('/login');
    }
  };

  const sharedNav = {
    sections: navFor(session),
    base,
    isAdmin,
    orgName: scoped.partner?.name,
    badges: (!isAdmin && liveUpdates > 0 ? { updates: liveUpdates } : {}) as Record<string, number>,
    user: { name: session?.name ?? 'User', title: session?.title ?? '' },
    menuItems: [
      { label: isAdmin ? 'Settings' : 'My Profile', icon: isAdmin ? Settings : UserCircle2, onClick: () => navigate(`${base}/${isAdmin ? 'settings' : 'profile'}`) },
      { label: 'Sign out', icon: LogOut, onClick: signOut, danger: true },
    ],
  };

  return (
    <div className="min-h-screen bg-canvas">
      <DesktopSidebar shared={sharedNav} prefs={sidebarPrefs} onOpenDrawer={() => setMobileOpen(true)} />
      <MobileDrawer open={mobileOpen} onClose={closeDrawer} shared={sharedNav} />
      <Modal
        open={auth.idleSecondsLeft !== null}
        onClose={auth.stayActive}
        size="sm"
        title="Are you still there?"
        subtitle="For your security, inactive sessions end automatically."
        footer={
          <>
            <Button variant="secondary" onClick={() => void auth.signOut()}>
              Sign out now
            </Button>
            <Button onClick={auth.stayActive} autoFocus>
              Stay signed in
            </Button>
          </>
        }
      >
        <Alert tone="warning" title={`Signing you out in ${auth.idleSecondsLeft ?? 0} seconds`}>
          Any unsaved changes will be lost.
        </Alert>
      </Modal>
      {/* Clears the fixed sidebar; hover-expansion floats over the page instead of pushing it. */}
      <div className={cn('min-w-0 transition-[padding] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] md:pl-[76px]', sidebarPrefs.collapsed ? 'lg:pl-[76px]' : 'lg:pl-[264px]')}>
        {session?.previewOf && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-r from-rust to-[#D9671A] px-4 py-2 text-center text-[13px] font-medium text-white">
            <Eye className="h-4 w-4" />
            Previewing {scoped.partner?.name}’s portal as an administrator.
            <button
              type="button"
              onClick={() => {
                const pid = session.partnerId;
                auth.setPreview(null);
                navigate(`/admin/partners/${pid}`);
              }}
              className="rounded-lg bg-white/20 px-2.5 py-1 font-semibold transition hover:bg-white/30"
            >
              Exit preview
            </button>
          </div>
        )}
        <Topbar onMenu={() => setMobileOpen(true)} onSignOut={signOut} wide={sidebarPrefs.collapsed} />
        <main key={location.pathname} className={cn('mx-auto max-w-[1440px] animate-fade-up px-4 pb-16 pt-6 sm:px-6 lg:px-8', sidebarPrefs.collapsed && 'lg:max-w-[1628px]')}>
          {loading ? (
            <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading data">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-rust border-t-transparent" />
            </div>
          ) : canOpen(session, location.pathname.split('/')[2] ?? '') ? (
            <Outlet />
          ) : (
            // Direct URLs to modules this account may not use (the database returns no data anyway).
            <Card>
              <EmptyState
                icon={Lock}
                title="You don't have access to this section"
                description="Ask a Super Admin to enable it for your account or organisation."
                action={<Button onClick={() => navigate(`${base}/dashboard`)}>Go to dashboard</Button>}
              />
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

function Topbar({ onMenu, onSignOut, wide }: { onMenu: () => void; onSignOut: () => void; wide: boolean }) {
  const { session } = useStore();
  const scoped = useScoped();
  const navigate = useNavigate();
  const isAdmin = session?.role === 'admin';

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-xl">
      {/* Collapsing the sidebar gives its 188px to the page instead of to empty margins. */}
      <div className={cn('mx-auto flex h-[68px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8', wide && 'lg:max-w-[1628px]')}>
        <IconButton icon={MenuIcon} label="Open menu" className="md:hidden" onClick={onMenu} />
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
  const readAt = db.readAt;
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

