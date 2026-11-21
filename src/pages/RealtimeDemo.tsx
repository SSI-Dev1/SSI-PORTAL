// Development-only gallery (route #/ui/live): the Live Activity table, the Add Partner
// form and the course import dialog, for visual checks without signing in. The rows below are clearly fake sample data
// and this file is excluded from production builds.
import { useMemo, useState } from 'react';
import { LiveActivity } from '../components/LiveActivity';
import { Button } from '../components/ui';
import { PartnerDialog } from './admin/UserManagement';
import { CatalogueImportDialog } from '../components/catalogue';
import { ApplicationDetailsModal } from '../components/ApplicationDetailsModal';
import { StoreContext, useStore } from '../store/store';
import type { Application, Session } from '../data/types';
import type { Activity } from '../data/types';

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const sampleApp: Application = {
  id: 'demo-app', ref: 'SSI-00000', studentId: 'demo-s', partnerId: 'demo-p', universityId: 'demo-u', courseId: 'demo-c', intake: 'Jan 2027',
  appliedAt: ago(60 * 24 * 3), status: 'Submitted', assignedTo: null,
  checklist: ['Passport copy', 'Academic transcripts', 'English test result', 'Statement of purpose', 'CV', 'Reference letter'].map((label, i) => ({ label, done: i < 2 })),
  timeline: [
    { status: 'Draft', at: ago(60 * 24 * 3), by: 'Sample Partner', note: 'Application created' },
    { status: 'Pending Assessment', at: ago(60 * 24 * 2), by: 'Sample Partner' },
    { status: 'Submitted', at: ago(60 * 5), by: 'Sample Staff', note: 'Sent to university' },
  ],
};
const sample: Activity[] = [
  { id: '5', at: ago(1), kind: 'status', title: 'Status changed to Conditional Offer', detail: 'SSI-24107 · Sample University', studentName: 'Sample Student A', actorName: 'Sample Staff', actorRole: 'application_manager', actorOrg: 'SSI GLOBAL · Admissions' },
  { id: '4', at: ago(6), kind: 'student', title: 'New student added', detail: 'Sample Student B', studentName: 'Sample Student B', actorName: 'Sample Partner', actorRole: 'partner_admin', actorOrg: 'Sample Partner Org' },
  { id: '3', at: ago(30), kind: 'document', title: 'Document verified', detail: 'Passport', studentName: 'Sample Student A', actorName: 'Sample Verifier', actorRole: 'assessment_staff', actorOrg: 'SSI GLOBAL · Documents' },
  { id: '2', at: ago(90), kind: 'account', title: 'Account suspended', detail: '', actorName: 'Sample Admin', actorRole: 'super_admin', actorOrg: 'SSI GLOBAL' },
];

export default function RealtimeDemo() {
  const [items, setItems] = useState(sample);
  const [open, setOpen] = useState(false);
  const [imp, setImp] = useState(false);
  const [app, setApp] = useState(false);
  // Application details as an employee of each portal (sample sessions; the server is not called with them).
  const [as, setAs] = useState<'admin' | 'po' | 'sirm' | 'pso' | 'app'>('admin');
  const real = useStore();
  const asStaff = useMemo(() => {
    const base = { userId: 'demo-user', email: '', partnerModules: [], employee: true } as const;
    const s: Record<typeof as, Session> = {
      admin: { ...base, role: 'admin', userRole: 'super_admin', name: 'Sample Admin', title: 'Super Admin', permissions: ['applications', 'students'] } as unknown as Session,
      po: { ...base, role: 'admin', userRole: 'admin_staff', name: 'Sample Partnerships', title: 'Partnership Officer', permissions: ['applications', 'agency_outreach'] } as unknown as Session,
      sirm: { ...base, role: 'admin', userRole: 'admin_staff', name: 'Sample Senior IRM', title: 'Senior IRM', permissions: ['applications', 'students'] } as unknown as Session,
      pso: { ...base, role: 'staff', userRole: 'support_staff', name: 'Sample PSO', title: 'Partner Success Officer', permissions: ['applications', 'partner_success'] } as unknown as Session,
      app: { ...base, role: 'staff', userRole: 'application_manager', name: 'Sample Application Team', title: 'Application Team', permissions: ['applications'] } as unknown as Session,
    };
    return { ...real, session: s[as] };
  }, [real, as]);
  return (
    <div className="min-h-screen space-y-4 bg-canvas p-6 lg:p-10">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            setItems((x) => [{ id: String(Date.now()), at: new Date().toISOString(), kind: 'application', title: 'New application created', detail: 'SSI-24200 · Sample University', studentName: 'Sample Student C', actorName: 'Sample Partner', actorRole: 'partner_staff', actorOrg: 'Sample Partner Org' }, ...x])
          }
        >
          Simulate incoming row (dev only)
        </Button>
        <Button variant="secondary" onClick={() => setOpen(true)}>Open Add Partner form</Button>
        <Button variant="secondary" onClick={() => setImp(true)}>Open course import</Button>
        <Button variant="secondary" onClick={() => setApp(true)}>Open application details</Button>
        <select aria-label="Open application details as" value={as} onChange={(e) => setAs(e.target.value as typeof as)} className="rounded-xl border border-line bg-surface px-3 text-sm">
          <option value="admin">as Admin</option><option value="po">as Partnership Officer</option><option value="sirm">as Senior IRM</option>
          <option value="pso">as Partner Success Officer</option><option value="app">as Application Team</option>
        </select>
      </div>
      <LiveActivity items={items} />
      <StoreContext.Provider value={asStaff}>
        <ApplicationDetailsModal app={app ? sampleApp : undefined} onClose={() => setApp(false)} />
      </StoreContext.Provider>
      <CatalogueImportDialog open={imp} onClose={() => setImp(false)} />
      <PartnerDialog open={open} onClose={() => setOpen(false)} onCreated={async () => setOpen(false)} />
    </div>
  );
}
