import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, BookOpen, ExternalLink, FileSpreadsheet, Landmark, MapPin, Pencil, Plus, Power, Trophy } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, FilterSelect, PageHeader, SearchInput } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { CatalogueImportDialog, UniversityForm } from '../../components/catalogue';
import { useScoped, useStore } from '../../store/store';
import type { University } from '../../data/types';
import { countryFlag, matches } from '../../lib/utils';

export default function Providers() {
  const { db, actions, session } = useStore();
  const { base } = useScoped();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const canManage = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('catalogue');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [country, setCountry] = useState('');
  const [editing, setEditing] = useState<University | undefined>();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [blackQ, setBlackQ] = useState('');

  const countries = [...new Set(db.universities.map((u) => u.country))].sort();
  const rows = useMemo(
    () => db.universities.filter((u) => matches(q, u.name, u.city)).filter((u) => !country || u.country === country).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name)),
    [db.universities, q, country],
  );
  const black = db.blacklist.filter((b) => matches(blackQ, b.name)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Education Providers"
        subtitle="Partner universities and colleges in the SSI GLOBAL network."
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImportOpen(true)}>Import from Excel</Button>
              <Button icon={Plus} onClick={() => { setEditing(undefined); setOpen(true); }}>Add Provider</Button>
            </>
          )
        }
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Search providers…" className="sm:w-80" />
        <FilterSelect label="All countries" value={country} onChange={setCountry} options={countries} />
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState icon={Landmark} title="No providers found" /></Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((u) => {
            const courses = db.courses.filter((c) => c.universityId === u.id && c.active !== false);
            const apps = db.applications.filter((a) => a.universityId === u.id);
            return (
              <Card key={u.id} hover className={`group flex flex-col p-5 ${u.active === false ? 'opacity-70' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-2xl">{countryFlag[u.country]}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold leading-snug text-heading">{u.name}</h3>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-mute"><MapPin className="h-3 w-3" />{u.city}, {u.country}</div>
                  </div>
                  {canManage && (
                    <span className="flex gap-0.5">
                      <button type="button" aria-label={`Edit ${u.name}`} onClick={() => { setEditing(u); setOpen(true); }} className="rounded-lg p-1.5 text-ink-mute transition hover:bg-canvas hover:text-heading">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={u.active === false ? `Activate ${u.name}` : `Deactivate ${u.name}`}
                        onClick={() => { actions.updateUniversity(u.id, { active: u.active === false }); toast.success(u.active === false ? 'Provider activated' : 'Provider deactivated', u.name); }}
                        className="rounded-lg p-1.5 text-ink-mute transition hover:bg-canvas hover:text-heading"
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {u.active === false && <Badge tone="red">Inactive</Badge>}
                  {u.ranking > 0 && <Badge tone="orange"><Trophy className="h-3 w-3" /> QS #{u.ranking}</Badge>}
                  {u.type && <Badge tone="slate">{u.type}</Badge>}
                  {u.partnerSince && <Badge tone="navy">Partner since {u.partnerSince}</Badge>}
                  {(u.moiAccepted?.length ?? 0) > 0 && <Badge tone="teal">MOI list · {u.moiAccepted!.length}</Badge>}
                </div>
                {u.casDeposit && <p className="mt-3 text-xs text-ink-soft"><b className="text-heading">CAS deposit:</b> {u.casDeposit}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-canvas py-2"><div className="font-display text-lg font-semibold text-heading">{courses.length}</div><div className="text-[11px] text-ink-mute">Courses</div></div>
                  <div className="rounded-xl bg-canvas py-2"><div className="font-display text-lg font-semibold text-heading">{apps.length}</div><div className="text-[11px] text-ink-mute">Applications</div></div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" icon={BookOpen} className="flex-1" onClick={() => navigate(`${base}/courses?university=${u.id}`)}>View courses</Button>
                  {u.website && (
                    <a href={`https://${u.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-ink-soft hover:bg-canvas hover:text-heading">
                      Website <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {db.blacklist.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title={<span className="flex items-center gap-2"><Ban className="h-4 w-4 text-red-500" />Blacklisted institutions ({db.blacklist.length})</span>}
            subtitle="Qualifications from these institutions are not accepted. Imported from the partner toolkit."
            action={<SearchInput value={blackQ} onChange={setBlackQ} placeholder="Check an institution…" className="w-56" />}
          />
          <ul className="grid max-h-72 gap-x-6 overflow-y-auto px-5 pb-5 text-sm text-ink-soft sm:grid-cols-2">
            {black.map((b) => <li key={b.id} className="border-b border-line py-1.5">{b.name}</li>)}
            {black.length === 0 && <li className="py-3 text-ink-mute">No match — not on the blacklist.</li>}
          </ul>
        </Card>
      )}
      {canManage && <UniversityForm open={open} university={editing} onClose={() => setOpen(false)} />}
      {canManage && <CatalogueImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
    </>
  );
}
