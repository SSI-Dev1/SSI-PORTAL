// Development-only harness (route #/ui/shell, registered only when import.meta.env.DEV):
// the real sidebar without a signed-in account, for checking breakpoints, themes and
// keyboard behaviour.
import { useCallback, useState } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { DesktopSidebar, MobileDrawer, navFor, useSidebarPrefs } from '../layouts/Sidebar';
import { Button, Card, CardHeader, IconButton } from '../components/ui';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { cn } from '../lib/utils';
import { orderSections } from '../lib/navOrder';

// "?as=" shows the menu of one department, with that department's live permission set (sample session).
const AS: Record<string, { role: 'admin' | 'staff'; userRole: string; title: string; permissions: string[]; hasTeam: boolean }> = {
  po: { role: 'admin', userRole: 'admin_staff', title: 'Partnership Officer', hasTeam: false,
    permissions: ['partners', 'tasks', 'work_reports', 'partner_onboarding', 'agency_outreach', 'partner_accounts', 'partner_create', 'students_view'] },
  sirm: { role: 'admin', userRole: 'admin_staff', title: 'Senior International Recruitment Manager', hasTeam: true,
    permissions: ['partners', 'students', 'applications', 'assessments', 'documents', 'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'agency_outreach'] },
  pso: { role: 'staff', userRole: 'support_staff', title: 'Partner Success Officer', hasTeam: true,
    permissions: ['students', 'applications', 'catalogue', 'tasks', 'assessments', 'documents', 'updates', 'partner_success', 'leads'] },
  app: { role: 'staff', userRole: 'application_manager', title: 'Application Team', hasTeam: false,
    permissions: ['students', 'applications', 'documents', 'catalogue', 'tasks', 'assessments', 'updates', 'work_reports'] },
};

export default function ShellDemo() {
  const as = AS[new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('as') ?? ''];
  const prefs = useSidebarPrefs();
  const [drawer, setDrawer] = useState(false);
  const [client, setClient] = useState(false);
  const close = useCallback(() => setDrawer(false), []);
  // Customize Sidebar in the harness: kept in memory only (the app saves it to the account).
  const [order, setOrder] = useState<string[] | null>(null);
  const shared = {
    customize: { onSave: async (ids: string[] | null) => { setOrder(ids); return true; } },
    sections: orderSections(navFor((as && !client ? {
      role: as.role, userRole: as.userRole, userId: 'demo', name: 'Demo Employee', email: 'demo@example.com', title: as.title,
      permissions: as.permissions, partnerModules: [], employee: true, hasTeam: as.hasTeam, designations: [],
    } : {
      role: client ? 'client' : 'admin', userRole: client ? 'partner_staff' : 'super_admin', userId: 'demo', name: 'Demo User', email: 'demo@example.com', title: '',
      permissions: ['partners', 'students', 'applications', 'assessments', 'documents', 'finance', 'catalogue', 'tasks', 'updates', 'reports'],
      partnerModules: ['students', 'applications', 'course_finder', 'assessments', 'documents', 'updates'],
    }) as Parameters<typeof navFor>[0]), order),
    base: '/ui/shell',
    portal: (client ? 'client' : 'admin') as 'client' | 'admin',
    orgName: 'Demo Partner Pvt Ltd',
    badges: client ? { updates: 3 } : ({} as Record<string, number>),
  };
  return (
    <div className="min-h-screen bg-canvas">
      <DesktopSidebar shared={shared} prefs={prefs} onOpenDrawer={() => setDrawer(true)} />
      <MobileDrawer open={drawer} onClose={close} shared={shared} />
      <div className={cn('min-w-0 transition-[padding] duration-300 md:pl-[76px]', prefs.collapsed ? 'lg:pl-[76px]' : 'lg:pl-[264px]')}>
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <IconButton icon={MenuIcon} label="Open menu" className="md:hidden" onClick={() => setDrawer(true)} />
          <span className="font-display font-semibold text-heading">Shell demo</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setClient((c) => !c)}>{client ? 'Show admin nav' : 'Show partner nav'}</Button>
            <ThemeMenu />
          </div>
        </header>
        <main className={cn('mx-auto grid max-w-[1440px] gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8', prefs.collapsed && 'lg:max-w-[1628px]')}>
          <Card>
            <CardHeader title="Wide content" subtitle="Should never scroll horizontally" />
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-24 rounded-xl bg-canvas ring-1 ring-line" />
              ))}
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}
