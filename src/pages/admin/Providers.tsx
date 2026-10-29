import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, ExternalLink, Landmark, MapPin, Plus, Trash2, Trophy } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, FilterSelect, Input, Modal, PageHeader, SearchInput, Select } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { useScoped, useStore } from '../../store/store';
import { COUNTRIES } from '../../data/seed';
import type { University } from '../../data/types';
import { countryFlag, matches } from '../../lib/utils';

export default function Providers() {
  const { db, actions } = useStore();
  const { base } = useScoped();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [country, setCountry] = useState('');
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () => db.universities.filter((u) => matches(q, u.name, u.city)).filter((u) => !country || u.country === country),
    [db.universities, q, country],
  );

  const remove = async (u: University) => {
    if (await confirm({ title: `Remove ${u.name}?`, message: 'Its courses will also be removed from the catalogue.', confirmLabel: 'Remove', danger: true })) {
      actions.removeUniversity(u.id);
      toast.success('Provider removed');
    }
  };

  return (
    <>
      <PageHeader title="Education Providers" subtitle="Partner universities and colleges in the SSI GLOBAL network." actions={<Button icon={Plus} onClick={() => setOpen(true)}>Add Provider</Button>} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Search providers…" className="sm:w-80" />
        <FilterSelect label="All countries" value={country} onChange={setCountry} options={COUNTRIES} />
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState icon={Landmark} title="No providers found" /></Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((u) => {
            const courses = db.courses.filter((c) => c.universityId === u.id);
            const apps = db.applications.filter((a) => a.universityId === u.id);
            return (
              <Card key={u.id} hover className="group flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-2xl">{countryFlag[u.country]}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-semibold leading-snug text-heading">{u.name}</h3>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-mute"><MapPin className="h-3 w-3" />{u.city}, {u.country}</div>
                  </div>
                  <button type="button" aria-label="Remove provider" onClick={() => remove(u)} className="rounded-lg p-1.5 text-ink-mute opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {u.ranking > 0 && <Badge tone="orange"><Trophy className="h-3 w-3" /> QS #{u.ranking}</Badge>}
                  <Badge tone="slate">{u.type}</Badge>
                  <Badge tone="navy">Partner since {u.partnerSince}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-canvas py-2"><div className="font-display text-lg font-semibold text-heading">{courses.length}</div><div className="text-[11px] text-ink-mute">Courses</div></div>
                  <div className="rounded-xl bg-canvas py-2"><div className="font-display text-lg font-semibold text-heading">{apps.length}</div><div className="text-[11px] text-ink-mute">Applications</div></div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" icon={BookOpen} className="flex-1" onClick={() => navigate(`${base}/courses?university=${u.id}`)}>View courses</Button>
                  <a href={`https://${u.website}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-ink-soft hover:bg-canvas hover:text-heading">
                    Website <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ProviderForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ProviderForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions } = useStore();
  const toast = useToast();
  const [d, setD] = useState({ name: '', country: COUNTRIES[0], city: '', ranking: '', type: 'Public' as University['type'], website: '' });
  const save = () => {
    if (d.name.trim().length < 3 || !d.city.trim()) return toast.error('Name and city are required');
    actions.addUniversity({ ...d, ranking: Number(d.ranking) || 0, partnerSince: String(new Date().getFullYear()) });
    toast.success('Provider added', d.name);
    setD({ name: '', country: COUNTRIES[0], city: '', ranking: '', type: 'Public', website: '' });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add education provider" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Add provider</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Institution name" required className="sm:col-span-2"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></Field>
        <Field label="Country"><Select value={d.country} onChange={(e) => setD({ ...d, country: e.target.value })}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="City" required><Input value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></Field>
        <Field label="QS ranking"><Input type="number" value={d.ranking} onChange={(e) => setD({ ...d, ranking: e.target.value })} /></Field>
        <Field label="Type"><Select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as University['type'] })}><option>Public</option><option>Private</option></Select></Field>
        <Field label="Website" className="sm:col-span-2"><Input value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} placeholder="university.edu" /></Field>
      </div>
    </Modal>
  );
}
