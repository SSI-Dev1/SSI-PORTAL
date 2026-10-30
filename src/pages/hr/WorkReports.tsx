// Daily Work Reports dashboard (Admin, HR, staff with "work_reports"): who was expected to
// report, who did, review queue, department / designation performance and daily, weekly or
// monthly totals — all from saved reports (nothing is estimated).
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, ClipboardList, Clock, FileText, Hourglass, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DatePicker, DateRangePicker, EmptyState, Field, FilterSelect, PageHeader, Pagination, Segmented, Table, Tabs, usePaged } from '../../components/ui';
import { ExportButtons, KPI, ReportDetailModal, reportTone } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { supabase } from '../../auth/auth';
import { REPORT_STATUSES, addDays, companyDate, fmtDay, isoDow, type DailyReport } from '../../data/hr';

interface Expectation { employeeId: string; fullName: string; designationId: string; departmentId: string | null; managerId: string | null; templateId: string; reportId: string | null; status: string | null; onLeave: boolean; workingDay: boolean }

export default function WorkReports() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const today = companyDate(now());
  const [tab, setTab] = useState<'today' | 'reports' | 'summary'>('today');
  const [date, setDate] = useState(today);
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [emp, setEmp] = useState('');
  const [desig, setDesig] = useState('');
  const [dept, setDept] = useState('');
  const [mgr, setMgr] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const [viewing, setViewing] = useState<DailyReport>();
  const [exp, setExp] = useState<Expectation[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.rpc('report_expectations', { p_date: date }).then(({ data: r }) => {
      if (alive) setExp(((r ?? []) as Record<string, unknown>[]).map((x) => ({
        employeeId: x.employee_id as string, fullName: x.full_name as string, designationId: x.designation_id as string, departmentId: x.department_id as string | null,
        managerId: x.manager_id as string | null, templateId: x.template_id as string, reportId: x.report_id as string | null, status: x.status as string | null,
        onLeave: !!x.on_leave, workingDay: !!x.working_day,
      })));
    });
    return () => {
      alive = false;
    };
  }, [date, data.reports]);
  const match = (r: { employeeId: string; designationId: string; departmentId: string | null; managerId: string | null }) =>
    (!emp || r.employeeId === emp) && (!desig || r.designationId === desig) && (!dept || r.departmentId === dept) && (!mgr || r.managerId === mgr);
  const expected = exp.filter((e) => e.workingDay && !e.onLeave && match(e));
  const submitted = expected.filter((e) => e.status && e.status !== 'Draft');
  const rows = useMemo(() => data.reports.filter((r) => r.reportDate >= (range.from || '0000') && r.reportDate <= (range.to || range.from || '9999')
    && match(r) && (!status || r.status === status)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data.reports, range, emp, desig, dept, mgr, status]);
  const paged = usePaged(rows, 20, `${range.from}${range.to}${emp}${desig}${dept}${mgr}${status}`);

  // Totals per template field for the chosen period buckets.
  const summary = useMemo(() => {
    const bucket = (d: string) => period === 'day' ? d : period === 'month' ? d.slice(0, 7) : addDays(d, 1 - isoDow(d));
    const out = new Map<string, { bucket: string; template: string; count: number; totals: Record<string, number> }>();
    rows.filter((r) => r.status !== 'Draft').forEach((r) => {
      const k = `${bucket(r.reportDate)}|${r.templateId}`;
      const cur = out.get(k) ?? { bucket: bucket(r.reportDate), template: r.templateId, count: 0, totals: {} };
      cur.count++;
      Object.entries(r.metrics).forEach(([f, v]) => (cur.totals[f] = (cur.totals[f] ?? 0) + v));
      out.set(k, cur);
    });
    return [...out.values()].sort((a, b) => b.bucket.localeCompare(a.bucket));
  }, [rows, period]);
  const tplOf = (id: string) => [...data.templates].filter((t) => t.id === id).sort((a, b) => b.version - a.version)[0];
  const byGroup = (key: 'departmentId' | 'designationId') => {
    const g = new Map<string, { exp: number; sub: number }>();
    expected.forEach((e) => {
      const k = e[key] ?? '—';
      const c = g.get(k) ?? { exp: 0, sub: 0 };
      c.exp++;
      if (e.status && e.status !== 'Draft') c.sub++;
      g.set(k, c);
    });
    return [...g.entries()];
  };
  const managers = data.directory.filter((d) => data.directory.some((x) => x.reportingManagerId === d.id));

  return (
    <>
      <PageHeader title="Daily Work Reports" subtitle="Submitted reports, review queue and performance totals — from saved reports only."
        actions={<ExportButtons filename="ssi-daily-reports" rows={() => rows.map((r) => {
          const t = data.templates.find((x) => x.id === r.templateId && x.version === r.templateVersion);
          const fields = Object.fromEntries((t?.sections ?? []).flatMap((s) => s.fields).map((f) => [f.label + (f.type === 'count' ? '' : ' (text)'), f.type === 'count' ? r.metrics[f.key] ?? '' : r.notes[f.key] ?? '']));
          return { Date: r.reportDate, Employee: lk.name(r.employeeId), Designation: lk.designation.get(r.designationId)?.name, Department: lk.department.get(r.departmentId ?? '')?.name ?? '', Manager: r.managerId ? lk.name(r.managerId) : '', Status: r.status, Submitted: r.submittedAt ?? '', ...fields };
        })} />} />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4">
        <FilterSelect label="Employee" value={emp} onChange={setEmp} options={[{ value: '', label: 'Everyone' }, ...data.directory.map((d) => ({ value: d.id, label: d.fullName }))]} />
        <FilterSelect label="Designation" value={desig} onChange={setDesig} options={[{ value: '', label: 'All designations' }, ...data.designations.filter((d) => d.reportTemplate).map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Reporting manager" value={mgr} onChange={setMgr} options={[{ value: '', label: 'Any manager' }, ...managers.map((d) => ({ value: d.id, label: d.fullName }))]} />
      </Card>
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'today', label: 'Day overview' }, { value: 'reports', label: 'Reports', count: rows.length }, { value: 'summary', label: 'Summaries' }]} />

      {tab === 'today' && (
        <>
          <Card className="mb-5 flex flex-wrap items-end gap-3 p-4"><Field label="Date"><DatePicker value={date} max={today} clearable={false} onChange={(v) => v && setDate(v)} /></Field></Card>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KPI icon={Users} label="Employees with a report template" value={new Set(exp.filter(match).map((e) => e.employeeId)).size} />
            <KPI icon={ClipboardList} label="Reports expected" value={expected.length} hint="working day, not on leave" />
            <KPI icon={ClipboardCheck} tone="green" label="Submitted" value={submitted.length} />
            <KPI icon={Hourglass} tone="red" label="Pending" value={expected.length - submitted.length} />
            <KPI icon={Clock} tone="amber" label="Awaiting review" value={exp.filter((e) => match(e) && (e.status === 'Submitted' || e.status === 'Reviewed')).length} />
            <KPI icon={ClipboardCheck} tone="green" label="Approved" value={exp.filter((e) => match(e) && e.status === 'Approved').length} />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            {(['departmentId', 'designationId'] as const).map((k) => (
              <Card key={k}>
                <CardHeader title={k === 'departmentId' ? 'By department' : 'By designation'} subtitle={fmtDay(date)} />
                {byGroup(k).length === 0 ? <EmptyState icon={ClipboardList} title="No reports expected" /> : (
                  <Table className="hr-table" head={['', 'Expected', 'Submitted', 'Rate']}>
                    {byGroup(k).map(([id, c]) => (
                      <tr key={id}><td className="font-medium text-heading">{(k === 'departmentId' ? lk.department.get(id)?.name : lk.designation.get(id)?.name) ?? '—'}</td><td>{c.exp}</td><td>{c.sub}</td><td>{c.exp ? `${Math.round((c.sub / c.exp) * 100)}%` : '—'}</td></tr>
                    ))}
                  </Table>
                )}
              </Card>
            ))}
          </div>
          <Card className="mt-6">
            <CardHeader title="Report status by employee" subtitle={fmtDay(date)} />
            {exp.filter(match).length === 0 ? <EmptyState icon={Users} title="Nobody expected to report" /> : (
              <Table className="hr-table" head={['Employee', 'Designation', 'Reports to', 'Status', '']}>
                {exp.filter(match).map((e) => {
                  const r = data.reports.find((x) => x.id === e.reportId);
                  return (
                    <tr key={e.employeeId + e.templateId}>
                      <td className="font-medium text-heading">{e.fullName}</td>
                      <td>{lk.designation.get(e.designationId)?.name}</td>
                      <td>{e.managerId ? lk.name(e.managerId) : '—'}</td>
                      <td>{e.onLeave ? <Badge tone="blue">On leave</Badge> : !e.workingDay ? <Badge tone="slate">Day off</Badge> : e.status ? <Badge tone={reportTone[e.status as keyof typeof reportTone]}>{e.status}</Badge> : <Badge tone="red">Not submitted</Badge>}</td>
                      <td className="text-right">{r && r.status !== 'Draft' && <Button size="sm" variant="secondary" icon={FileText} onClick={() => setViewing(r)}>Open</Button>}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'reports' && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
            <Field label="Dates"><DateRangePicker from={range.from} to={range.to} onChange={setRange} aria-label="Report dates" /></Field>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'Any status' }, ...REPORT_STATUSES]} />
          </div>
          {rows.length === 0 ? <EmptyState icon={ClipboardList} title="No reports in this period" /> : (
            <>
              <Table className="hr-table" head={['Date', 'Employee', 'Designation', 'Department', 'Status', 'Submitted', '']}>
                {paged.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDay(r.reportDate)}</td>
                    <td className="font-medium text-heading">{lk.name(r.employeeId)}</td>
                    <td>{lk.designation.get(r.designationId)?.name}</td>
                    <td>{lk.department.get(r.departmentId ?? '')?.name ?? '—'}</td>
                    <td><Badge tone={reportTone[r.status]} dot>{r.status}</Badge></td>
                    <td className="text-ink-soft">{r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="text-right"><Button size="sm" variant="secondary" icon={FileText} onClick={() => setViewing(r)}>Open</Button></td>
                  </tr>
                ))}
              </Table>
              <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="reports" />
            </>
          )}
        </Card>
      )}

      {tab === 'summary' && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
            <Field label="Dates"><DateRangePicker from={range.from} to={range.to} onChange={setRange} aria-label="Summary dates" /></Field>
            <Field label="Group by"><Segmented options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} value={period} onChange={setPeriod} /></Field>
          </div>
          {summary.length === 0 ? <EmptyState icon={ClipboardList} title="No submitted reports in this period" /> : (
            <div className="space-y-5 p-5">
              {summary.map((s) => {
                const t = tplOf(s.template);
                return (
                  <section key={`${s.bucket}${s.template}`} className="rounded-2xl border border-line p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="font-display text-sm font-semibold text-heading">{t?.name ?? s.template}</h4>
                      <span className="text-xs text-ink-soft">{period === 'month' ? s.bucket : period === 'week' ? `Week of ${fmtDay(s.bucket)}` : fmtDay(s.bucket)} · {s.count} report(s)</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {(t?.sections ?? []).flatMap((sec) => sec.fields.filter((f) => f.type === 'count')).map((f) => (
                        <div key={f.key} className="flex items-baseline justify-between gap-2 rounded-lg bg-canvas px-3 py-2 text-[13px]">
                          <span className="text-ink-soft">{f.label}</span><b className="tabular-nums text-heading">{s.totals[f.key] ?? 0}</b>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <ReportDetailModal report={viewing} onClose={() => setViewing(undefined)} canReview />
    </>
  );
}
