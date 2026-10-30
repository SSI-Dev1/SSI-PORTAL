// Collapsible navigation for the Admin and Client portals.
//
//  ≥1024px  fixed sidebar: expanded (264px) or icon rail (76px); choice remembered per browser.
//           Only the toggle (or Ctrl/⌘+B) changes it — the sidebar never expands on hover.
//  768–1023 compact icon rail; the expand button opens the full menu as a drawer.
//  <768     hidden; the top-bar menu button opens a slide-out drawer.
import { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import {
  BarChart3,
  BookOpen,
  Building2,
  ArrowLeftRight,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coffee,
  FilePen,
  History,
  LogOut,
  Palmtree,
  Timer,
  UserCog,
  FileStack,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  Settings,
  Sparkles,
  UserCircle2,
  Users,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo, LogoMark } from '../components/brand';
import { Menu, Tooltip } from '../components/ui';
import { cn } from '../lib/utils';
import type { Session } from '../data/types';
import { canOpen, isHR } from '../auth/roles';

export const SIDEBAR_EXPANDED = 264;
export const SIDEBAR_RAIL = 76;

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}
interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

const adminNav: NavSection[] = [
  { id: 'overview', title: 'Overview', items: [
    { to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: 'reports', label: 'Reports', icon: BarChart3 },
  ] },
  { id: 'people', title: 'Partners & Students', items: [
    { to: 'partners', label: 'Clients & Branches', icon: Building2 },
    { to: 'students', label: 'Students', icon: Users },
    { to: 'applications', label: 'Applications', icon: FileStack },
    { to: 'assessments', label: 'Assessments', icon: ClipboardCheck },
  ] },
  { id: 'catalogue', title: 'Catalogue', items: [
    { to: 'providers', label: 'Education Providers', icon: Landmark },
    { to: 'courses', label: 'Courses', icon: BookOpen },
  ] },
  { id: 'operations', title: 'Operations', items: [
    { to: 'documents', label: 'Documents', icon: FileText },
    { to: 'finance', label: 'Finance', icon: Wallet },
    { to: 'tasks', label: 'Tasks & Reminders', icon: ListTodo },
  ] },
  { id: 'comms', title: 'Communication', items: [{ to: 'updates', label: 'Important Updates', icon: Megaphone }] },
  { id: 'workforce', title: 'People', items: [{ to: 'work-reports', label: 'Daily Work Reports', icon: ClipboardList }] },
  { id: 'system', title: 'System', items: [
    { to: 'users', label: 'User Management', icon: UsersRound },
    { to: 'settings', label: 'Settings', icon: Settings },
  ] },
];

// Staff Portal: employees other than Super Admin / Admin Staff. Items still filter by permission.
const staffNav: NavSection[] = [
  { id: 'overview', title: 'Overview', items: [
    { to: 'dashboard', label: 'Staff Dashboard', icon: LayoutDashboard },
    { to: 'reports', label: 'Reports', icon: BarChart3 },
  ] },
  { id: 'work', title: 'My Work', items: [
    { to: 'students', label: 'Students', icon: Users },
    { to: 'applications', label: 'Applications', icon: FileStack },
    { to: 'assessments', label: 'Assessments', icon: ClipboardCheck },
    { to: 'documents', label: 'Document Verification', icon: FileCheck2 },
    { to: 'tasks', label: 'Tasks & Reminders', icon: ListTodo },
    { to: 'course-finder', label: 'Course Finder', icon: Sparkles },
  ] },
  { id: 'operations', title: 'Operations', items: [
    { to: 'finance', label: 'Finance', icon: Wallet },
    { to: 'providers', label: 'Education Providers', icon: Landmark },
    { to: 'courses', label: 'Courses', icon: BookOpen },
    { to: 'updates', label: 'Important Updates', icon: Megaphone },
    { to: 'work-reports', label: 'Daily Work Reports', icon: ClipboardList },
  ] },
  { id: 'account', title: 'Account', items: [{ to: 'profile', label: 'My Profile', icon: UserCircle2 }] },
];

// Employee workspace (self-service): the same for every designation except the report
// template, the team section (managers) and the work tools their permissions allow.
const employeeNav: NavSection[] = [
  { id: 'w-overview', title: 'My Workspace', items: [
    { to: 'work/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: 'work/report', label: 'My Daily Work Report', icon: ClipboardList },
    { to: 'work/reports', label: 'Report History', icon: History },
  ] },
  { id: 'w-time', title: 'Attendance & Leave', items: [
    { to: 'work/attendance', label: 'My Attendance', icon: Clock },
    { to: 'work/leave', label: 'My Leave', icon: Palmtree },
    { to: 'work/holidays', label: 'Holidays', icon: CalendarDays },
  ] },
  { id: 'w-team', title: 'Team', items: [{ to: 'work/team', label: 'Team & Approvals', icon: UsersRound }] },
  { id: 'w-tools', title: 'Work Tools', items: [
    { to: 'applications', label: 'Applications', icon: FileStack },
    { to: 'students', label: 'Students', icon: Users },
    { to: 'course-finder', label: 'Course Finder', icon: Sparkles },
    { to: 'tasks', label: 'Tasks & Reminders', icon: ListTodo },
  ] },
  { id: 'w-account', title: 'Account', items: [{ to: 'work/profile', label: 'My Profile', icon: UserCircle2 }] },
];

const hrNav: NavSection[] = [
  { id: 'hr-overview', title: 'HR', items: [
    { to: 'hr/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: 'hr/employees', label: 'Employees', icon: UserCog },
  ] },
  { id: 'hr-time', title: 'Time', items: [
    { to: 'hr/attendance', label: 'Attendance', icon: Clock },
    { to: 'hr/hours', label: 'Working Hours', icon: Timer },
    { to: 'hr/leave', label: 'Leave Management', icon: Palmtree },
    { to: 'hr/early-checkout', label: 'Early Checkout', icon: LogOut },
    { to: 'hr/corrections', label: 'Attendance Corrections', icon: FilePen },
    { to: 'hr/holidays', label: 'Holiday Calendar', icon: CalendarDays },
  ] },
  { id: 'hr-work', title: 'Work', items: [
    { to: 'hr/work-reports', label: 'Daily Work Reports', icon: ClipboardList },
    { to: 'hr/reminders', label: 'Employee Reminders', icon: Bell },
    { to: 'hr/reports', label: 'HR Reports', icon: BarChart3 },
    { to: 'hr/settings', label: 'Settings', icon: Settings },
  ] },
];

export type WorkspaceId = 'business' | 'hr' | 'work';
export const workspaceOf = (pathname: string): WorkspaceId => {
  const seg = pathname.split('/')[2] ?? '';
  return seg === 'hr' ? 'hr' : seg === 'work' ? 'work' : 'business';
};

/** Workspaces this user can switch between without signing in again. */
export function workspacesFor(session: Session | null, designationName: (id: string) => string) {
  if (!session || session.role === 'client') return [];
  const out: { id: string; label: string; to: string; designation?: string }[] = [
    { id: 'business', label: session.role === 'admin' ? 'Admin Portal' : 'Staff Portal', to: 'dashboard' },
  ];
  if (canOpen(session, 'hr')) out.push({ id: 'hr', label: 'HR Portal', to: isHR(session) ? 'hr/dashboard' : 'hr/employees' });
  for (const d of session.designations ?? []) out.push({ id: `work:${d}`, label: designationName(d), to: 'work/dashboard', designation: d });
  return out;
}

const WS_KEY = 'ssi-workspace';
/** The designation workspace last chosen (UI preference only; the server decides access). */
export function chosenDesignation(session: Session | null) {
  try {
    const v = localStorage.getItem(WS_KEY);
    if (v && session?.designations?.includes(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return session?.designations?.[0];
}
export function chooseDesignation(id: string) {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event('ssi-workspace'));
}

const clientNav: NavSection[] = [
  { id: 'overview', title: 'Overview', items: [{ to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { id: 'students', title: 'Students', items: [
    { to: 'students', label: 'My Students', icon: Users },
    { to: 'applications', label: 'Applications', icon: FileStack },
    { to: 'assessments', label: 'Assessments', icon: ClipboardCheck },
    { to: 'course-finder', label: 'Course Finder', icon: Sparkles },
  ] },
  { id: 'workspace', title: 'Workspace', items: [
    { to: 'documents', label: 'Documents', icon: FileText },
    { to: 'finance', label: 'Finance', icon: Wallet },
  ] },
  { id: 'comms', title: 'Communication', items: [{ to: 'updates', label: 'Important Updates', icon: Megaphone }] },
  { id: 'account', title: 'Account', items: [{ to: 'profile', label: 'My Profile', icon: UserCircle2 }] },
];

/** Menu for this session: only modules its role / organisation may use (the database enforces the same). */
export function navFor(session: Session | null, workspace: WorkspaceId = 'business'): NavSection[] {
  if (!session) return [];
  const sets = session.role === 'client' ? clientNav
    : workspace === 'hr' ? hrNav
    : workspace === 'work' ? employeeNav
    : session.role === 'admin' ? adminNav : staffNav;
  const allowed = (to: string) => {
    if (to === 'work/team') return canOpen(session, 'team');
    if (to.startsWith('hr/') && to !== 'hr/employees') return isHR(session);
    if (to === 'hr/employees') return canOpen(session, 'hr');
    return canOpen(session, to.split('/')[0]);
  };
  return sets.map((s) => ({ ...s, items: s.items.filter((n) => allowed(n.to)) })).filter((s) => s.items.length);
}

// ------------------------------------------------------------------ preferences

const PREF_KEY = 'ssi-sidebar';
interface Prefs {
  collapsed: boolean;
}
function readPrefs(): Prefs {
  try {
    // Older builds also stored `hoverExpand`; it is ignored now.
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return { collapsed: p.collapsed === true };
  } catch {
    return { collapsed: false };
  }
}

export function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setMatch(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return match;
}

export function useSidebarPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(next));
      } catch {
        /* private mode: still works for this visit */
      }
      return next;
    });
  }, []);
  return { ...prefs, update };
}

// ------------------------------------------------------------------ content

interface ContentProps {
  sections: NavSection[];
  base: string;
  collapsed: boolean;
  portal: 'admin' | 'staff' | 'client';
  orgName?: string;
  badges: Record<string, number>;
  /** Workspaces the user can switch between (internal users). */
  workspaces?: { id: string; label: string; to: string; designation?: string }[];
  currentWorkspace?: string;
  onClose?: () => void;
  closedSections: string[];
  onToggleSection: (id: string) => void;
}

function SidebarContent({
  sections,
  base,
  collapsed,
  portal,
  orgName,
  badges,
  workspaces = [],
  currentWorkspace,
  onClose,
  closedSections,
  onToggleSection,
}: ContentProps) {
  const navigate = useNavigate();
  const current = workspaces.find((w) => w.id === currentWorkspace);
  const fade = cn('whitespace-nowrap transition-[opacity,transform] duration-200', collapsed ? 'pointer-events-none -translate-x-1 opacity-0' : 'opacity-100');
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Brand + toggle */}
      <div className={cn('flex h-[76px] shrink-0 items-center', collapsed ? 'justify-center px-3' : 'justify-between gap-2 pl-6 pr-4')}>
        {collapsed ? <LogoMark size={36} /> : <Logo />}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-mute transition hover:bg-canvas hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Portal card */}
      <div className={cn('mx-4 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-navy to-navy-600 text-white transition-all duration-300', collapsed ? 'mb-0 max-h-0 px-3.5 py-0 opacity-0' : 'mb-4 max-h-24 px-3.5 py-3 opacity-100')} aria-hidden={collapsed}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-300">
              {current && current.id !== 'business' ? (current.id === 'hr' ? 'HR Portal' : 'Employee Workspace') : portal === 'admin' ? 'Admin Portal' : portal === 'staff' ? 'Staff Portal' : 'Partner Portal'}
            </div>
            <div className="mt-0.5 truncate text-[13px] font-semibold">
              {current?.designation ? current.label : portal === 'client' ? orgName : orgName || 'SSI GLOBAL · Head Office'}
            </div>
          </div>
          {workspaces.length > 1 && (
            <Menu
              width="w-60"
              trigger={() => (
                <button type="button" aria-label="Switch workspace" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                  <ArrowLeftRight className="h-4 w-4" />
                </button>
              )}
              items={workspaces.map((w) => ({
                label: (w.id === currentWorkspace ? '✓ ' : '') + w.label,
                icon: w.id === 'hr' ? UserCog : w.designation ? Coffee : LayoutDashboard,
                onClick: () => {
                  if (w.designation) chooseDesignation(w.designation);
                  navigate(`${base}/${w.to}`);
                  onClose?.();
                },
              }))}
            />
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4" aria-label="Main">
        {sections.map((section, si) => {
          const closed = !collapsed && closedSections.includes(section.id);
          const listId = `nav-sec-${section.id}`;
          return (
            <div key={section.id} className={si ? 'mt-3' : ''}>
              {collapsed ? (
                si > 0 && <div className="mx-auto mb-3 h-px w-8 bg-line" aria-hidden />
              ) : (
                <button
                  type="button"
                  onClick={() => onToggleSection(section.id)}
                  aria-expanded={!closed}
                  aria-controls={listId}
                  className="group mb-1 flex w-full items-center justify-between rounded-lg px-[17px] py-1 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-ink-mute transition hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <span className="whitespace-nowrap">{section.title}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100', closed && '-rotate-90 opacity-100')} />
                </button>
              )}
              <div id={listId} className={cn('grid transition-[grid-template-rows] duration-200', closed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}>
                <ul className="min-h-0 space-y-0.5 overflow-hidden" aria-label={collapsed ? section.title : undefined}>
                  {section.items.map((item) => {
                    const badge = badges[item.to] ?? 0;
                    return (
                      <li key={item.to}>
                        <Tooltip content={collapsed ? (badge ? `${item.label} (${badge})` : item.label) : undefined} side="right">
                          <NavLink
                            to={`${base}/${item.to}`}
                            tabIndex={closed ? -1 : undefined}
                            aria-label={collapsed ? item.label : undefined}
                            className={({ isActive }) =>
                              cn(
                                'group relative flex h-10 items-center gap-3 rounded-xl px-[17px] text-[14px] font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                                isActive ? 'bg-gradient-to-r from-brand-50 to-brand-50/30 text-rust' : 'text-ink-soft hover:bg-canvas hover:text-heading',
                              )
                            }
                          >
                            {({ isActive }) => (
                              <>
                                {isActive && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-rust" />}
                                <item.icon className={cn('h-[18px] w-[18px] shrink-0 transition', isActive ? 'text-rust' : 'text-ink-mute group-hover:text-heading')} strokeWidth={1.9} />
                                <span className={cn('flex-1 truncate', fade)}>{item.label}</span>
                                {badge > 0 &&
                                  (collapsed ? (
                                    <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-rust ring-2 ring-surface" aria-hidden />
                                  ) : (
                                    <span className="rounded-full bg-rust px-1.5 py-px text-[10.5px] font-bold text-white">{badge}</span>
                                  ))}
                              </>
                            )}
                          </NavLink>
                        </Tooltip>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </nav>

    </div>
  );
}

// ------------------------------------------------------------------ shell pieces

type SharedProps = Omit<ContentProps, 'collapsed' | 'onClose' | 'closedSections' | 'onToggleSection'>;

/** Fixed sidebar for tablet (rail) and desktop (collapsible). */
export function DesktopSidebar({ shared, prefs, onOpenDrawer }: { shared: SharedProps; prefs: ReturnType<typeof useSidebarPrefs>; onOpenDrawer: () => void }) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [closedSections, setClosedSections] = useState<string[]>([]);
  // Tablet always shows the rail; desktop follows the saved choice.
  const collapsed = isDesktop ? prefs.collapsed : true;

  // Keyboard shortcut: Ctrl/⌘ + B toggles the sidebar on desktop.
  useEffect(() => {
    if (!isDesktop) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        prefs.update({ collapsed: !prefs.collapsed });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isDesktop, prefs]);

  const width = collapsed ? SIDEBAR_RAIL : SIDEBAR_EXPANDED;

  return (
    <aside
        style={{ width }}
        className="fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] md:block"
        aria-label="Sidebar"
      >
        <SidebarContent
          {...shared}
          collapsed={collapsed}
          closedSections={closedSections}
          onToggleSection={(id) => setClosedSections((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
        />
        {/* Round toggle on the sidebar edge (stays put while the width animates). */}
        <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
          <button
            type="button"
            onClick={() => {
              if (isDesktop) prefs.update({ collapsed: !prefs.collapsed });
              else onOpenDrawer();
            }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="absolute -right-3.5 top-[24px] z-10 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-ink-mute shadow-sm transition hover:border-rust hover:text-rust focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <ChevronLeft className={cn('h-4 w-4 transition-transform duration-300', collapsed && 'rotate-180')} />
          </button>
        </Tooltip>
    </aside>
  );
}

/** Slide-out navigation for phones (and the full menu on tablets). */
export function MobileDrawer({ open, onClose, shared }: { open: boolean; onClose: () => void; shared: SharedProps }) {
  const [closedSections, setClosedSections] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 animate-fade-in bg-navy/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} aria-hidden />
      <FocusScope trapped loop asChild>
        <aside role="dialog" aria-modal="true" aria-label="Navigation menu" className="absolute inset-y-0 left-0 w-[min(300px,86vw)] animate-slide-in-left bg-surface shadow-2xl">
          <SidebarContent
            {...shared}
            collapsed={false}
            onClose={onClose}
            closedSections={closedSections}
            onToggleSection={(id) => setClosedSections((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
          />
        </aside>
      </FocusScope>
    </div>
  );
}
