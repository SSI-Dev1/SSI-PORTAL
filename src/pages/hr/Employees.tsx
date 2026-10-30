// Employee management (Super Admin, and HR with the "hr_accounts" permission).
// New employees are created by the admin-users Edge Function (login + HR record in one step,
// password set by the admin, no invitation). HR records are then edited directly (RLS +
// triggers stop HR from touching Admin accounts or their own designation / manager / rights).
import { useMemo, useState } from 'react';
import { BadgeCheck, KeyRound, MoreHorizontal, Pencil, Power, ShieldCheck, UserPlus, Users, Wallet } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, FilterSelect, Input, Menu, Modal, PageHeader, Pagination, SearchInput, Select, Switch, Table, Tabs, usePaged } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { ExportButtons } from '../../components/hr';
import { useHR, useHRLookup } from '../../store/hr';
import { useStore } from '../../store/store';
import { adminApi, AdminApiError } from '../../lib/adminApi';
import { supabase } from '../../auth/auth';
import { CredentialsOnce, PasswordInput, confirmError, pwError } from '../admin/UserManagement';
import { HR_MANAGEABLE_ROLES, HR_MODULES, ROLE_DEFAULTS, ROLE_LABEL, STAFF_MODULES, STAFF_ROLES, type StaffRole } from '../../auth/roles';
import { EMPLOYMENT_STATUSES, companyDate, fmtDay, type Employee, type EmploymentStatus } from '../../data/hr';
import { cn, matches, money } from '../../lib/utils';

const statusTone = { Active: 'green', Probation: 'amber', Resigned: 'slate' } as const;
const accountTone = { active: 'green', suspended: 'amber', deactivated: 'red' } as const;

export default function Employees() {
  const { data, load } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const isSuper = session?.userRole === 'super_admin';
  const canAccounts = isSuper || (session?.permissions ?? []).includes('hr_accounts');
  const canSalary = isSuper || (session?.permissions ?? []).includes('hr_salary');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [desig, setDesig] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [salaryFor, setSalaryFor] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ title: string; email: string; password: string } | null>(null);
  const emails = useStore().db.staff;
  const rows = useMemo(() => data.directory.filter((e) =>
    matches(q, e.fullName, e.employeeCode, lk.designation.get(e.designationId)?.name) && (!dept || e.departmentId === dept)
    && (!desig || e.designationId === desig || lk.employee.get(e.id)?.additionalDesignations.includes(desig)) && (!status || e.employmentStatus === status)),
  [data.directory, q, dept, desig, status, lk]);
  const paged = usePaged(rows, 15, `${q}${dept}${desig}${status}`);
  // Staff accounts created before HR records existed (or in User Management) need one to get a workspace.
  const missing = emails.filter((s) => !data.directory.some((e) => e.id === s.id) && (isSuper || (HR_MANAGEABLE_ROLES as string[]).includes(s.role)));
  const manageable = (role: string, id: string) => isSuper || (canAccounts && id !== session?.userId && (HR_MANAGEABLE_ROLES as string[]).includes(role));

  const setAccount = async (id: string, next: 'active' | 'suspended' | 'deactivated') => {
    if (!(await confirm({ title: next === 'active' ? 'Activate this account?' : 'Deactivate this account?', message: next === 'active' ? 'The employee can sign in again.' : 'The employee is signed out everywhere and cannot sign in.', confirmLabel: next === 'active' ? 'Activate' : 'Deactivate', danger: next !== 'active' }))) return;
    try {
      await adminApi.setStatus(id, next);
      toast.success(next === 'active' ? 'Account activated' : 'Account deactivated');
      void load(['directory']);
    } catch (e) {
      toast.error('Not changed', e instanceof AdminApiError ? e.message : 'Please try again.');
    }
  };

  return (
    <>
      <PageHeader title="Employees" subtitle={`${data.directory.length} employee records · designations, managers, shifts and access`}
        actions={<>
          <ExportButtons filename="ssi-employees" rows={() => rows.map((e) => {
            const emp = lk.employee.get(e.id);
            return { 'Employee ID': e.employeeCode, Name: e.fullName, Designation: lk.designation.get(e.designationId)?.name, Department: lk.department.get(e.departmentId ?? '')?.name ?? '',
              'Reporting manager': e.reportingManagerId ? lk.name(e.reportingManagerId) : '', 'Joining date': emp?.joiningDate ?? '', 'Employment status': e.employmentStatus,
              Shift: lk.shift.get(emp?.shiftId ?? '')?.name ?? '', 'Account status': e.accountStatus };
          })} />
          {canAccounts && <Button icon={UserPlus} onClick={() => setAdding(true)}>Add Employee</Button>}
        </>} />
      {canAccounts && missing.length > 0 && (
        <Alert tone="warning" title={`${missing.length} staff account(s) without an employee record`} className="mb-5">
          <div className="mt-1 flex flex-wrap gap-2">
            {missing.map((m) => (
              <Button key={m.id} size="sm" variant="secondary" onClick={() => setEditing({ id: m.id, employeeCode: '', designationId: data.designations[0]?.id ?? '', additionalDesignations: [], departmentId: null, reportingManagerId: null, joiningDate: null, employmentStatus: 'Active', probationEndDate: null, dateOfBirth: null, shiftId: data.shifts[0]?.id ?? null, workLocation: null, updatedAt: '' })}>
                Create record · {m.fullName}
              </Button>
            ))}
          </div>
        </Alert>
      )}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, ID or designation…" className="w-full sm:w-72" />
          <FilterSelect label="Department" value={dept} onChange={setDept} options={[{ value: '', label: 'All departments' }, ...data.departments.map((d) => ({ value: d.id, label: d.name }))]} />
          <FilterSelect label="Designation" value={desig} onChange={setDesig} options={[{ value: '', label: 'All designations' }, ...data.designations.map((d) => ({ value: d.id, label: d.name }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'Any status' }, ...EMPLOYMENT_STATUSES]} />
        </div>
        {rows.length === 0 ? <EmptyState icon={Users} title="No employees found" description={canAccounts ? 'Add an employee to create their login and HR record.' : undefined} /> : (
          <>
            <Table className="hr-table" head={['Employee', 'Designation', 'Department', 'Reports to', 'Status', 'Account', ...(canSalary ? ['Salary'] : []), '']}>
              {paged.rows.map((e) => {
                const emp = lk.employee.get(e.id);
                const sal = data.salaries.find((s) => s.employeeId === e.id);
                return (
                  <tr key={e.id}>
                    <td><div className="font-medium text-heading">{e.fullName}</div><div className="text-xs text-ink-mute">{e.employeeCode} · {emails.find((s) => s.id === e.id)?.role ? ROLE_LABEL[e.role as StaffRole] : e.role}</div></td>
                    <td>{lk.designation.get(e.designationId)?.name}{(emp?.additionalDesignations.length ?? 0) > 0 && <div className="text-xs text-ink-mute">+ {emp!.additionalDesignations.map((d) => lk.designation.get(d)?.name).join(', ')}</div>}</td>
                    <td>{lk.department.get(e.departmentId ?? '')?.name ?? '—'}</td>
                    <td>{e.reportingManagerId ? lk.name(e.reportingManagerId) : '—'}</td>
                    <td><Badge tone={statusTone[e.employmentStatus]}>{e.employmentStatus}</Badge></td>
                    <td><Badge tone={accountTone[e.accountStatus as keyof typeof accountTone] ?? 'slate'}>{e.accountStatus}</Badge></td>
                    {canSalary && <td className="tabular-nums">{sal ? money(sal.amount, sal.currency) : '—'}</td>}
                    <td className="text-right">
                      {manageable(e.role, e.id) || canSalary ? (
                        <Menu
                          trigger={() => <Button size="sm" variant="secondary" icon={MoreHorizontal} aria-label={`Actions for ${e.fullName}`} />}
                          items={[
                            ...(manageable(e.role, e.id) && emp ? [{ label: 'Edit employee', icon: Pencil, onClick: () => setEditing(emp) }] : []),
                            ...(canSalary ? [{ label: 'Salary', icon: Wallet, onClick: () => setSalaryFor(e.id) }] : []),
                            ...(manageable(e.role, e.id) ? [
                              { label: 'Reset password', icon: KeyRound, onClick: () => setResetFor(e.id) },
                              e.accountStatus === 'active'
                                ? { label: 'Deactivate account', icon: Power, danger: true, onClick: () => setAccount(e.id, 'deactivated') }
                                : { label: 'Activate account', icon: BadgeCheck, onClick: () => setAccount(e.id, 'active') },
                            ] : []),
                          ]}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="employees" />
          </>
        )}
      </Card>
      {canAccounts && <AddEmployeeModal open={adding} onClose={() => setAdding(false)} onCreated={(c) => { setCreds(c); void load(); }} />}
      <EditEmployeeModal employee={editing} onClose={() => setEditing(null)} />
      {canSalary && <SalaryModal employeeId={salaryFor} onClose={() => setSalaryFor(null)} />}
      <ResetPasswordModal userId={resetFor} onClose={() => setResetFor(null)} onDone={setCreds} />
      <CredentialsOnce data={creds} onClose={() => setCreds(null)} />
    </>
  );
}

// ------------------------------------------------------------------ add employee

type NewEmployee = {
  fullName: string; email: string; phone: string; password: string; confirm: string; mustChange: boolean;
  role: StaffRole; permissions: string[];
  employeeCode: string; designationId: string; additional: string[]; departmentId: string; managerId: string;
  joiningDate: string; status: EmploymentStatus; probationEnd: string; dob: string; shiftId: string; location: string;
  salary: string; currency: string;
};

function AddEmployeeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: { title: string; email: string; password: string }) => void }) {
  const { data } = useHR();
  const { session } = useStore();
  const toast = useToast();
  const isSuper = session?.userRole === 'super_admin';
  const canSalary = isSuper || (session?.permissions ?? []).includes('hr_salary');
  const roles = isSuper ? STAFF_ROLES : HR_MANAGEABLE_ROLES;
  const fresh = (): NewEmployee => ({
    fullName: '', email: '', phone: '', password: '', confirm: '', mustChange: true, role: 'support_staff', permissions: [...ROLE_DEFAULTS.support_staff],
    employeeCode: '', designationId: '', additional: [], departmentId: '', managerId: '', joiningDate: companyDate(), status: 'Probation',
    probationEnd: '', dob: '', shiftId: data.shifts[0]?.id ?? '', location: '', salary: '', currency: 'INR',
  });
  const [d, setD] = useState<NewEmployee>(fresh);
  const [step, setStep] = useState<'details' | 'access'>('details');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [key, setKey] = useState(false);
  if (open !== key) {
    setKey(open);
    if (open) { setD(fresh()); setStep('details'); setTried(false); }
  }
  const set = <K extends keyof NewEmployee>(k: K, v: NewEmployee[K]) => setD((x) => ({ ...x, [k]: v }));
  const pickDesignation = (id: string) => {
    const des = data.designations.find((x) => x.id === id);
    if (!des) return set('designationId', id);
    const role = (roles as readonly string[]).includes(des.defaultRole) ? (des.defaultRole as StaffRole) : d.role;
    setD((x) => ({ ...x, designationId: id, departmentId: x.departmentId || des.departmentId || '', role,
      permissions: (des.defaultPermissions ?? ROLE_DEFAULTS[role]).filter((m) => isSuper || !HR_MODULES.includes(m as never)) }));
  };
  const errors = {
    fullName: d.fullName.trim().length < 2 ? 'Enter the full name.' : undefined,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()) ? undefined : 'Enter a valid email.',
    employeeCode: /^[A-Za-z0-9._/-]{1,30}$/.test(d.employeeCode.trim()) ? undefined : 'Letters, numbers and . _ / - (max 30).',
    designationId: d.designationId ? undefined : 'Choose a designation.',
    password: pwError(d.password, d.email),
    confirm: confirmError(d.password, d.confirm),
    salary: d.salary && !(Number(d.salary) >= 0) ? 'Enter a valid amount.' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const submit = async () => {
    setTried(true);
    if (!valid) return setStep('details');
    setBusy(true);
    try {
      await adminApi.createEmployee({
        email: d.email.trim(), fullName: d.fullName.trim(), role: d.role, permissions: d.role === 'super_admin' ? null : d.permissions,
        password: d.password, mustChangePassword: d.mustChange, phone: d.phone || undefined,
        employee: {
          employee_code: d.employeeCode.trim(), designation_id: d.designationId, additional_designations: d.additional, department_id: d.departmentId || null,
          reporting_manager_id: d.managerId || null, joining_date: d.joiningDate || null, employment_status: d.status, probation_end_date: d.probationEnd || null,
          date_of_birth: d.dob || null, shift_id: d.shiftId || null, work_location: d.location || null,
        },
        salary: canSalary && d.salary ? { amount: Number(d.salary), currency: d.currency } : null,
      });
      toast.success('Employee created', `${d.fullName} can sign in now.`);
      onCreated({ title: `${d.fullName}'s login`, email: d.email.trim(), password: d.password });
      onClose();
    } catch (e) {
      toast.error('Employee not created', e instanceof AdminApiError ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const err = (k: keyof typeof errors) => (tried ? errors[k] : undefined);
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Add employee" subtitle="Creates the login (password set by you, no invitation) and the HR record together."
      dirty={!!(d.fullName || d.email || d.employeeCode)}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {step === 'details' ? <Button onClick={() => setStep('access')}>Next: access</Button> : <Button disabled={busy} icon={ShieldCheck} onClick={submit}>{busy ? 'Creating…' : 'Save & activate'}</Button>}
      </>}>
      <Tabs className="mb-5" value={step} onChange={setStep} tabs={[{ value: 'details', label: '1 · Employee details' }, { value: 'access', label: '2 · Password & access' }]} />
      {step === 'details' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={err('fullName')}><Input value={d.fullName} onChange={(e) => set('fullName', e.target.value)} autoFocus /></Field>
          <Field label="Employee ID" required error={err('employeeCode')}><Input value={d.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} placeholder="e.g. SSI-014" /></Field>
          <Field label="Work email" required error={err('email')}><Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Phone"><Input value={d.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Designation" required error={err('designationId')}>
            <Select value={d.designationId} onChange={(e) => pickDesignation(e.target.value)}>
              <option value="">Select designation…</option>
              {data.designations.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={d.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">—</option>
              {data.departments.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Additional roles (workspaces)" hint="The employee can switch between these without signing in again" className="sm:col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {data.designations.filter((x) => x.active && x.id !== d.designationId).map((x) => {
                const on = d.additional.includes(x.id);
                return <button key={x.id} type="button" onClick={() => set('additional', on ? d.additional.filter((y) => y !== x.id) : [...d.additional, x.id])}
                  className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold', on ? 'border-rust bg-brand-50 text-rust dark:bg-brand-500/10' : 'border-line text-ink-soft')}>{x.name}</button>;
              })}
            </div>
          </Field>
          <Field label="Reporting manager">
            <Select value={d.managerId} onChange={(e) => set('managerId', e.target.value)} searchable>
              <option value="">No manager</option>
              {data.directory.filter((x) => x.employmentStatus !== 'Resigned').map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Shift">
            <Select value={d.shiftId} onChange={(e) => set('shiftId', e.target.value)}>
              {data.shifts.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Joining date"><Input type="date" value={d.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} /></Field>
          <Field label="Employment status">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as EmploymentStatus)}>{EMPLOYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
          </Field>
          {d.status === 'Probation' && <Field label="Probation ends"><Input type="date" value={d.probationEnd} onChange={(e) => set('probationEnd', e.target.value)} /></Field>}
          <Field label="Date of birth" hint="Used for birthday reminders (year is never shown)"><Input type="date" value={d.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
          <Field label="Work location"><Input value={d.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Kochi" /></Field>
          {canSalary && (
            <Field label="Salary (confidential)" error={err('salary')}>
              <div className="flex gap-2"><Input inputMode="decimal" value={d.salary} onChange={(e) => set('salary', e.target.value.replace(/[^\d.]/g, ''))} placeholder="Monthly" /><Input className="w-24" value={d.currency} onChange={(e) => set('currency', e.target.value.toUpperCase().slice(0, 3))} /></div>
            </Field>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <PasswordInput value={d.password} onChange={(v) => set('password', v)} email={d.email} error={err('password')} confirm={d.confirm} onConfirm={(v) => set('confirm', v)} confirmError={err('confirm')} />
          <Checkbox checked={d.mustChange} onCheckedChange={(v) => set('mustChange', v)} label="Ask the employee to change the password at first sign-in" />
          <Field label="Account role">
            <Select value={d.role} onChange={(e) => { const r = e.target.value as StaffRole; setD((x) => ({ ...x, role: r, permissions: ROLE_DEFAULTS[r].filter((m) => isSuper || !HR_MODULES.includes(m)) })); }}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <PermissionChecks role={d.role} value={d.permissions} onChange={(v) => set('permissions', v)} />
        </div>
      )}
    </Modal>
  );
}

function PermissionChecks({ role, value, onChange }: { role: StaffRole; value: string[]; onChange: (v: string[]) => void }) {
  const { session } = useStore();
  const isSuper = session?.userRole === 'super_admin';
  if (role === 'super_admin') return <Alert tone="info">Super Admins have every permission.</Alert>;
  return (
    <Field label="Permissions" hint={isSuper ? undefined : 'HR and finance permissions can only be granted by a Super Admin.'}>
      <div className="grid gap-2 sm:grid-cols-2">
        {STAFF_MODULES.map((m) => {
          const locked = !isSuper && (HR_MODULES.includes(m.id) || m.id === 'finance');
          return (
            <div key={m.id} className={cn('rounded-xl border border-line p-2.5', locked && 'opacity-50')}>
              <Checkbox checked={value.includes(m.id)} disabled={locked} onCheckedChange={(on) => onChange(on ? [...value, m.id] : value.filter((x) => x !== m.id))} label={m.label} description={m.hint} />
            </div>
          );
        })}
      </div>
    </Field>
  );
}

// ------------------------------------------------------------------ edit HR record

function EditEmployeeModal({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { data, write } = useHR();
  const lk = useHRLookup();
  const { session } = useStore();
  const toast = useToast();
  const [d, setD] = useState<Employee | null>(null);
  const [perm, setPerm] = useState<{ role: StaffRole; permissions: string[] } | null>(null);
  const [tab, setTab] = useState<'record' | 'access'>('record');
  const [key, setKey] = useState<string | null>(null);
  const staffList = useStore().db.staff;
  const dir = employee ? lk.person.get(employee.id) ?? (() => { const s = staffList.find((x) => x.id === employee.id); return s ? { fullName: s.fullName, role: s.role } : undefined; })() : undefined;
  if ((employee?.id ?? null) !== key) {
    setKey(employee?.id ?? null);
    setD(employee ? { ...employee } : null);
    setTab('record');
    setPerm(null);
    // Current permissions (null in the database = the role's defaults).
    if (employee && supabase) {
      void supabase.from('profiles').select('role, permissions').eq('id', employee.id).maybeSingle().then(({ data: p }) => {
        if (p) setPerm({ role: p.role as StaffRole, permissions: (p.permissions as string[] | null) ?? [...(ROLE_DEFAULTS[p.role as StaffRole] ?? [])] });
      });
    }
  }
  const isSuper = session?.userRole === 'super_admin';
  const roles = isSuper ? STAFF_ROLES : HR_MANAGEABLE_ROLES;
  if (!d) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const isNew = !d.updatedAt;
  const save = async () => {
    const row = {
      employee_code: d.employeeCode.trim(), designation_id: d.designationId, additional_designations: d.additionalDesignations, department_id: d.departmentId || null,
      reporting_manager_id: d.reportingManagerId || null, joining_date: d.joiningDate || null, employment_status: d.employmentStatus,
      probation_end_date: d.probationEndDate || null, date_of_birth: d.dateOfBirth || null, shift_id: d.shiftId || null, work_location: d.workLocation || null,
    };
    const ok = isNew
      ? await write('employees', 'insert', { id: d.id, ...row }, undefined, { refresh: ['employees', 'directory'], success: 'Employee record created' })
      : await write('employees', 'update', row, { id: d.id }, { refresh: ['employees', 'directory'], success: 'Employee updated' });
    if (ok) onClose();
  };
  const saveAccess = async () => {
    if (!perm) return;
    try {
      await adminApi.updateUser({ userId: d.id, role: perm.role, permissions: perm.role === 'super_admin' ? null : perm.permissions });
      toast.success('Access updated', 'The employee\'s menus update automatically.');
      onClose();
    } catch (e) {
      toast.error('Access not changed', e instanceof AdminApiError ? e.message : 'Please try again.');
    }
  };
  return (
    <Modal open={!!employee} onClose={onClose} size="xl" title={dir?.fullName ?? 'Employee'} subtitle="Designation changes apply to future reports; earlier reports keep their original designation."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{tab === 'record' ? <Button disabled={!d.employeeCode.trim()} onClick={save}>{isNew ? 'Create record' : 'Save employee'}</Button> : <Button icon={ShieldCheck} onClick={saveAccess} disabled={!perm?.permissions.length && perm?.role !== 'super_admin'}>Save access</Button>}</>}>
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'record', label: 'HR record' }, { value: 'access', label: 'Role & permissions' }]} />
      {tab === 'record' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee ID" required><Input value={d.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} /></Field>
          <Field label="Designation" required>
            <Select value={d.designationId} onChange={(e) => set('designationId', e.target.value)}>{data.designations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          </Field>
          <Field label="Additional roles (workspaces)" className="sm:col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {data.designations.filter((x) => x.id !== d.designationId).map((x) => {
                const on = d.additionalDesignations.includes(x.id);
                return <button key={x.id} type="button" onClick={() => set('additionalDesignations', on ? d.additionalDesignations.filter((y) => y !== x.id) : [...d.additionalDesignations, x.id])}
                  className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold', on ? 'border-rust bg-brand-50 text-rust dark:bg-brand-500/10' : 'border-line text-ink-soft')}>{x.name}</button>;
              })}
            </div>
          </Field>
          <Field label="Department"><Select value={d.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value || null)}><option value="">—</option>{data.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Reporting manager">
            <Select value={d.reportingManagerId ?? ''} onChange={(e) => set('reportingManagerId', e.target.value || null)} searchable>
              <option value="">No manager</option>
              {data.directory.filter((x) => x.id !== d.id).map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Employment status"><Select value={d.employmentStatus} onChange={(e) => set('employmentStatus', e.target.value as EmploymentStatus)}>{EMPLOYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Shift"><Select value={d.shiftId ?? ''} onChange={(e) => set('shiftId', e.target.value || null)}>{data.shifts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Joining date"><Input type="date" value={d.joiningDate ?? ''} onChange={(e) => set('joiningDate', e.target.value || null)} /></Field>
          <Field label="Probation ends"><Input type="date" value={d.probationEndDate ?? ''} onChange={(e) => set('probationEndDate', e.target.value || null)} /></Field>
          <Field label="Date of birth"><Input type="date" value={d.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value || null)} /></Field>
          <Field label="Work location"><Input value={d.workLocation ?? ''} onChange={(e) => set('workLocation', e.target.value || null)} /></Field>
          <p className="text-xs text-ink-mute sm:col-span-2">Joined {fmtDay(d.joiningDate)} · last updated {fmtDay(d.updatedAt?.slice(0, 10))}</p>
        </div>
      ) : !perm ? <p className="text-sm text-ink-soft">Loading access…</p> : (
        <div className="space-y-4">
          <Alert tone="info">Leave a box unticked to remove that module. {isSuper ? 'HR permissions (HR portal, employee accounts, salaries) are granted here.' : 'Only a Super Admin can grant HR or finance permissions.'}</Alert>
          <Field label="Account role"><Select value={perm.role} onChange={(e) => setPerm({ role: e.target.value as StaffRole, permissions: ROLE_DEFAULTS[e.target.value as StaffRole].filter((m) => isSuper || !HR_MODULES.includes(m)) })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
          <PermissionChecks role={perm.role} value={perm.permissions} onChange={(v) => setPerm({ ...perm, permissions: v })} />
          <Switch checked={false} onCheckedChange={() => setPerm({ ...perm, permissions: ROLE_DEFAULTS[perm.role].filter((m) => isSuper || !HR_MODULES.includes(m)) })} label="Reset to role defaults" />
        </div>
      )}
    </Modal>
  );
}

function SalaryModal({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const { data, write } = useHR();
  const lk = useHRLookup();
  const cur = data.salaries.find((s) => s.employeeId === employeeId);
  const [v, setV] = useState({ amount: '', currency: 'INR', from: '' });
  const [key, setKey] = useState<string | null>(null);
  if (employeeId !== key) {
    setKey(employeeId);
    setV({ amount: cur ? String(cur.amount) : '', currency: cur?.currency ?? 'INR', from: cur?.effectiveFrom ?? '' });
  }
  const save = async () => {
    const row = { employee_id: employeeId, amount: Number(v.amount), currency: v.currency, effective_from: v.from || null };
    const ok = cur ? await write('employee_salaries', 'update', row, { id: cur.id }, { refresh: ['salaries'], success: 'Salary saved' })
      : await write('employee_salaries', 'insert', row, undefined, { refresh: ['salaries'], success: 'Salary saved' });
    if (ok) onClose();
  };
  return (
    <Modal open={!!employeeId} onClose={onClose} size="sm" title={`Salary · ${lk.name(employeeId)}`} subtitle="Confidential — visible only to Super Admins and HR with salary access. Changes are audited."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!(Number(v.amount) >= 0) || v.amount === ''} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monthly amount" required><Input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Currency"><Input value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
        <Field label="Effective from" className="sm:col-span-2"><Input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ userId, onClose, onDone }: { userId: string | null; onClose: () => void; onDone: (c: { title: string; email: string; password: string }) => void }) {
  const lk = useHRLookup();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [must, setMust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  if (userId !== key) { setKey(userId); setPw(''); setConfirmPw(''); setMust(true); }
  const email = '';
  const err = pwError(pw, email) ?? confirmError(pw, confirmPw);
  const submit = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await adminApi.resetPassword(userId, pw, must);
      toast.success('Password reset', 'The employee was signed out everywhere.');
      onDone({ title: `New password for ${lk.name(userId)}`, email: '', password: pw });
      onClose();
    } catch (e) {
      toast.error('Password not reset', e instanceof AdminApiError ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!userId} onClose={onClose} title={`Reset password · ${lk.name(userId)}`} subtitle="Existing sessions are ended. The new password is shown once."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !!err} onClick={submit}>Reset password</Button></>}>
      <div className="space-y-4">
        <PasswordInput value={pw} onChange={setPw} email={email} confirm={confirmPw} onConfirm={setConfirmPw} confirmError={confirmPw ? confirmError(pw, confirmPw) : undefined} />
        <Checkbox checked={must} onCheckedChange={setMust} label="Ask for a new password at next sign-in" />
      </div>
    </Modal>
  );
}
