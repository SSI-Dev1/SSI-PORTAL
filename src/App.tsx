import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ThemeProvider } from './theme/theme';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { TooltipProvider } from './components/ds/controls';
import { StoreProvider, useStore } from './store/store';
import { FeedbackProvider } from './components/feedback';
import AppShell from './layouts/AppShell';
import Login from './pages/Login';
import { lazy, Suspense } from 'react';
// Component gallery for development only; the import is dropped from production builds.
const DesignSystem = import.meta.env.DEV ? lazy(() => import('./pages/DesignSystem')) : null;
const ShellDemo = import.meta.env.DEV ? lazy(() => import('./pages/ShellDemo')) : null;
const UsersDemo = import.meta.env.DEV ? lazy(() => import('./pages/admin/UserManagement')) : null;
const RealtimeDemo = import.meta.env.DEV ? lazy(() => import('./pages/RealtimeDemo')) : null;
const ApplicationFormDemo = import.meta.env.DEV ? lazy(() => import('./pages/ApplicationFormDemo')) : null;
const CatalogueDemo = import.meta.env.DEV ? lazy(() => import('./pages/CatalogueDemo')) : null;
const HRDemo = import.meta.env.DEV ? lazy(() => import('./pages/HRDemo')) : null;
import AdminDashboard from './pages/admin/AdminDashboard';
import Partners from './pages/admin/Partners';
import PartnerDetail from './pages/admin/PartnerDetail';
import Providers from './pages/admin/Providers';
import Courses from './pages/admin/Courses';
import Tasks from './pages/admin/Tasks';
import UpdatesAdmin from './pages/admin/UpdatesAdmin';
import Reports from './pages/admin/Reports';
import Settings from './pages/admin/Settings';
import UserManagement from './pages/admin/UserManagement';
import StaffDashboard from './pages/staff/StaffDashboard';
import { HRProvider } from './store/hr';
import { isHR } from './auth/roles';
import type { Session } from './data/types';
import WorkDashboard from './pages/work/WorkDashboard';
import MyReport from './pages/work/MyReport';
import MyReports from './pages/work/MyReports';
import MyAttendance from './pages/work/MyAttendance';
import MyLeave from './pages/work/MyLeave';
import Holidays from './pages/work/Holidays';
import Team from './pages/work/Team';
import MyProfile from './pages/work/MyProfile';
import HRDashboard from './pages/hr/HRDashboard';
import Employees from './pages/hr/Employees';
import HRAttendance from './pages/hr/HRAttendance';
import HRLeave from './pages/hr/HRLeave';
import WorkReports from './pages/hr/WorkReports';
import { HRCorrections, HREarlyCheckout } from './pages/hr/HRRequests';
import { HRReminders, HRReports, HRSettings } from './pages/hr/HRMisc';
import ClientDashboard from './pages/client/ClientDashboard';
import CourseFinder from './pages/client/CourseFinder';
import UpdatesClient from './pages/client/UpdatesClient';
import Profile from './pages/client/Profile';
import Students from './pages/shared/Students';
import StudentProfile from './pages/shared/StudentProfile';
import Applications from './pages/shared/Applications';
import Assessments from './pages/shared/Assessments';
import Documents from './pages/shared/Documents';
import Finance from './pages/shared/Finance';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" role="status" aria-label="Loading">
      <Loader2 className="h-7 w-7 animate-spin text-rust" />
    </div>
  );
}

/** Where a user lands after sign-in: Admin → Admin Portal, HR → HR Portal, other employees → their workspace. */
function homeFor(session: Session) {
  if (session.role === 'client' || session.role === 'admin') return `/${session.role}/dashboard`;
  if (isHR(session)) return '/staff/hr/dashboard';
  if (session.employee) return '/staff/work/dashboard';
  return '/staff/dashboard';
}

// UX routing only — authorisation is enforced by the database (RLS), not by this guard.
function RequireRole({ role, children }: { role: 'admin' | 'staff' | 'client'; children: ReactNode }) {
  const { status } = useAuth();
  const { session } = useStore();
  if (status === 'loading') return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.role !== role) return <Navigate to={homeFor(session)} replace />;
  return <>{children}</>;
}

function Home() {
  const { status } = useAuth();
  const { session } = useStore();
  if (status === 'loading') return <FullScreenLoader />;
  return <Navigate to={session ? homeFor(session) : '/login'} replace />;
}

// Shared pages (students, applications…) are mounted under both portals and
// scope their data through useScoped().
const sharedRoutes = (
  <>
    <Route path="students" element={<Students />} />
    <Route path="students/:id" element={<StudentProfile />} />
    <Route path="applications" element={<Applications />} />
    <Route path="assessments" element={<Assessments />} />
    <Route path="documents" element={<Documents />} />
    <Route path="finance" element={<Finance />} />
  </>
);

// Employee workspace and HR portal, mounted under both internal portals (/admin and /staff).
const employeeRoutes = (
  <>
    <Route path="work" element={<Navigate to="dashboard" replace />} />
    <Route path="work/dashboard" element={<WorkDashboard />} />
    <Route path="work/report" element={<MyReport />} />
    <Route path="work/reports" element={<MyReports />} />
    <Route path="work/attendance" element={<MyAttendance />} />
    <Route path="work/leave" element={<MyLeave />} />
    <Route path="work/holidays" element={<Holidays />} />
    <Route path="work/team" element={<Team />} />
    <Route path="work/profile" element={<MyProfile />} />
    <Route path="work-reports" element={<WorkReports />} />
    <Route path="hr" element={<Navigate to="dashboard" replace />} />
    <Route path="hr/dashboard" element={<HRDashboard />} />
    <Route path="hr/employees" element={<Employees />} />
    <Route path="hr/attendance" element={<HRAttendance />} />
    <Route path="hr/hours" element={<HRAttendance initialTab="hours" />} />
    <Route path="hr/leave" element={<HRLeave />} />
    <Route path="hr/early-checkout" element={<HREarlyCheckout />} />
    <Route path="hr/corrections" element={<HRCorrections />} />
    <Route path="hr/holidays" element={<Holidays />} />
    <Route path="hr/work-reports" element={<WorkReports />} />
    <Route path="hr/reminders" element={<HRReminders />} />
    <Route path="hr/reports" element={<HRReports />} />
    <Route path="hr/settings" element={<HRSettings />} />
  </>
);

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
      <FeedbackProvider>
        <AuthProvider>
          <StoreProvider>
          <HRProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
            {HRDemo && (
              <Route
                path="/ui/hr/*"
                element={
                  <Suspense fallback={null}>
                    <HRDemo />
                  </Suspense>
                }
              />
            )}
            {CatalogueDemo && (
              <Route
                path="/ui/courses"
                element={
                  <Suspense fallback={null}>
                    <CatalogueDemo />
                  </Suspense>
                }
              />
            )}
            {ApplicationFormDemo && (
              <Route
                path="/ui/apply"
                element={
                  <Suspense fallback={null}>
                    <ApplicationFormDemo />
                  </Suspense>
                }
              />
            )}
            {RealtimeDemo && (
              <Route
                path="/ui/live"
                element={
                  <Suspense fallback={null}>
                    <RealtimeDemo />
                  </Suspense>
                }
              />
            )}
            {UsersDemo && (
              <Route
                path="/ui/users"
                element={
                  <Suspense fallback={null}>
                    <div className="min-h-screen bg-canvas p-6 lg:p-10"><UsersDemo /></div>
                  </Suspense>
                }
              />
            )}
            {ShellDemo && (
              <Route
                path="/ui/shell/*"
                element={
                  <Suspense fallback={null}>
                    <ShellDemo />
                  </Suspense>
                }
              />
            )}
            {DesignSystem && (
              <Route
                path="/ui"
                element={
                  <Suspense fallback={null}>
                    <DesignSystem />
                  </Suspense>
                }
              />
            )}
              <Route
                path="/admin"
                element={
                  <RequireRole role="admin">
                    <AppShell />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="partners" element={<Partners />} />
                <Route path="partners/:id" element={<PartnerDetail />} />
                {sharedRoutes}
                <Route path="providers" element={<Providers />} />
                <Route path="courses" element={<Courses />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="updates" element={<UpdatesAdmin />} />
                <Route path="reports" element={<Reports />} />
                <Route path="users" element={<UserManagement />} />
                <Route path="settings" element={<Settings />} />
                {employeeRoutes}
              </Route>
              <Route
                path="/staff"
                element={
                  <RequireRole role="staff">
                    <AppShell />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<StaffDashboard />} />
                {sharedRoutes}
                <Route path="providers" element={<Providers />} />
                <Route path="courses" element={<Courses />} />
                <Route path="course-finder" element={<CourseFinder />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="updates" element={<UpdatesAdmin />} />
                <Route path="reports" element={<Reports />} />
                <Route path="profile" element={<Settings />} />
                {employeeRoutes}
              </Route>
              <Route
                path="/client"
                element={
                  <RequireRole role="client">
                    <AppShell />
                  </RequireRole>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<ClientDashboard />} />
                {sharedRoutes}
                <Route path="course-finder" element={<CourseFinder />} />
                <Route path="updates" element={<UpdatesClient />} />
                <Route path="profile" element={<Profile />} />
              </Route>
              <Route path="*" element={<Home />} />
            </Routes>
          </HashRouter>
          </HRProvider>
          </StoreProvider>
        </AuthProvider>
      </FeedbackProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
