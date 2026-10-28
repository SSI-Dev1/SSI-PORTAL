import { useEffect, useRef, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ThemeProvider } from './theme/theme';
import { watchAuth } from './auth/auth';
import { useToast } from './components/feedback';
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

function RequireRole({ role, children }: { role: 'admin' | 'client'; children: ReactNode }) {
  const { session } = useStore();
  if (!session) return <Navigate to="/login" replace />;
  if (session.role !== role) return <Navigate to={`/${session.role}/dashboard`} replace />;
  return <>{children}</>;
}

/**
 * Mirrors the Supabase auth session into the app session (OAuth redirects,
 * expiry, sign-out elsewhere). No-op in demo mode.
 */
function AuthSync() {
  const { session, actions } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const ref = useRef(session);
  ref.current = session;

  useEffect(
    () =>
      watchAuth(
        (s) => {
          const cur = ref.current;
          // Keep an admin's partner preview, and avoid re-logging an identical session.
          if (cur?.previewOf?.email === s.email || (cur?.email === s.email && cur.role === s.role)) return;
          actions.login(s, true);
          navigate(`/${s.role}/dashboard`, { replace: true });
        },
        () => {
          // With a backend configured, any app session without a Supabase session
          // (including stale prototype sessions) is dropped.
          if (ref.current) {
            actions.logout();
            navigate('/login', { replace: true });
          }
        },
        (msg) => toast.error('Sign-in failed', msg),
      ),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return null;
}

function Home() {
  const { session } = useStore();
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
      <StoreProvider>
        <FeedbackProvider>
          <HashRouter>
            <AuthSync />
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
        </FeedbackProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
