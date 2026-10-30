// My Profile (employee workspace): HR record (read-only) and account settings.
import { Badge, Card, CardHeader } from '../../components/ui';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { fmtDay } from '../../data/hr';
import Settings from '../admin/Settings';

export default function MyProfile() {
  const { data } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const me = data.employees.find((e) => e.id === session?.userId);
  const shift = lk.shift.get(me?.shiftId ?? '');
  const rows: [string, React.ReactNode][] = me ? [
    ['Employee ID', me.employeeCode],
    ['Designation', [me.designationId, ...me.additionalDesignations].map((d) => lk.designation.get(d)?.name ?? d).join(' · ')],
    ['Department', lk.department.get(me.departmentId ?? '')?.name ?? '—'],
    ['Reporting manager', me.reportingManagerId ? lk.name(me.reportingManagerId) : '—'],
    ['Joining date', fmtDay(me.joiningDate)],
    ['Employment status', <Badge key="s" tone={me.employmentStatus === 'Active' ? 'green' : me.employmentStatus === 'Probation' ? 'amber' : 'slate'}>{me.employmentStatus}</Badge>],
    ['Shift', shift ? `${shift.name}${shift.flexible ? '' : ` · ${shift.startTime?.slice(0, 5)}–${shift.endTime?.slice(0, 5)}`}` : '—'],
    ['Work location', me.workLocation ?? '—'],
  ] : [];
  return (
    <>
      {me && (
        <Card className="mb-6">
          <CardHeader title="Employment details" subtitle="Maintained by HR. Ask HR to correct anything here." />
          <dl className="grid gap-x-8 gap-y-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="mt-1 text-sm text-heading">{v}</dd></div>
            ))}
          </dl>
        </Card>
      )}
      <Settings />
    </>
  );
}
