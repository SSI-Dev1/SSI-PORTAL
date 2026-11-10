// Departments and Designations (HR Portal → People). HR with "hr_accounts" and Super Admins add
// and edit them; what a designation grants (role, permissions, workspace, report template) stays a
// Super Admin decision — the database enforces both (0025_hr_org_structure.sql).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Building2, Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, Checkbox, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, SearchInput, Select, Table, Textarea } from '../../components/ui';
import { exportCsv } from '../../components/hr';
import { useStore } from '../../store/store';
import { useHR, useHRLookup } from '../../store/hr';
import { companyDate, type Department, type Designation } from '../../data/hr';
import { matches } from '../../lib/utils';

function useCanManage() {
  const { session } = useStore();
  const isSuper = session?.userRole === 'super_admin';
  return { isSuper, canManage: isSuper || (session?.permissions ?? []).includes('hr_accounts') };
}

const current = (s: { employmentStatus: string; accountStatus: string }) => s.employmentStatus !== 'Resigned' && s.accountStatus === 'active';

// ------------------------------------------------------------------ departments

export function Departments() {
  const { data } = useHR();
  const lk = useHRLookup();
  const navigate = useNavigate();
  const { canManage } = useCanManage();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Department> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const today = companyDate();

  const stats = useMemo(() => new Map(data.departments.map((d) => {
    const members = data.directory.filter((e) => e.departmentId === d.id && current(e));
    const ids = new Set(members.map((m) => m.id));
    const present = data.attendance.filter((a) => a.workDate === today && ids.has(a.employeeId)).length;
    const onLeave = new Set(data.leaveRequests.filter((r) => r.status === 'Approved' && ids.has(r.employeeId) && today >= r.startDate && today <= r.endDate).map((r) => r.employeeId)).size;
    const probation = members.filter((m) => m.employmentStatus === 'Probation').length;
    const designations = data.designations.filter((x) => x.departmentId === d.id).length;
    return [d.id, { members, present, onLeave, probation, designations }] as const;
  })), [data.departments, data.directory, data.attendance, data.leaveRequests, data.designations, today]);

  const rows = data.departments.filter((d) => matches(q, d.name, d.description ?? ''));
  const unassigned = data.directory.filter((e) => !e.departmentId && current(e)).length;
  const selected = open ? data.departments.find((d) => d.id === open) ?? null : null;

  return (
    <>
      <PageHeader title="Departments" subtitle={`${data.departments.filter((d) => d.active).length} active departments · managers, members and today's attendance`}
        actions={<>
          <Button variant="secondary" onClick={() => exportCsv('ssi-departments', data.departments.map((d) => {
            const s = stats.get(d.id);
            return { Department: d.name, Manager: d.managerId ? lk.name(d.managerId) : '', Employees: s?.members.length ?? 0, 'On probation': s?.probation ?? 0,
              Designations: s?.designations ?? 0, [`Present ${today}`]: s?.present ?? 0, [`On leave ${today}`]: s?.onLeave ?? 0, Status: d.active ? 'Active' : 'Inactive' };
          }))}>Export CSV</Button>
          {canManage && <Button icon={Plus} onClick={() => setEditing({ name: '', description: '', managerId: null, active: true })}>Add department</Button>}
        </>} />
      {unassigned > 0 && (
        <Alert tone="warning" className="mb-4">
          {unassigned} current employee{unassigned === 1 ? ' has' : 's have'} no department.{' '}
          <button type="button" className="font-semibold underline" onClick={() => navigate('../hr/employees')}>Open Employees</button> to assign one.
        </Alert>
      )}
      <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="Search departments…" className="w-full sm:w-72" /></div>
      {rows.length === 0 ? <Card><EmptyState icon={Building2} title="No departments" description={canManage ? 'Add a department to organise employees.' : undefined} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => {
            const s = stats.get(d.id)!;
            return (
              <Card key={d.id} hover className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy dark:bg-white/5 dark:text-white"><Building2 className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-display text-[15px] font-semibold text-heading">{d.name}</h3>
                      {!d.active && <Badge tone="slate">Inactive</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{d.description || 'No description'}</p>
                  </div>
                  {canManage && <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${d.name}`} onClick={() => setEditing(d)} />}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Employees" value={s.members.length} />
                  <Stat label="Present today" value={s.present} />
                  <Stat label="On leave" value={s.onLeave} />
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
                  <span className="truncate text-ink-soft">Manager: <span className="font-medium text-heading">{d.managerId ? lk.name(d.managerId) : 'Not assigned'}</span></span>
                  <button type="button" className="shrink-0 font-semibold text-rust hover:underline" onClick={() => setOpen(d.id)}>Members</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <DepartmentDialog value={editing} onClose={() => setEditing(null)} />
      <Modal open={!!selected} onClose={() => setOpen(null)} size="lg" title={selected?.name ?? ''} subtitle={selected ? `${stats.get(selected.id)?.members.length ?? 0} current employees · ${stats.get(selected.id)?.designations ?? 0} designations` : undefined}
        footer={<><Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>{selected && <Button onClick={() => navigate(`../hr/employees?dept=${encodeURIComponent(selected.id)}`)}>Open in Employees</Button>}</>}>
        {selected && (stats.get(selected.id)?.members.length ? (
          <Table className="hr-table" head={['Employee', 'Designation', 'Status', 'Today']}>
            {stats.get(selected.id)!.members.map((m) => {
              const att = data.attendance.find((a) => a.workDate === today && a.employeeId === m.id);
              const leave = data.leaveRequests.some((r) => r.status === 'Approved' && r.employeeId === m.id && today >= r.startDate && today <= r.endDate);
              return (
                <tr key={m.id}>
                  <td><span className="flex items-center gap-2"><Avatar name={m.fullName} size={28} /><span className="font-medium text-heading">{m.fullName}</span>{selected.managerId === m.id && <Badge tone="orange">Manager</Badge>}</span></td>
                  <td>{lk.designation.get(m.designationId)?.name ?? '—'}</td>
                  <td>{m.employmentStatus}</td>
                  <td>{att ? att.state : leave ? 'On leave' : '—'}</td>
                </tr>
              );
            })}
          </Table>
        ) : <EmptyState icon={Users} title="No employees in this department" />)}
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-canvas px-2 py-2">
      <div className="font-display text-lg font-semibold text-heading">{value}</div>
      <div className="text-[11px] text-ink-mute">{label}</div>
    </div>
  );
}

function DepartmentDialog({ value, onClose }: { value: Partial<Department> | null; onClose: () => void }) {
  const { data, write } = useHR();
  const [d, setD] = useState<Partial<Department>>({});
  const [key, setKey] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (value !== key) { setKey(value); setD(value ?? {}); }
  const name = (d.name ?? '').trim();
  const desc = (d.description ?? '').trim();
  const nameErr = name.length < 2 ? 'At least 2 characters' : name.length > 80 ? 'At most 80 characters'
    : data.departments.some((x) => x.id !== d.id && x.name.trim().toLowerCase() === name.toLowerCase()) ? 'A department with this name already exists' : '';
  const managers = data.directory.filter(current);
  const save = async () => {
    if (nameErr || desc.length > 500) return;
    setBusy(true);
    const row = { name, description: desc || null, manager_id: d.managerId || null, active: d.active ?? true };
    const ok = d.id
      ? await write('departments', 'update', row, { id: d.id }, { refresh: ['departments'], success: 'Department saved' })
      : await write('departments', 'insert', row, undefined, { refresh: ['departments'], success: 'Department added' });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal open={!!value} onClose={onClose} title={d.id ? 'Edit department' : 'Add department'} dirty={!!name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !!nameErr || desc.length > 500} onClick={save}>{busy ? 'Saving…' : 'Save department'}</Button></>}>
      <div className="space-y-4">
        <Field label="Department name" required error={d.name !== undefined && name ? nameErr : undefined}>
          <Input value={d.name ?? ''} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Admissions" />
        </Field>
        <Field label="Description" hint={`${desc.length}/500`} error={desc.length > 500 ? 'At most 500 characters' : undefined}>
          <Textarea rows={3} value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What this department is responsible for" />
        </Field>
        <Field label="Department manager" hint="A current employee. Leave empty if none.">
          <Select value={d.managerId ?? ''} searchable onChange={(e) => setD({ ...d, managerId: e.target.value || null })}>
            <option value="">No manager</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.fullName} · {m.employeeCode}</option>)}
          </Select>
        </Field>
        {d.id && <Checkbox checked={d.active ?? true} onCheckedChange={(v) => setD({ ...d, active: v })} label="Active" description="Inactive departments stay on past records but cannot be chosen for new assignments." />}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ designations

export function Designations() {
  const { data } = useHR();
  const lk = useHRLookup();
  const navigate = useNavigate();
  const { canManage, isSuper } = useCanManage();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [editing, setEditing] = useState<Partial<Designation> | null>(null);

  const holders = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.directory.filter(current)) {
      const all = [e.designationId, ...(lk.employee.get(e.id)?.additionalDesignations ?? [])];
      for (const id of new Set(all)) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [data.directory, lk]);
  const rows = data.designations.filter((d) => matches(q, d.name, d.description ?? '', d.id) && (!dept || (dept === '-' ? !d.departmentId : d.departmentId === dept)));

  return (
    <>
      <PageHeader title="Designations" subtitle="Job titles, their department and the access a new account with this title starts with"
        actions={<>
          <Button variant="secondary" onClick={() => exportCsv('ssi-designations', data.designations.map((d) => ({
            Designation: d.name, ID: d.id, Department: lk.department.get(d.departmentId ?? '')?.name ?? '', Employees: holders.get(d.id) ?? 0,
            'Daily report': d.reportTemplate ? 'Yes' : 'No', 'Default role': d.defaultRole, Status: d.active ? 'Active' : 'Inactive',
          })))}>Export CSV</Button>
          {canManage && <Button icon={Plus} onClick={() => setEditing({ id: '', name: '', description: '', departmentId: null, active: true })}>Create designation</Button>}
        </>} />
      {!isSuper && canManage && (
        <Alert tone="info" className="mb-4">
          You can create designations and edit their name, description, department and status. The access a designation grants (role, permissions, workspace and daily report) is set by a Super Admin.
        </Alert>
      )}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search designations…" className="w-full sm:w-72" />
          <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, { value: '-', label: 'No department' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
        </div>
        {rows.length === 0 ? <EmptyState icon={Briefcase} title="No designations found" /> : (
          <Table className="hr-table" head={['Designation', 'Department', 'Employees', 'Daily report', 'Starting access', 'Status', '']}>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <div className="font-medium text-heading">{d.name}</div>
                  {d.description && <div className="max-w-xs truncate text-xs text-ink-mute">{d.description}</div>}
                </td>
                <td>{lk.department.get(d.departmentId ?? '')?.name ?? <span className="text-ink-mute">—</span>}</td>
                <td>
                  <button type="button" className="font-semibold text-heading hover:text-rust hover:underline" onClick={() => navigate(`../hr/employees?desig=${encodeURIComponent(d.id)}`)}>{holders.get(d.id) ?? 0}</button>
                </td>
                <td>{d.reportTemplate ? <Badge tone="green">Required</Badge> : <span className="text-ink-mute">None</span>}</td>
                <td><span className="inline-flex items-center gap-1 text-xs text-ink-soft"><ShieldCheck className="h-3.5 w-3.5" /> {roleLabel(d.defaultRole)}{d.defaultPermissions?.length ? ` · ${d.defaultPermissions.length} modules` : ''}</span></td>
                <td>{d.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</td>
                <td className="text-right">{canManage && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(d)}>Edit</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <DesignationDialog value={editing} onClose={() => setEditing(null)} />
    </>
  );
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin_staff: 'Admin Staff', application_manager: 'Application Manager', assessment_staff: 'Assessment Staff',
  finance_staff: 'Finance Staff', support_staff: 'Support Staff',
};
const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'd_$1').slice(0, 60);

function DesignationDialog({ value, onClose }: { value: Partial<Designation> | null; onClose: () => void }) {
  const { data, write } = useHR();
  const [d, setD] = useState<Partial<Designation>>({});
  const [key, setKey] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (value !== key) { setKey(value); setD(value ?? {}); }
  const isNew = !value?.id;
  const name = (d.name ?? '').trim();
  const desc = (d.description ?? '').trim();
  const id = isNew ? slugify(name) : d.id ?? '';
  const nameErr = name.length < 2 ? 'At least 2 characters' : name.length > 80 ? 'At most 80 characters'
    : data.designations.some((x) => x.id !== value?.id && x.name.trim().toLowerCase() === name.toLowerCase()) ? 'A designation with this name already exists'
    : isNew && (id.length < 2 || data.designations.some((x) => x.id === id)) ? 'Choose a more distinct name' : '';
  const save = async () => {
    if (nameErr || desc.length > 500) return;
    setBusy(true);
    const row = { name, description: desc || null, department_id: d.departmentId || null, active: d.active ?? true };
    const ok = isNew
      ? await write('designations', 'insert', { id, ...row }, undefined, { refresh: ['designations'], success: 'Designation created' })
      : await write('designations', 'update', row, { id: value!.id }, { refresh: ['designations'], success: 'Designation saved' });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal open={!!value} onClose={onClose} title={isNew ? 'Create designation' : 'Edit designation'} dirty={!!name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !!nameErr || desc.length > 500} onClick={save}>{busy ? 'Saving…' : 'Save designation'}</Button></>}>
      <div className="space-y-4">
        <Field label="Designation name" required error={d.name !== undefined && name ? nameErr : undefined}>
          <Input value={d.name ?? ''} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Admissions Officer" />
        </Field>
        <Field label="Description" hint={`${desc.length}/500`} error={desc.length > 500 ? 'At most 500 characters' : undefined}>
          <Textarea rows={3} value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Main responsibilities" />
        </Field>
        <Field label="Department">
          <Select value={d.departmentId ?? ''} onChange={(e) => setD({ ...d, departmentId: e.target.value || null })}>
            <option value="">No department</option>
            {data.departments.filter((x) => x.active || x.id === d.departmentId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        {!isNew && <Checkbox checked={d.active ?? true} onCheckedChange={(v) => setD({ ...d, active: v })} label="Active" description="Inactive designations stay on employees' history and past daily reports but cannot be given to anyone new." />}
        {isNew && <Alert tone="info">New designations start with Support Staff access and no daily report. A Super Admin can change that later.</Alert>}
      </div>
    </Modal>
  );
}
