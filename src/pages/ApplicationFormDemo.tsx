// Development-only harness (route #/ui/apply): the real Create Application form fed with
// clearly fake sample data. Every 2 seconds the lists are replaced with fresh copies — exactly
// what a live update or background re-sync does — to prove the form keeps its values.
// The fake "server" rejects exact duplicates and ignores repeated ids, like the database.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApplicationForm } from '../components/forms/ApplicationForm';
import { Button, Card } from '../components/ui';
import { StoreContext, type CreateApplicationResult, type StoreValue } from '../store/store';
import type { Application, Course, DB, Student, University } from '../data/types';

const uni = (id: string, name: string): University => ({ id, name, country: 'United Kingdom', city: 'Sample City', ranking: 0, type: 'Public', partnerSince: '2026', website: '' });
const course = (id: string, universityId: string, name: string, intakes: string[]): Course => ({ id, universityId, name, level: 'Postgraduate', field: '', duration: '12 months', tuition: 15000, currency: 'GBP', intakes, ieltsMin: 6 });
const student = (id: string, first: string): Student => ({
  id, partnerId: 'demo-p', firstName: first, lastName: 'Sample', email: `${first.toLowerCase()}@example.com`, phone: '', dob: '', gender: 'Other', nationality: '', passportNo: '',
  address: '', qualification: '', institution: '', gpa: '', graduationYear: '', englishTest: 'Not taken', englishScore: '', preferredCountries: [], preferredLevel: 'Postgraduate',
  preferredIntake: '', budget: '', status: 'Active', createdAt: new Date().toISOString(),
});
const app0: Application = { id: 'demo-a1', ref: 'SSI-DEMO1', studentId: 'demo-s1', partnerId: 'demo-p', universityId: 'demo-u1', courseId: 'demo-c1', intake: 'Jan 2027', appliedAt: new Date().toISOString(), status: 'Submitted', checklist: [], timeline: [] };

export default function ApplicationFormDemo() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [apps, setApps] = useState<Application[]>([app0]);
  const [log, setLog] = useState<string[]>([]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 2000);
    return () => window.clearInterval(t);
  }, []);

  const value = useMemo(() => {
    // New array/object identities on every tick, like a re-fetch.
    const db = {
      universities: [uni('demo-u1', 'Sample University A'), uni('demo-u2', 'Sample University B')],
      courses: [course('demo-c1', 'demo-u1', 'MSc Sample One', ['Jan 2027', 'Sep 2027']), course('demo-c2', 'demo-u1', 'MBA Sample', ['Jan 2027']), course('demo-c3', 'demo-u2', 'MSc Sample Two', ['Sep 2027'])],
      students: [student('demo-s1', 'Asha'), student('demo-s2', 'Ben')],
      applications: apps.map((a) => ({ ...a })),
      partners: [], documents: [], assessments: [], payments: [], tasks: [], announcements: [], activities: [], courseIntakes: [], blacklist: [], notifications: [], staff: [],
    } as unknown as DB;
    const createApplication = async (a: Omit<Application, 'id' | 'ref' | 'appliedAt' | 'timeline'>, id: string): Promise<CreateApplicationResult> => {
      await new Promise((r) => setTimeout(r, 600));
      if (seen.current.has(id)) {
        setLog((l) => [...l, `repeat request ${id.slice(0, 8)} ignored (same id)`]);
        return { ok: true, id };
      }
      const dup = apps.find((x) => x.status !== 'Visa Refused' && x.studentId === a.studentId && x.universityId === a.universityId && x.courseId === a.courseId && x.intake.toLowerCase() === a.intake.toLowerCase());
      if (dup) return { ok: false, reason: 'duplicate', existingId: dup.id, existingRef: dup.ref };
      seen.current.add(id);
      setApps((x) => [...x, { ...a, id, ref: `SSI-DEMO${x.length + 1}`, appliedAt: new Date().toISOString(), timeline: [] }]);
      setLog((l) => [...l, `created ${id.slice(0, 8)}`]);
      return { ok: true, id };
    };
    return { db, session: { role: 'client', userRole: 'partner_admin', userId: 'demo', partnerId: 'demo-p', name: 'Demo', email: '', title: '', permissions: [], partnerModules: [] }, actions: { createApplication }, loading: false, live: 'live', profilesRev: 0 } as unknown as StoreValue;
  }, [tick, apps]);

  return (
    <StoreContext.Provider value={value}>
      <div className="min-h-screen space-y-4 bg-canvas p-6">
        <Card className="p-5 text-sm text-ink-soft">
          Dev harness — data refreshed {tick} times · applications: {apps.length}
          <div className="mt-2"><Button onClick={() => setOpen(true)}>Create application</Button></div>
          <pre className="mt-3 text-xs" data-testid="log">{log.join('\n')}</pre>
        </Card>
        <ApplicationForm open={open} onClose={() => setOpen(false)} onSaved={() => undefined} />
      </div>
    </StoreContext.Provider>
  );
}
