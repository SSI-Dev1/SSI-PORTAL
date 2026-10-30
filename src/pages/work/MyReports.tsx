// Report history for the signed-in employee (drafts, submitted, returned, approved).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Eye, Pencil } from 'lucide-react';
import { Badge, Button, Card, EmptyState, FilterSelect, PageHeader, Pagination, Table, usePaged } from '../../components/ui';
import { ReportDetailModal, reportTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { REPORT_STATUSES, fmtDay, type DailyReport } from '../../data/hr';
import { formatDateTime } from '../../lib/utils';

export default function MyReports() {
  const { data } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const navigate = useNavigate();
  const base = session?.role === 'admin' ? '/admin' : '/staff';
  const [status, setStatus] = useState('');
  const [viewing, setViewing] = useState<DailyReport>();
  const rows = data.reports.filter((r) => r.employeeId === session?.userId && (!status || r.status === status));
  const paged = usePaged(rows, 15, status);
  return (
    <>
      <PageHeader title="Report History" subtitle="Your daily work reports. Drafts and returned reports can still be edited."
        actions={<Button onClick={() => navigate(`${base}/work/report`)}>Today's report</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...REPORT_STATUSES]} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No reports yet" description="Reports you save or submit appear here." />
        ) : (
          <>
            <Table className="hr-table" head={['Date', 'Designation', 'Status', 'Submitted', 'Reviewer', '']}>
              {paged.rows.map((r) => {
                const editable = r.status === 'Draft' || r.status === 'Correction Requested';
                return (
                  <tr key={r.id}>
                    <td className="font-medium text-heading">{fmtDay(r.reportDate)}</td>
                    <td>{lk.designation.get(r.designationId)?.name ?? r.designationId}</td>
                    <td><Badge tone={reportTone[r.status]} dot>{r.status}</Badge></td>
                    <td className="text-ink-soft">{r.submittedAt ? formatDateTime(r.submittedAt) : '—'}</td>
                    <td className="text-ink-soft">{r.reviewedBy ? lk.name(r.reviewedBy) : '—'}</td>
                    <td className="text-right">
                      {editable ? (
                        <Button size="sm" icon={Pencil} onClick={() => navigate(`${base}/work/report?template=${r.templateId}&date=${r.reportDate}`)}>Edit</Button>
                      ) : (
                        <Button size="sm" variant="secondary" icon={Eye} onClick={() => setViewing(r)}>View</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="reports" />
          </>
        )}
      </Card>
      <ReportDetailModal report={viewing} onClose={() => setViewing(undefined)} />
    </>
  );
}
