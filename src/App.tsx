import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ThemeProvider } from './theme/theme';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { StoreProvider, useStore } from './store/store';
import { FeedbackProvider } from './components/feedback';
import AppShell from './layouts/AppShell';
import Login from './pages/Login';
import AdminDashboard from './pages/admin/AdminDashboard';
import Partners from './pages/admin/Partners';
import PartnerDetail from './pages/admin/PartnerDetail';
import Providers from './pages/admin/Providers';
import Courses from './pages/admin/Courses';
import Tasks from './pages/admin/Tasks';
import UpdatesAdmin from './pages/admin/UpdatesAdmin';
import Reports from './pages/admin/Reports';
import Settings from './pages/admin/Settings';
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

// UX routing only — authorisation is enforced by the database (RLS), not by this guard.
function RequireRole({ role, children }: { role: 'admin' | 'client'; children: ReactNode }) {
  const { status } = useAuth();
  const { session } = useStore();
  if (status === 'loading') return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (session.role !== role) return <Navigate to={`/${session.role}/dashboard`} replace />;
  return <>{children}</>;
}

function Home() {
  const { status } = useAuth();
  const { session } = useStore();
  if (status === 'loading') return <FullScreenLoader />;
  return <Navigate to={session ? `/${session.role}/dashboard` : '/login'} replace />;
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

export default function App() {
  return (
    <ThemeProvider>
      <FeedbackProvider>
        <AuthProvider>
          <StoreProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
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
                <Route path="settings" element={<Settings />} />
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
          </StoreProvider>
        </AuthProvider>
      </FeedbackProvider>
    </ThemeProvider>
  );
}
