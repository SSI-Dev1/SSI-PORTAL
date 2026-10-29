// Development-only gallery (route #/ui/live): the Live Activity table and the Add Partner
// form, for visual checks without signing in. The rows below are clearly fake sample data
// and this file is excluded from production builds.
import { useState } from 'react';
import { LiveActivity } from '../components/LiveActivity';
import { Button } from '../components/ui';
import { PartnerDialog } from './admin/UserManagement';
import type { Activity } from '../data/types';

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const sample: Activity[] = [
  { id: '5', at: ago(1), kind: 'status', title: 'Status changed to Conditional Offer', detail: 'SSI-24107 · Sample University', studentName: 'Sample Student A', actorName: 'Sample Staff', actorRole: 'application_manager', actorOrg: 'SSI GLOBAL · Admissions' },
  { id: '4', at: ago(6), kind: 'student', title: 'New student added', detail: 'Sample Student B', studentName: 'Sample Student B', actorName: 'Sample Partner', actorRole: 'partner_admin', actorOrg: 'Sample Partner Org' },
  { id: '3', at: ago(30), kind: 'document', title: 'Document verified', detail: 'Passport', studentName: 'Sample Student A', actorName: 'Sample Verifier', actorRole: 'assessment_staff', actorOrg: 'SSI GLOBAL · Documents' },
  { id: '2', at: ago(90), kind: 'account', title: 'Account suspended', detail: '', actorName: 'Sample Admin', actorRole: 'super_admin', actorOrg: 'SSI GLOBAL' },
];

export default function RealtimeDemo() {
  const [items, setItems] = useState(sample);
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen space-y-4 bg-canvas p-6 lg:p-10">
      <div className="flex gap-2">
        <Button
          onClick={() =>
            setItems((x) => [{ id: String(Date.now()), at: new Date().toISOString(), kind: 'application', title: 'New application created', detail: 'SSI-24200 · Sample University', studentName: 'Sample Student C', actorName: 'Sample Partner', actorRole: 'partner_staff', actorOrg: 'Sample Partner Org' }, ...x])
          }
        >
          Simulate incoming row (dev only)
        </Button>
        <Button variant="secondary" onClick={() => setOpen(true)}>Open Add Partner form</Button>
      </div>
      <LiveActivity items={items} />
      <PartnerDialog open={open} onClose={() => setOpen(false)} onCreated={async () => setOpen(false)} />
    </div>
  );
}
