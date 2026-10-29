// Development-only harness (route #/ui/shell, registered only when import.meta.env.DEV):
// the real sidebar without a signed-in account, for checking breakpoints, themes and
// keyboard behaviour.
import { useCallback, useState } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { DesktopSidebar, MobileDrawer, navFor, useSidebarPrefs } from '../layouts/Sidebar';
import { Button, Card, CardHeader, IconButton } from '../components/ui';
import { ThemeMenu } from '../components/ThemeSwitcher';
import { cn } from '../lib/utils';

export default function ShellDemo() {
  const prefs = useSidebarPrefs();
  const [drawer, setDrawer] = useState(false);
  const [client, setClient] = useState(false);
  const close = useCallback(() => setDrawer(false), []);
  const shared = {
    sections: navFor({
      role: client ? 'client' : 'admin', userRole: client ? 'partner_staff' : 'super_admin', userId: 'demo', name: 'Demo User', email: 'demo@example.com', title: '',
      permissions: ['partners', 'students', 'applications', 'assessments', 'documents', 'finance', 'catalogue', 'tasks', 'updates', 'reports'],
      partnerModules: ['students', 'applications', 'course_finder', 'assessments', 'documents', 'updates'],
    }),
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
