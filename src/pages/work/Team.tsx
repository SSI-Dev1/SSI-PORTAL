// Manager workspace: approvals and reports of the people who report to the manager
// (directly or through their reports). The database limits every row to that team.
import { useMemo, useState } from 'react';
import { ClipboardList, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DatePicker, EmptyState, Field, PageHeader, Table } from '../../components/ui';
import { ApprovalsPanel, AttendanceTable, KPI, ReportDetailModal, reportTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { companyDate, fmtDay, type DailyReport } from '../../data/hr';

export default function Team() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const me = session?.userId;
  const [date, setDate] = useState(companyDate(now()));
  const [viewing, setViewing] = useState<DailyReport>();
  const team = useMemo(() => {
    const ids = new Set<string>();
    const walk = (m: string) => data.employees.filter((e) => e.reportingManagerId === m && !ids.has(e.id)).forEach((e) => { ids.add(e.id); walk(e.id); });
    if (me) walk(me);
    return [...ids];
  }, [data.employees, me]);
  const reports = data.reports.filter((r) => team.includes(r.employeeId) && r.reportDate === date && r.status !== 'Draft');
  const att = data.attendance.filter((a) => team.includes(a.employeeId) && a.workDate === date);
  return (
    <>
      <PageHeader title="My Team" subtitle={`${team.length} people · approvals, daily reports and attendance`} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI icon={Users} label="Team members" value={team.length} />
        <KPI icon={Users} tone="green" label="Present" value={att.length} hint={fmtDay(date)} />
        <KPI icon={ClipboardList} tone="orange" label="Reports submitted" value={reports.length} hint={fmtDay(date)} />
        <KPI icon={ClipboardList} tone="amber" label="Awaiting review" value={data.reports.filter((r) => team.includes(r.employeeId) && (r.status === 'Submitted' || r.status === 'Reviewed')).length} />
      </div>
      <ApprovalsPanel onlyTeam />
      <Card className="mt-6">
        <CardHeader title="Team daily reports" action={<Field><DatePicker value={date} clearable={false} max={companyDate(now())} onChange={(v) => v && setDate(v)} /></Field>} />
        {team.length === 0 ? <EmptyState icon={Users} title="Nobody reports to you yet" /> : (
          <Table className="hr-table" head={['Employee', 'Designation', 'Status', '']}>
            {team.map((id) => {
              const rs = reports.filter((r) => r.employeeId === id);
              return (
                <tr key={id}>
                  <td className="font-medium text-heading">{lk.name(id)}</td>
                  <td>{lk.designation.get(lk.employee.get(id)?.designationId ?? '')?.name ?? '—'}</td>
                  <td>{rs.length ? rs.map((r) => <Badge key={r.id} tone={reportTone[r.status]} className="mr-1">{r.status}</Badge>) : <Badge tone="slate">Not submitted</Badge>}</td>
                  <td className="text-right">{rs.map((r) => <Button key={r.id} size="sm" variant="secondary" onClick={() => setViewing(r)}>Open</Button>)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card className="mt-6 p-5">
        <h3 className="mb-3 font-display text-[15px] font-semibold text-heading">Team attendance · {fmtDay(date)}</h3>
        <AttendanceTable rows={att} showName />
      </Card>
      <ReportDetailModal report={viewing} onClose={() => setViewing(undefined)} canReview />
    </>
  );
}
