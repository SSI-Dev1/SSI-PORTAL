import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Clock, FilePlus2, GraduationCap, Heart, Languages, MapPin, RotateCcw, Search, Sparkles, Trophy } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Slider } from '../../components/ui';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { useToast } from '../../components/feedback';
import { useScoped } from '../../store/store';
import { INTAKES } from '../../data/seed';
import { cn, countryFlag, matches, money } from '../../lib/utils';

const LEVELS = ['Foundation', 'Diploma', 'Undergraduate', 'Postgraduate', 'PhD'];

export default function CourseFinder() {
  const scoped = useScoped();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const initUni = params.get('university') ?? '';
  const initCountry = scoped.universities.find((u) => u.id === initUni)?.country ?? '';
  const empty = { q: '', country: initCountry, university: initUni, level: '', field: '', intake: '', maxTuition: 60000 };
  const [f, setF] = useState(empty);
  const [sort, setSort] = useState<'relevance' | 'tuition' | 'ranking'>('relevance');
  const [applyCourse, setApplyCourse] = useState<string>();
  const [shortlist, setShortlist] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ssi-shortlist') ?? '[]');
    } catch {
      return [];
    }
  });

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const countries = [...new Set(scoped.universities.map((u) => u.country))].sort();
  const unis = scoped.universities.filter((u) => !f.country || u.country === f.country);
  const fields = [...new Set(scoped.courses.map((c) => c.field))].sort();

  const results = useMemo(() => {
    const list = scoped.courses
      .map((c) => ({ c, u: scoped.universities.find((u) => u.id === c.universityId)! }))
      .filter(({ u }) => !!u)
      .filter(({ c, u }) => matches(f.q, c.name, c.field, u.name))
      .filter(({ u }) => !f.country || u.country === f.country)
      .filter(({ u }) => !f.university || u.id === f.university)
      .filter(({ c }) => !f.level || c.level === f.level)
      .filter(({ c }) => !f.field || c.field === f.field)
      .filter(({ c }) => !f.intake || c.intakes.includes(f.intake))
      .filter(({ c }) => c.tuition <= f.maxTuition);
    if (sort === 'tuition') list.sort((a, b) => a.c.tuition - b.c.tuition);
    if (sort === 'ranking') list.sort((a, b) => (a.u.ranking || 9999) - (b.u.ranking || 9999));
    return list;
  }, [scoped.courses, scoped.universities, f, sort]);

  const toggleShortlist = (id: string) => {
    const next = shortlist.includes(id) ? shortlist.filter((x) => x !== id) : [...shortlist, id];
    setShortlist(next);
    try {
      localStorage.setItem('ssi-shortlist', JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (!shortlist.includes(id)) toast.success('Added to shortlist');
  };

  const activeCount = [f.q, f.country, f.university, f.level, f.field, f.intake].filter(Boolean).length + (f.maxTuition < 60000 ? 1 : 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            Course Finder <Badge tone="orange"><Sparkles className="h-3 w-3" /> Smart search</Badge>
          </span>
        }
        subtitle="Search programmes across our partner universities and apply in one click."
      />
      <Card className="relative mb-6 overflow-hidden p-5">
        <div className="absolute -right-12 -top-12 h-40 w-40 rotate-45 rounded-[32px] bg-brand-50" />
        <div className="relative">
          <Input icon={Search} value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Try “data science”, “nursing”, “MBA” or a university name…" className="h-12 text-[15px]" />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-5 lg:sticky lg:top-[88px]">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-semibold text-heading">Filters {activeCount > 0 && <span className="text-rust">({activeCount})</span>}</h3>
            <button type="button" onClick={() => setF({ ...empty, country: '', university: '' })} className="flex items-center gap-1 text-xs font-semibold text-rust hover:underline">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>
          <div className="space-y-4">
            <Field label="Country">
              <Select value={f.country} onChange={(e) => setF((x) => ({ ...x, country: e.target.value, university: '' }))}>
                <option value="">All countries</option>
                {countries.map((c) => <option key={c} value={c}>{countryFlag[c]} {c}</option>)}
              </Select>
            </Field>
            <Field label="University">
              <Select value={f.university} onChange={(e) => set('university', e.target.value)}>
                <option value="">All universities</option>
                {unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Study level">
              <div className="flex flex-wrap gap-1.5">
                {LEVELS.map((l) => (
                  <button key={l} type="button" onClick={() => set('level', f.level === l ? '' : l)} className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition', f.level === l ? 'border-rust bg-brand-50 text-rust' : 'border-line text-ink-soft hover:border-navy-200')}>
                    {l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Course area">
              <Select value={f.field} onChange={(e) => set('field', e.target.value)}>
                <option value="">All subjects</option>
                {fields.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="Intake">
              <Select value={f.intake} onChange={(e) => set('intake', e.target.value)}>
                <option value="">Any intake</option>
                {INTAKES.map((i) => <option key={i}>{i}</option>)}
              </Select>
            </Field>
            <Field label={`Max tuition: ${f.maxTuition >= 60000 ? 'Any' : f.maxTuition.toLocaleString()}`}>
              <Slider min={2000} max={60000} step={1000} value={f.maxTuition} onValueChange={(v) => set('maxTuition', v)} label="Maximum tuition" format={(v) => (v >= 60000 ? 'Any' : v.toLocaleString())} />
            </Field>
          </div>
        </Card>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              <b className="text-heading">{results.length}</b> courses found{shortlist.length > 0 && <> · <span className="text-rust">{shortlist.length} shortlisted</span></>}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-mute">Sort by</span>
              <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 w-40 text-[13px]">
                <option value="relevance">Relevance</option>
                <option value="tuition">Lowest tuition</option>
                <option value="ranking">Best ranking</option>
              </Select>
            </div>
          </div>
          {results.length === 0 ? (
            <Card>
              <EmptyState icon={GraduationCap} title="No courses match" description="Try widening your filters." action={<Button variant="secondary" onClick={() => setF({ ...empty, country: '', university: '' })}>Reset filters</Button>} />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {results.map(({ c, u }, i) => {
                const fav = shortlist.includes(c.id);
                return (
                  <Card key={c.id} hover className="flex animate-fade-up flex-col p-5">
                    <div style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} className="flex items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-xl">{countryFlag[u.country]}</span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display font-semibold leading-snug text-heading">{c.name}</h3>
                        <div className="mt-0.5 truncate text-[13px] text-ink-soft">{u.name}</div>
                      </div>
                      <button type="button" aria-label={fav ? 'Remove from shortlist' : 'Add to shortlist'} onClick={() => toggleShortlist(c.id)} className={cn('rounded-lg p-1.5 transition', fav ? 'text-rust' : 'text-ink-mute hover:text-rust')}>
                        <Heart className={cn('h-[18px] w-[18px]', fav && 'fill-current')} />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge tone={c.level === 'Postgraduate' ? 'navy' : 'orange'}>{c.level}</Badge>
                      <Badge tone="slate">{c.field}</Badge>
                      {u.ranking > 0 && u.ranking < 200 && <Badge tone="amber"><Trophy className="h-3 w-3" /> QS #{u.ranking}</Badge>}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-ink-soft">
                      <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-ink-mute" />{u.city}, {u.country}</span>
                      <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-ink-mute" />{c.duration}</span>
                      <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-ink-mute" />{c.intakes.slice(0, 2).join(', ')}{c.intakes.length > 2 && ` +${c.intakes.length - 2}`}</span>
                      <span className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5 text-ink-mute" />IELTS {c.ieltsMin}+</span>
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-4 mt-5">
                      <div>
                        <div className="text-[11px] text-ink-mute">Tuition / year</div>
                        <div className="font-display text-lg font-semibold text-heading">{money(c.tuition, c.currency)}</div>
                      </div>
                      <Button size="sm" icon={FilePlus2} onClick={() => setApplyCourse(c.id)}>
                        Apply
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <ApplicationForm open={!!applyCourse} onClose={() => setApplyCourse(undefined)} courseId={applyCourse} onSaved={(id) => navigate(`/client/applications?open=${id}`)} />
    </>
  );
}
