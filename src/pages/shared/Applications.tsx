import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilePlus2, FileStack } from 'lucide-react';
import { Avatar, Button, Card, EmptyState, FilterSelect, PageHeader, Pagination, Progress, SearchInput, Segmented, Table, usePaged } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { ApplicationDrawer, StatusBadge, stageProgress } from '../../components/ApplicationDrawer';
import { useLookup, useScoped, useStore } from '../../store/store';
import { APP_STATUSES, type AppStatus } from '../../data/types';
import { INTAKES } from '../../data/seed';
import { appStatusColor, cn, countryFlag, formatDate, fullName, matches } from '../../lib/utils';

export default function Applications() {
  const scoped = useScoped();
  const lk = useLookup();
  const { actions } = useStore();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [country, setCountry] = useState('');
  const [partner, setPartner] = useState('');
  const [intake, setIntake] = useState('');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | undefined>(params.get('open') ?? undefined);
  const [dragId, setDragId] = useState<string>();

  useEffect(() => {
    const o = params.get('open');
    const n = params.get('new');
    if (o) setOpenId(o);
    if (n) setFormOpen(true);
    if (o || n) {
      params.delete('open');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const rows = useMemo(
    () =>
      scoped.applications
        .filter((a) => {
          const s = lk.student.get(a.studentId);
          const u = lk.university.get(a.universityId);
          const c = lk.course.get(a.courseId);
          return matches(q, a.ref, fullName(s), u?.name, c?.name);
        })
        .filter((a) => !status || a.status === status)
        .filter((a) => !country || lk.university.get(a.universityId)?.country === country)
        .filter((a) => !partner || a.partnerId === partner)
        .filter((a) => !intake || a.intake === intake)
        .sort((a, b) => b.timeline[b.timeline.length - 1].at.localeCompare(a.timeline[a.timeline.length - 1].at)),
    [scoped.applications, lk, q, status, country, partner, intake],
  );
  const paged = usePaged(rows, 10, `${q}${status}${country}${partner}${intake}`);
  const countries = [...new Set(scoped.universities.map((u) => u.country))];
  const statusCount = (s: AppStatus) => scoped.applications.filter((a) => a.status === s).length;

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={scoped.isAdmin ? 'Track and progress every application across partners.' : 'Follow each application from submission to visa.'}
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List' },
                { value: 'board', label: 'Board' },
              ]}
            />
            <Button icon={FilePlus2} onClick={() => setFormOpen(true)}>
              New Application
            </Button>
          </>
        }
      />

      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip active={!status} onClick={() => setStatus('')} label="All" count={scoped.applications.length} color="rgb(var(--heading))" />
        {APP_STATUSES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(status === s ? '' : s)} label={s} count={statusCount(s)} color={appStatusColor[s]} />
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search student, university, course or ref…" className="lg:w-96" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            {scoped.isAdmin && <FilterSelect label="All partners" value={partner} onChange={setPartner} options={scoped.partners.map((p) => ({ value: p.id, label: p.name }))} />}
            <FilterSelect label="All countries" value={country} onChange={setCountry} options={countries} />
            <FilterSelect label="All intakes" value={intake} onChange={setIntake} options={INTAKES} />
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No applications found"
            description={scoped.applications.length ? 'Adjust your filters to see more.' : 'Create your first application to start tracking.'}
            action={<Button icon={FilePlus2} onClick={() => setFormOpen(true)}>New Application</Button>}
          />
        ) : view === 'list' ? (
          <>
            <Table head={['Student', 'University / Course', 'Country', 'Intake', 'Applied', 'Progress', 'Status']}>
              {paged.rows.map((a) => {
                const s = lk.student.get(a.studentId);
                const u = lk.university.get(a.universityId);
                const c = lk.course.get(a.courseId);
                return (
                  <tr key={a.id} onClick={() => setOpenId(a.id)} className="group cursor-pointer transition hover:bg-brand-50/30">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={fullName(s)} size={34} />
                        <div>
                          <div className="whitespace-nowrap font-semibold text-heading group-hover:text-rust">{fullName(s)}</div>
                          <div className="text-xs text-ink-mute">
                            {a.ref}
                            {scoped.isAdmin && ` · ${lk.partner.get(a.partnerId)?.code}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[260px] px-5 py-3.5">
                      <div className="truncate font-medium text-heading">{u?.name}</div>
                      <div className="truncate text-xs text-ink-mute">{c?.name}</div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">
                      {countryFlag[u?.country ?? '']} {u?.country}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{a.intake}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink-soft">{formatDate(a.appliedAt)}</td>
                    <td className="w-32 px-5 py-3.5">
                      <Progress value={stageProgress(a.status)} color={a.status === 'Visa Refused' ? 'bg-red-500' : undefined} />
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={a.status} />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="applications" />
          </>
        ) : (
          <div className="overflow-x-auto p-4 pt-0">
            {scoped.isAdmin && <p className="mb-3 text-xs text-ink-mute">Tip: drag a card to another column to change its status.</p>}
            <div className="flex gap-3">
              {APP_STATUSES.filter((s) => !status || s === status).map((col) => {
                const items = rows.filter((a) => a.status === col);
                return (
                  <div
                    key={col}
                    onDragOver={(e) => scoped.isAdmin && e.preventDefault()}
                    onDrop={() => {
                      if (!dragId || !scoped.isAdmin) return;
                      const app = scoped.applications.find((a) => a.id === dragId);
                      if (app && app.status !== col) {
                        actions.setApplicationStatus(dragId, col);
                        toast.success('Status updated', `${app.ref} → ${col}`);
                      }
                      setDragId(undefined);
                    }}
                    className="flex w-64 shrink-0 flex-col rounded-2xl bg-canvas p-2.5"
                  >
                    <div className="mb-2 flex items-center gap-2 px-1.5 py-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: appStatusColor[col] }} />
                      <span className="text-[13px] font-semibold text-heading">{col}</span>
                      <span className="ml-auto rounded-full bg-surface px-2 text-xs font-semibold text-ink-soft">{items.length}</span>
                    </div>
                    <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
                      {items.map((a) => {
                        const s = lk.student.get(a.studentId);
                        const u = lk.university.get(a.universityId);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            draggable={scoped.isAdmin}
                            onDragStart={() => setDragId(a.id)}
                            onClick={() => setOpenId(a.id)}
                            className={cn('rounded-xl border border-line bg-surface p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-card', dragId === a.id && 'opacity-50')}
                          >
                            <div className="flex items-center gap-2">
                              <Avatar name={fullName(s)} size={26} />
                              <span className="truncate text-sm font-semibold text-heading">{fullName(s)}</span>
                            </div>
                            <div className="mt-2 truncate text-xs text-ink-soft">
                              {countryFlag[u?.country ?? '']} {u?.name}
                            </div>
                            <div className="mt-1 text-[11px] text-ink-mute">
                              {a.intake} · {a.ref}
                            </div>
                          </button>
                        );
                      })}
                      {items.length === 0 && <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink-mute">No applications</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <ApplicationForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={(id) => setOpenId(id)} />
      <ApplicationDrawer app={scoped.applications.find((a) => a.id === openId)} onClose={() => setOpenId(undefined)} />
    </>
  );
}

function Chip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold transition',
        active ? 'border-navy bg-navy text-white shadow-card dark:border-navy-500 dark:bg-navy-500' : 'border-line bg-surface text-ink-soft hover:border-navy-200 hover:text-heading',
      )}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: active && label === 'All' ? '#FBA51E' : color }} />
      {label}
      <span className={cn('rounded-md px-1.5 text-[11px]', active ? 'bg-white/15' : 'bg-canvas')}>{count}</span>
    </button>
  );
}
