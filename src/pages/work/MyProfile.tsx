// My Profile (employee workspace): personal and employment details, attendance overview,
// leave balance and history, working hours and daily reports — the same profile HR opens,
// limited by the database to this employee's own records — then account settings.
import { CardHeader, Card } from '../../components/ui';
import { EmployeeProfile } from '../../components/hrProfile';
import { useStore } from '../../store/store';
import Settings from '../admin/Settings';

export default function MyProfile() {
  const { session } = useStore();
  return (
    <>
      {session?.employee && <div className="mb-6"><EmployeeProfile employeeId={session.userId} self /></div>}
      <Card className="mb-4"><CardHeader title="Account settings" subtitle="Password, sign-in security and appearance." /></Card>
      <Settings />
    </>
  );
}
