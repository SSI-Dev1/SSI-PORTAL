import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, FilePlus2, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, FilterSelect, Menu, PageHeader, Pagination, SearchInput, Table, usePaged } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { StudentForm } from '../../components/forms/StudentForm';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { useLookup, useScoped, useStore } from '../../store/store';
import { COUNTRIES } from '../../data/seed';
import type { Student, StudentStatus } from '../../data/types';
import { countryFlag, formatDate, fullName, matches, type Tone } from '../../lib/utils';

export const studentTone: Record<StudentStatus, Tone> = { Lead: 'blue', Active: 'green', Enrolled: 'navy', 'On Hold': 'amber' };

export default function Students() {
  const scoped = useScoped();
  const lk = useLookup();
  const { actions } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [partner, setPartner] = useState(params.get('partner') ?? '');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | undefined>();
  const [appFor, setAppFor] = useState<string | undefined>();

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(undefined);
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const appCount = useMemo(() => {
    const m = new Map<string, number>();
    scoped.applications.forEach((a) => m.set(a.studentId, (m.get(a.studentId) ?? 0) + 1));
    return m;
  }, [scoped.applications]);

  const rows = useMemo(
    () =>
      scoped.students
        .filter((s) => matches(q, fullName(s), s.email, s.phone, s.passportNo))
        .filter((s) => !status || s.status === status)
        .filter((s) => !country || s.preferredCountries.includes(country))
        .filter((s) => !partner || s.partnerId === partner)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scoped.students, q, status, country, partner],
  );
  const paged = usePaged(rows, 10, `${q}${status}${country}${partner}`);

  const remove = async (s: Student) => {
    const ok = await confirm({
      title: 'Delete student?',
      message: `${fullName(s)} and all related applications and documents will be permanently removed.`,
      confirmLabel: 'Delete student',
      danger: true,
    });
    if (ok) {
      actions.removeStudent(s.id);
      toast.success('Student deleted', fullName(s));
    }
  };

  const counts = (st: StudentStatus) => scoped.students.filter((s) => s.status === st).length;

  return (
    <>
      <PageHeader
        title={scoped.isAdmin ? 'Students' : 'My Students'}
        subtitle={scoped.isAdmin ? 'Every student across all partner workspaces.' : 'Manage your students and start new applications.'}
        actions={
          <Button icon={UserPlus} onClick={() => { setEditing(undefined); setFormOpen(true); }}>
            Add Student
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['Active', 'Lead', 'Enrolled', 'On Hold'] as StudentStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatus(status === st ? '' : st)}
            className={`rounded-2xl border bg-surface px-4 py-3 text-left shadow-card transition hover:-translate-y-0.5 ${status === st ? 'border-rust ring-2 ring-brand/20' : 'border-line'}`}
          >
            <div className="text-xs font-medium text-ink-soft">{st}</div>
            <div className="font-display text-xl font-semibold text-heading">{counts(st)}</div>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search by name, email, phone or passport…" className="lg:w-96" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            {scoped.isAdmin && (
              <FilterSelect label="All partners" value={partner} onChange={setPartner} options={scoped.partners.map((p) => ({ value: p.id, label: p.name }))} />
            )}
            <FilterSelect label="All destinations" value={country} onChange={setCountry} options={COUNTRIES} />
            <FilterSelect label="All statuses" value={status} onChange={setStatus} options={['Lead', 'Active', 'Enrolled', 'On Hold']} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={scoped.students.length ? 'No students match your filters' : 'No students yet'}
            description={scoped.students.length ? 'Try a different search or clear the filters.' : 'Add your first student to start building applications.'}
            action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Add Student</Button>}
          />
        ) : (
          <>
            <Table head={['Student', ...(scoped.isAdmin ? ['Partner'] : []), 'Destinations', 'Level / Intake', 'Applications', 'Status', 'Added', '']}>
              {paged.rows.map((s) => (
                <tr key={s.id} className="group cursor-pointer transition hover:bg-brand-50/30" onClick={() => navigate(`${scoped.base}/students/${s.id}`)}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={fullName(s)} size={36} />
                      <div className="min-w-0">
                        <div className="font-semibold text-heading group-hover:text-rust">{fullName(s)}</div>
                        <div className="truncate text-xs text-ink-mute">{s.email}</div>
                      </div>
                    </div>
                  </td>
                  {scoped.isAdmin && <td className="px-5 py-3.5 text-ink-soft">{lk.partner.get(s.partnerId)?.name}</td>}
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {s.preferredCountries.map((c) => (
                        <span key={c} className="rounded-md bg-canvas px-1.5 py-0.5 text-xs text-ink-soft" title={c}>
                          {countryFlag[c]} {c.replace('United ', 'U.')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="text-heading">{s.preferredLevel}</div>
                    <div className="text-xs text-ink-mute">{s.preferredIntake}</div>
                  </td>
                  <td className="px-5 py-3.5 font-semibold text-heading">{appCount.get(s.id) ?? 0}</td>
                  <td className="px-5 py-3.5">
                    <Badge tone={studentTone[s.status]} dot>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{formatDate(s.createdAt)}</td>
                  <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={() => (
                        <button type="button" aria-label="Student actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-heading">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      )}
                      items={[
                        { label: 'View profile', icon: Eye, onClick: () => navigate(`${scoped.base}/students/${s.id}`) },
                        { label: 'Edit student', icon: Pencil, onClick: () => { setEditing(s); setFormOpen(true); } },
                        { label: 'New application', icon: FilePlus2, onClick: () => setAppFor(s.id) },
                        { label: 'Delete', icon: Trash2, onClick: () => remove(s), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="students" />
          </>
        )}
      </Card>

      <StudentForm open={formOpen} onClose={() => setFormOpen(false)} student={editing} onSaved={(id) => !editing && navigate(`${scoped.base}/students/${id}`)} />
      <ApplicationForm open={!!appFor} onClose={() => setAppFor(undefined)} studentId={appFor} onSaved={() => navigate(`${scoped.base}/applications`)} />
    </>
  );
}
