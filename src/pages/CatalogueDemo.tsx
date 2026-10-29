// Development-only harness (route #/ui/courses): the real Course Finder and Admin Courses pages
// fed with two course records exported from a local test database after the CourseFinder import
// (public university course data). Edits are kept in memory only.
import { useMemo, useState } from 'react';
import CourseFinder from './client/CourseFinder';
import Courses from './admin/Courses';
import { Button, Card } from '../components/ui';
import { StoreContext, type StoreValue } from '../store/store';
import type { Course, CourseIntake, DB, University } from '../data/types';
import sample from './dev-fixtures/coursefinder-sample.json';

type Raw = Course & { _intakes: { month: number; year: number; notes: string | null; status: CourseIntake['status'] }[] };

export default function CatalogueDemo() {
  const [view, setView] = useState<'finder' | 'admin'>('finder');
  const [courses, setCourses] = useState<Course[]>(() => (sample.courses as unknown as Raw[]).map(({ _intakes: _i, ...c }) => c));
  const [uni, setUni] = useState<University>(sample.university as unknown as University);
  const intakes: CourseIntake[] = useMemo(
    () => (sample.courses as unknown as Raw[]).flatMap((c) => c._intakes.map((i, n) => ({ id: `${c.id}-${n}`, courseId: c.id, intakeMonth: i.month, intakeYear: i.year, status: i.status, active: true, notes: i.notes }))),
    [],
  );
  const value = useMemo(() => {
    const db = {
      universities: [uni], courses, courseIntakes: intakes, blacklist: [], students: [], applications: [], partners: [], documents: [], assessments: [], payments: [],
      tasks: [], announcements: [], activities: [], notifications: [], staff: [],
    } as unknown as DB;
    const session = view === 'admin'
      ? { role: 'admin', userRole: 'super_admin', userId: 'demo', name: 'Demo', email: '', title: '', permissions: ['catalogue'], partnerModules: [] }
      : { role: 'client', userRole: 'partner_admin', userId: 'demo', partnerId: 'demo-p', name: 'Demo', email: '', title: '', permissions: [], partnerModules: [] };
    const actions = {
      updateCourse: (id: string, patch: Partial<Course>) => setCourses((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))),
      updateUniversity: (_id: string, patch: Partial<University>) => setUni((u) => ({ ...u, ...patch })),
      addCourse: () => undefined, removeCourse: () => undefined,
    };
    return { db, session, actions, loading: false, live: 'live', profilesRev: 0 } as unknown as StoreValue;
  }, [courses, uni, intakes, view]);
  return (
    <StoreContext.Provider value={value}>
      <div className="min-h-screen space-y-4 bg-canvas p-6">
        <Card className="flex flex-wrap items-center gap-2 p-4 text-sm text-ink-soft">
          Dev harness — {courses.length} sample courses
          <Button size="sm" variant={view === 'finder' ? 'primary' : 'secondary'} onClick={() => setView('finder')}>Partner Course Finder</Button>
          <Button size="sm" variant={view === 'admin' ? 'primary' : 'secondary'} onClick={() => setView('admin')}>Admin Courses</Button>
        </Card>
        {view === 'finder' ? <CourseFinder /> : <Courses />}
      </div>
    </StoreContext.Provider>
  );
}
