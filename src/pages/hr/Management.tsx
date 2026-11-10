// Leadership → Management: reporting lines (who reports to whom, directly and through their
// team), department managers, team size and today's team attendance. Read-only; reporting
// managers are changed on the employee record and department managers on Departments.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, ChevronRight, Crown, UserMinus, Users, UsersRound } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, FilterSelect, PageHeader, SearchInput } from '../../components/ui';
import { ExportButtons, KPI, stateTone } from '../../components/hr';
import { EmployeeProfileModal } from '../../components/hrProfile';
import { useHR, useHRLookup } from '../../store/hr';
import { companyDate, type DirectoryEntry } from '../../data/hr';
import { cn, matches } from '../../lib/utils';

const current = (e: DirectoryEntry) => e.employmentStatus !== 'Resigned' && e.accountStatus === 'active';

export default function Management() {
  const { data, now } = useHR();
  const lk = useHRLookup();
  const navigate = useNavigate();
  const today = companyDate(now());
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [profile, setProfile] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const people = data.directory.filter(current);
  const ids = new Set(people.map((p) => p.id));
  const children = useMemo(() => {
    const m = new Map<string, DirectoryEntry[]>();
    for (const p of people) {
      const mgr = p.reportingManagerId && ids.has(p.reportingManagerId) ? p.reportingManagerId : '';
      m.set(mgr, [...(m.get(mgr) ?? []), p]);
    }
    m.forEach((list) => list.sort((a, b) => (m.get(b.id)?.length ?? 0) - (m.get(a.id)?.length ?? 0) || a.fullName.localeCompare(b.fullName)));
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.directory]);
  const teamOf = (id: string): string[] => (children.get(id) ?? []).flatMap((c) => [c.id, ...teamOf(c.id)]);
  const managers = people.filter((p) => (children.get(p.id)?.length ?? 0) > 0);
  const deptHeads = data.departments.filter((d) => d.active && d.managerId);
  const roots = children.get('') ?? [];
  const noManager = roots.filter((p) => !(children.get(p.id)?.length));
  const attToday = new Map(data.attendance.filter((a) => a.workDate === today).map((a) => [a.employeeId, a]));
  const onLeave = new Set(data.leaveRequests.filter((r) => r.status === 'Approved' && today >= r.startDate && today <= r.endDate).map((r) => r.employeeId));
  const openWork = (id: string) => data.assignments.filter((a) => a.assignedTo === id && a.status !== 'Completed' && a.status !== 'Cancelled').length;
  const avgTeam = managers.length ? Math.round((managers.reduce((s, m) => s + (children.get(m.id)?.length ?? 0), 0) / managers.length) * 10) / 10 : 0;
  const filtering = !!q || !!dept;
  const hit = (p: DirectoryEntry) => matches(q, p.fullName, p.employeeCode, lk.designation.get(p.designationId)?.name) && (!dept || p.departmentId === dept);
  // When filtering, keep a branch if the person or anyone below them matches.
  const visible = (p: DirectoryEntry): boolean => hit(p) || (children.get(p.id) ?? []).some(visible);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const Node = ({ p, depth }: { p: DirectoryEntry; depth: number }) => {
    const kids = (children.get(p.id) ?? []).filter((c) => !filtering || visible(c));
    const team = teamOf(p.id);
    const present = team.filter((id) => attToday.has(id)).length;
    const away = team.filter((id) => onLeave.has(id)).length;
    const a = attToday.get(p.id);
    const open = !collapsed.has(p.id) || filtering;
    const heads = data.departments.filter((d) => d.managerId === p.id);
    return (
      <li>
        <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5', filtering && hit(p) && 'border-brand-300')} style={{ marginLeft: Math.min(depth, 6) * 20 }}>
          {kids.length > 0 ? (
            <button type="button" onClick={() => toggle(p.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${p.fullName}'s team`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-mute hover:bg-canvas hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : <span className="w-6" />}
          <button type="button" onClick={() => setProfile(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <Avatar name={p.fullName} size={34} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-heading hover:text-rust">{p.fullName}{heads.length > 0 && <Crown className="h-3.5 w-3.5 text-brand" aria-label="Department manager" />}</span>
              <span className="block truncate text-xs text-ink-soft">{lk.designation.get(p.designationId)?.name ?? ''}{p.departmentId ? ` · ${lk.department.get(p.departmentId)?.name ?? ''}` : ''}</span>
            </span>
          </button>
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            {heads.map((d) => <Badge key={d.id} tone="orange">Heads {d.name}</Badge>)}
            {team.length > 0 && <Badge tone="navy">{children.get(p.id)?.length} direct · {team.length} total</Badge>}
            {team.length > 0 && <Badge tone="green">{present} in today{away ? ` · ${away} on leave` : ''}</Badge>}
            {openWork(p.id) > 0 && <Badge tone="slate">{openWork(p.id)} open task(s)</Badge>}
            <Badge tone={a ? stateTone[a.state] : onLeave.has(p.id) ? 'blue' : 'slate'}>{a ? a.state : onLeave.has(p.id) ? 'On leave' : 'Not in'}</Badge>
          </span>
        </div>
        {open && kids.length > 0 && <ul className="mt-2 space-y-2">{kids.map((c) => <Node key={c.id} p={c} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  const topLevel = roots.filter((p) => (children.get(p.id)?.length ?? 0) > 0 && (!filtering || visible(p)));
  return (
    <>
      <PageHeader title="Management" subtitle="Reporting lines, team sizes and department leadership. Change a reporting manager on the employee record; department managers on Departments."
        actions={<ExportButtons filename="ssi-reporting-lines" rows={() => people.map((p) => ({
          'Employee ID': p.employeeCode, Employee: p.fullName, Designation: lk.designation.get(p.designationId)?.name ?? '', Department: lk.department.get(p.departmentId ?? '')?.name ?? '',
          'Reports to': p.reportingManagerId ? lk.name(p.reportingManagerId) : '', 'Direct reports': children.get(p.id)?.length ?? 0, 'Total team': teamOf(p.id).length,
          'Heads department': data.departments.filter((d) => d.managerId === p.id).map((d) => d.name).join(', '),
        }))} />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI icon={UsersRound} label="People managers" value={managers.length} hint={`Average ${avgTeam} direct report(s)`} />
        <KPI icon={Crown} tone="orange" label="Department managers" value={deptHeads.length} hint={`${data.departments.filter((d) => d.active && !d.managerId).length} department(s) without one`} onClick={() => navigate('../hr/departments')} />
        <KPI icon={Users} tone="green" label="Current employees" value={people.length} />
        <KPI icon={UserMinus} tone="amber" label="No reporting manager" value={noManager.length} hint="Not part of any team" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Find a person or designation…" className="w-full sm:w-64" />
            <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
            {!filtering && collapsed.size > 0 && <Button size="sm" variant="secondary" onClick={() => setCollapsed(new Set())}>Expand all</Button>}
          </div>
          {topLevel.length === 0 ? <EmptyState icon={UsersRound} title={filtering ? 'Nobody matches' : 'No reporting lines yet'} description={filtering ? undefined : 'Set a reporting manager on employee records to build teams.'} /> : (
            <ul className="space-y-2">{topLevel.map((p) => <Node key={p.id} p={p} depth={0} />)}</ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Department leadership" action={<button type="button" className="text-xs font-semibold text-rust hover:underline" onClick={() => navigate('../hr/departments')}>Manage</button>} />
            {data.departments.filter((d) => d.active).length === 0 ? <EmptyState icon={Building2} title="No departments" /> : (
              <ul className="divide-y divide-line">
                {data.departments.filter((d) => d.active).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="font-medium text-heading">{d.name}</span>
                    {d.managerId ? <button type="button" className="truncate text-ink-soft hover:text-rust hover:underline" onClick={() => setProfile(d.managerId!)}>{lk.name(d.managerId)}</button> : <Badge tone="amber">No manager</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Without a reporting manager" subtitle="Assign one on the employee record" />
            {noManager.length === 0 ? <EmptyState icon={Users} title="Everyone is in a team" /> : (
              <ul className="divide-y divide-line">
                {noManager.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setProfile(p.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-canvas">
                      <Avatar name={p.fullName} size={28} />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-heading">{p.fullName}</span><span className="block truncate text-xs text-ink-soft">{lk.designation.get(p.designationId)?.name}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <EmployeeProfileModal employeeId={profile} onClose={() => setProfile(null)} />
    </>
  );
}
