// Advanced Course Search, shared by the Admin, Staff and Partner portals. The filters offered come
// from the live catalogue (course_search_facets), so a filter without recorded data is not shown;
// matching runs on the server (search_courses) and results refresh when the catalogue changes.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Award, CalendarDays, Clock, Eye, FilePlus2, GraduationCap, Info, Landmark, Languages, Loader2, MapPin, RotateCcw, Search, ShieldCheck, SlidersHorizontal, Wallet, X, type LucideIcon } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DatePicker, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, SelectMenu, Skeleton, Switch } from '../../components/ui';
import { CourseDetails, ExternalLink, MONTH_NAMES } from '../../components/catalogue';
import { ApplicationForm } from '../../components/forms/ApplicationForm';
import { fromRow, useScoped, useStore } from '../../store/store';
import { supabase } from '../../auth/auth';
import { canOpen } from '../../auth/roles';
import { useMediaQuery } from '../../layouts/Sidebar';
import { PROGRAM_LEVELS } from '../../lib/catalogueImport';
import { EXAMS, emptyFilters, toPayload, useCourseSearchApi, type Exam, type Facets, type SearchFilters, type SearchResult, type SearchRow, type SearchSort } from '../../lib/courseSearch';
import { cn, countryFlag, money } from '../../lib/utils';
import type { Course } from '../../data/types';

const PAGE_SIZE = 20;
const STORE_KEY = 'ssi-course-search'; // catalogue filters only; no student data

const FLAGS: Record<string, string> = {
  without_english: 'Without English Proficiency',
  english_waiver: 'English Proficiency Exam Waiver',
  without_gre: 'Without GRE',
  without_gmat: 'Without GMAT',
  without_maths: 'Without Mathematics',
  stem: 'STEM Programs',
  fifteen_years: 'With 15 Years of Education',
  fee_waiver: 'Application Fee Waiver',
  scholarship: 'Scholarship Available',
  esl: 'ESL / ELP Available',
};
const REQUIREMENT_FLAGS = ['without_english', 'english_waiver', 'without_gre', 'without_gmat', 'without_maths'];
const ELIGIBILITY_FLAGS = ['stem', 'fifteen_years', 'esl'];
const EXAM_LABEL: Record<Exam, string> = { IELTS: 'IELTS', PTE: 'PTE', TOEFL: 'TOEFL iBT', DET: 'DET', SAT: 'SAT', ACT: 'ACT', GRE: 'GRE', GMAT: 'GMAT' };
/** Filters that stay hidden until some course records the data. Shown to catalogue managers only. */
const WAITING: { label: string; has: (f: Facets) => boolean }[] = [
  { label: 'Province / State', has: (f) => f.states.length > 0 },
  { label: 'Study Area', has: (f) => f.studyAreas.length > 0 },
  { label: 'Discipline Area', has: (f) => f.disciplines.length > 0 },
  { label: 'Study Mode', has: (f) => f.modes.length > 0 },
  ...EXAMS.map((e) => ({ label: EXAM_LABEL[e], has: (f: Facets) => f.exams[e]?.count > 0 })),
  ...Object.entries(FLAGS).map(([k, label]) => ({ label, has: (f: Facets) => !!f.flags[k] })),
  { label: 'Application Deadline (dates)', has: (f) => !!f.flags.deadlines },
  { label: 'Upcoming Intakes', has: (f) => !!f.flags.upcoming },
];

const num = (s: string) => parseFloat(s) || 0;
const levelOrder = (a: string, b: string) => {
  const i = PROGRAM_LEVELS.indexOf(a);
  const j = PROGRAM_LEVELS.indexOf(b);
  return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b);
};

function readStored(): SearchFilters {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? { ...emptyFilters(), ...JSON.parse(raw) } : emptyFilters();
  } catch {
    return emptyFilters();
  }
}

export default function CourseSearch() {
  const api = useCourseSearchApi();
  const { db, session } = useStore();
  const scoped = useScoped();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [f, setF] = useState<SearchFilters>(() => {
    const init = readStored();
    const u = params.get('university');
    return u ? { ...emptyFilters(), universities: [u] } : init;
  });
  const [sort, setSort] = useState<SearchSort>('name');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewCourse, setViewCourse] = useState<string>();
  const [fetchedCourse, setFetchedCourse] = useState<Course>();
  const [viewUni, setViewUni] = useState<string>();
  const [applyCourse, setApplyCourse] = useState<string>();
  const canManage = session?.userRole === 'super_admin' || (session?.permissions ?? []).includes('catalogue');
  const canApply = canOpen(session, 'applications');

  const patch = useCallback((p: Partial<SearchFilters>) => {
    setF((x) => ({ ...x, ...p }));
    setPage(1);
  }, []);
  const clearAll = () => {
    setF(emptyFilters());
    setPage(1);
  };
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(f));
    } catch {
      /* storage unavailable: filters last for this visit */
    }
  }, [f]);

  // A range needs one currency: the chosen one, or the only one in the catalogue.
  const rangeCurrency = f.currencies.length === 1 ? f.currencies[0] : !f.currencies.length && facets?.currencies.length === 1 ? facets.currencies[0].currency : null;
  const payload = useMemo(() => toPayload(f, rangeCurrency), [f, rangeCurrency]);
  const key = JSON.stringify(payload);

  // Any catalogue change (Admin edit, import, intake update) re-runs the same search; filters stay.
  const catalogueRev = useMemo(() => ({}), [db.courses, db.universities, db.courseIntakes]); // eslint-disable-line react-hooks/exhaustive-deps

  const facetKey = JSON.stringify([f.countries, f.states, f.universities, f.study_areas]);
  useEffect(() => {
    let alive = true;
    api.facets({ countries: f.countries, states: f.states, universities: f.universities, study_areas: f.study_areas })
      .then((next) => {
        if (!alive) return;
        setFacets(next);
        // Choices that the location or study area no longer allows are dropped.
        setF((x) => {
          const states = x.states.filter((s) => next.states.includes(s));
          const universities = x.universities.filter((u) => next.universities.some((o) => o.id === u));
          const campuses = x.campuses.filter((c) => next.campuses.includes(c));
          const disciplines = x.disciplines.filter((d) => next.disciplines.includes(d));
          return states.length === x.states.length && universities.length === x.universities.length && campuses.length === x.campuses.length && disciplines.length === x.disciplines.length
            ? x : { ...x, states, universities, campuses, disciplines };
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, facetKey, catalogueRev]);

  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setSearching(true);
    const t = window.setTimeout(() => {
      api.search(JSON.parse(key), sort, PAGE_SIZE, (page - 1) * PAGE_SIZE)
        .then((r) => {
          if (id !== seq.current) return; // a newer search has started
          setResult(r);
          setFailed(false);
          setSearching(false);
        })
        .catch(() => {
          if (id !== seq.current) return;
          setFailed(true);
          setSearching(false);
        });
    }, 280);
    return () => window.clearTimeout(t);
  }, [api, key, sort, page, catalogueRev, retry]);

  // ---------------------------------------------------------------- active filters
  const toggle = (k: 'levels' | 'flags' | 'availability', v: string) => patch({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const chips = useMemo(() => {
    const out: { key: string; label: string; remove: () => void }[] = [];
    const list = (k: keyof SearchFilters, name: (v: string) => string) => (f[k] as string[]).forEach((v) => out.push({ key: `${k}:${v}`, label: name(v), remove: () => patch({ [k]: (f[k] as string[]).filter((x) => x !== v) }) }));
    const one = (k: keyof SearchFilters, label: string) => { if (f[k]) out.push({ key: k, label, remove: () => patch({ [k]: '' }) }); };
    if (f.q.trim()) out.push({ key: 'q', label: `“${f.q.trim()}”`, remove: () => patch({ q: '' }) });
    list('levels', (v) => v);
    list('countries', (v) => v);
    list('states', (v) => v);
    list('universities', (v) => facets?.universities.find((u) => u.id === v)?.name ?? 'University');
    list('campuses', (v) => `Campus: ${v}`);
    list('study_areas', (v) => v);
    list('disciplines', (v) => v);
    list('durations', (v) => v);
    list('modes', (v) => v);
    (Object.entries(f.exams) as [Exam, { score?: string; band?: string }][]).forEach(([e, v]) => out.push({
      key: `exam:${e}`,
      label: `${EXAM_LABEL[e]}${v.score ? `: student ${v.score}` : ''}${v.band ? `, band ${v.band}` : ''}`,
      remove: () => {
        const next = { ...f.exams };
        delete next[e];
        patch({ exams: next });
      },
    }));
    list('flags', (v) => FLAGS[v] ?? v);
    list('currencies', (v) => v);
    one('tuition_min', `Tuition from ${f.tuition_min}`);
    one('tuition_max', `Tuition up to ${f.tuition_max}`);
    list('app_fees', (v) => v);
    one('scholarship_min', `Scholarship from ${f.scholarship_min}`);
    list('intake_months', (v) => MONTH_NAMES[Number(v) - 1]);
    list('intake_years', (v) => v);
    list('intake_labels', (v) => v);
    list('availability', (v) => (v === 'open' ? 'Open Programs' : 'Upcoming Intakes'));
    one('deadline_from', `Deadline from ${f.deadline_from}`);
    one('deadline_to', `Deadline to ${f.deadline_to}`);
    list('backlogs', (v) => `Backlogs: ${v}`);
    one('academic', `Academic: ${f.academic}`);
    if (f.include_inactive) out.push({ key: 'inactive', label: 'Including inactive', remove: () => patch({ include_inactive: false }) });
    return out;
  }, [f, facets, patch]);

  const waiting = facets ? WAITING.filter((w) => !w.has(facets)).map((w) => w.label) : [];
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  const courseForView = db.courses.find((c) => c.id === viewCourse) ?? (fetchedCourse?.id === viewCourse ? fetchedCourse : undefined);
  useEffect(() => {
    // Details normally come from the catalogue already loaded; fall back to the single record.
    if (!viewCourse || !supabase || db.courses.some((c) => c.id === viewCourse)) return;
    void supabase.from('courses').select('*').eq('id', viewCourse).maybeSingle().then(({ data }) => data && setFetchedCourse(fromRow<Course>(data)));
  }, [viewCourse, db.courses]);

  const panel = facets ? (
    <FilterPanel f={f} facets={facets} patch={patch} toggle={toggle} rangeCurrency={rangeCurrency} canManage={canManage} />
  ) : (
    <div className="grid gap-4 p-5 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
  );

  return (
    <>
      <PageHeader title="Advanced Course Search" subtitle="Search every university and course in the live catalogue. Only details on record are matched." />

      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <Input icon={Search} value={f.q} onChange={(e) => patch({ q: e.target.value })} maxLength={200} placeholder="Search courses or universities…" aria-label="Search courses or universities" className="h-12 text-[15px]" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isDesktop && (
              <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setMobileOpen(true)}>Filters{chips.length ? ` (${chips.length})` : ''}</Button>
            )}
            {isDesktop && (
              <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>{panelOpen ? 'Hide filters' : 'Show filters'}</Button>
            )}
            <a href="#course-results" onClick={(e) => { e.preventDefault(); document.getElementById('course-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="rounded-lg px-2 py-1 text-sm font-semibold text-rust hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
              {(result?.total ?? 0).toLocaleString()} result{result?.total === 1 ? '' : 's'}
            </a>
            <Badge tone={chips.length ? 'orange' : 'slate'}>{chips.length} active filter{chips.length === 1 ? '' : 's'}</Badge>
            <Button variant="ghost" icon={RotateCcw} disabled={!chips.length} onClick={clearAll}>Clear All Filters</Button>
          </div>
        </div>
        {chips.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Active filters">
            {chips.map((c) => (
              <li key={c.key}>
                <button type="button" onClick={c.remove} aria-label={`Remove filter ${c.label}`} className="inline-flex max-w-[280px] items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-rust ring-1 ring-brand-200 transition hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:bg-brand-500/10 dark:ring-brand-500/30">
                  <span className="truncate">{c.label}</span><X className="h-3 w-3 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isDesktop && panelOpen && <Card className="mb-5 overflow-visible">{panel}</Card>}
      {canManage && waiting.length > 0 && panelOpen && isDesktop && (
        <details className="group mb-5 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-heading">
            <Info className="h-4 w-4 text-rust" /> {waiting.length} filters are waiting for data
            <span className="ml-auto text-xs font-normal text-ink-mute group-open:hidden">Show</span>
          </summary>
          <p className="mt-2 text-[13px] text-ink-soft">These appear by themselves once a course has the data (Courses → Edit → Search fields, or an Excel column): {waiting.join(', ')}.</p>
        </details>
      )}

      <div id="course-results" className="mb-3 flex scroll-mt-24 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft" role="status">
          {searching && !result ? 'Searching…' : <><b className="text-heading">{(result?.total ?? 0).toLocaleString()}</b> course{result?.total === 1 ? '' : 's'} found</>}
          {searching && result && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-rust" aria-hidden />}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-mute">Sort by</span>
          <Select value={sort} onChange={(e) => { setSort(e.target.value as SearchSort); setPage(1); }} className="h-9 w-44 text-[13px]" aria-label="Sort results">
            <option value="name">Course name</option>
            <option value="tuition_asc">Lowest tuition</option>
            <option value="tuition_desc">Highest tuition</option>
            <option value="ranking">Best ranking</option>
          </Select>
        </div>
      </div>

      {failed ? (
        <Card><EmptyState icon={Search} title="The search could not be completed" description="Check your connection and try again." action={<Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>Try again</Button>} /></Card>
      ) : !result ? (
        <div className="grid gap-4 xl:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
      ) : result.rows.length === 0 ? (
        <Card><EmptyState icon={GraduationCap} title="No courses match these filters" description="Remove a filter to see more courses." action={chips.length ? <Button variant="secondary" icon={RotateCcw} onClick={clearAll}>Clear All Filters</Button> : undefined} /></Card>
      ) : (
        <>
          <div className={cn('grid gap-4 xl:grid-cols-2 transition-opacity', searching && 'opacity-70')}>
            {result.rows.map((r) => (
              <ResultCard key={r.id} r={r} canApply={canApply} onDetails={() => setViewCourse(r.id)} onUniversity={() => setViewUni(r.university.id)} onApply={() => setApplyCourse(r.id)} />
            ))}
          </div>
          {pages > 1 && <Card className="mt-4"><Pagination page={page} pages={pages} onPage={setPage} total={result.total} label="courses" /></Card>}
        </>
      )}

      {/* Phones and tablets: filters in their own dialog */}
      <Modal open={!isDesktop && mobileOpen} onClose={() => setMobileOpen(false)} size="wide" title="Filters" subtitle={`${chips.length} active`}
        footer={<><Button variant="ghost" icon={RotateCcw} disabled={!chips.length} onClick={clearAll} className="mr-auto">Clear All</Button><Button onClick={() => setMobileOpen(false)}>Show {(result?.total ?? 0).toLocaleString()} courses</Button></>}>
        <div className="-mx-6 -my-5">{panel}</div>
      </Modal>

      <CourseDetails
        course={courseForView}
        onClose={() => setViewCourse(undefined)}
        showInactive={canManage}
        actions={canApply && viewCourse ? <Button icon={FilePlus2} onClick={() => { setApplyCourse(viewCourse); setViewCourse(undefined); }}>Select for application</Button> : undefined}
      />
      <UniversityDetails id={viewUni} onClose={() => setViewUni(undefined)} onOnly={(id) => { patch({ universities: [id] }); setViewUni(undefined); }} />
      {canApply && <ApplicationForm open={!!applyCourse} onClose={() => setApplyCourse(undefined)} courseId={applyCourse} onSaved={(id) => navigate(`${scoped.base}/applications?open=${id}`)} />}
    </>
  );
}

// ------------------------------------------------------------------ filters

function Group({ title, icon: Icon, children, className }: { title: string; icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 space-y-3.5 p-5', className)}>
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-heading"><Icon className="h-4 w-4 text-rust" />{title}</h3>
      {children}
    </section>
  );
}

function FilterPanel({ f, facets, patch, toggle, rangeCurrency, canManage }: {
  f: SearchFilters;
  facets: Facets;
  patch: (p: Partial<SearchFilters>) => void;
  toggle: (k: 'levels' | 'flags' | 'availability', v: string) => void;
  rangeCurrency: string | null;
  canManage: boolean;
}) {
  const multi = (k: keyof SearchFilters, label: string, options: (string | { value: string; label: string })[], placeholder: string) =>
    options.length > 0 && (
      <Field label={label}>
        <SelectMenu multiple value={f[k] as string[]} onChange={(v) => patch({ [k]: v })} placeholder={placeholder} aria-label={label}
          options={options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))} />
      </Field>
    );
  const flag = (k: string) => facets.flags[k] && <Checkbox key={k} checked={f.flags.includes(k)} onCheckedChange={() => toggle('flags', k)} label={FLAGS[k]} className="w-full" />;
  const durations = [...facets.durations].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
  const levels = [...facets.levels].sort(levelOrder);
  const exams = EXAMS.filter((e) => facets.exams[e]?.count > 0);
  const hasFinancial = facets.currencies.length > 0;
  const scholarshipMax = rangeCurrency ? facets.currencies.find((c) => c.currency === rangeCurrency)?.scholarshipMax : null;
  const anyScholarshipAmount = facets.currencies.some((c) => c.scholarshipMax != null);
  const range = rangeCurrency ? facets.currencies.find((c) => c.currency === rangeCurrency) : undefined;
  const setExam = (e: Exam, on: boolean) => {
    const next = { ...f.exams };
    if (on) next[e] = next[e] ?? {};
    else delete next[e];
    patch({ exams: next });
  };
  const setExamValue = (e: Exam, k: 'score' | 'band', v: string) => patch({ exams: { ...f.exams, [e]: { ...f.exams[e], [k]: v } } });

  return (
    <div className="grid divide-y divide-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0 [&>*:nth-child(n+4)]:lg:border-t [&>*:nth-child(n+4)]:lg:border-line">
      <Group title="Program Level" icon={GraduationCap}>
        <div className="space-y-2">
          {levels.map((l) => <Checkbox key={l} checked={f.levels.includes(l)} onCheckedChange={() => toggle('levels', l)} label={l} className="w-full" />)}
        </div>
      </Group>

      <Group title="Location & Study" icon={MapPin}>
        <div className="grid gap-3.5 sm:grid-cols-2">
        {multi('countries', 'Country', facets.countries, 'Select country')}
        {multi('states', 'Province / State', facets.states, 'Select province / state')}
        {multi('universities', 'University', facets.universities.map((u) => ({ value: u.id, label: u.name })), 'Search and select universities')}
        {multi('campuses', 'Campus', facets.campuses, 'Select campus')}
        {multi('study_areas', 'Study Area', facets.studyAreas, 'Select study area')}
        {multi('disciplines', 'Discipline Area', facets.disciplines, 'Select discipline')}
        {multi('durations', 'Duration', durations, 'Select duration')}
        {multi('modes', 'Study Mode', facets.modes, 'Select study mode')}
        </div>
        {flag('esl')}
      </Group>

      <Group title="Requirements" icon={Languages}>
        {exams.length > 0 && (
          <div className="space-y-2">
            {exams.map((e) => {
              const on = !!f.exams[e];
              return (
                <div key={e}>
                  <Checkbox checked={on} onCheckedChange={(v) => setExam(e, v)} label={EXAM_LABEL[e]} className="w-full" />
                  {on && (
                    <div className="ml-7 mt-1.5 grid max-w-[260px] grid-cols-2 gap-2">
                      <Input type="number" min={0} step="any" value={f.exams[e]?.score ?? ''} onChange={(x) => setExamValue(e, 'score', x.target.value)} placeholder="Student's score" aria-label={`${EXAM_LABEL[e]} student's score`} className="h-9 text-[13px]" />
                      {facets.exams[e].bands && <Input type="number" min={0} step="any" value={f.exams[e]?.band ?? ''} onChange={(x) => setExamValue(e, 'band', x.target.value)} placeholder="Lowest band" aria-label={`${EXAM_LABEL[e]} lowest band`} className="h-9 text-[13px]" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {REQUIREMENT_FLAGS.some((k) => facets.flags[k]) && <div className="space-y-2 border-t border-line pt-3">{REQUIREMENT_FLAGS.map(flag)}</div>}
      </Group>

      {hasFinancial && (
        <Group title="Fees & Scholarships" icon={Wallet}>
          {facets.currencies.length > 1 && multi('currencies', 'Currency', facets.currencies.map((c) => c.currency), 'Select currency')}
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-heading">Tuition Fee Range{rangeCurrency ? ` (${rangeCurrency})` : ''}</div>
            {rangeCurrency ? (
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" min={0} value={f.tuition_min} onChange={(e) => patch({ tuition_min: e.target.value })} placeholder={range ? `From ${range.min.toLocaleString()}` : 'From'} aria-label="Minimum tuition" />
                <Input type="number" min={0} value={f.tuition_max} onChange={(e) => patch({ tuition_max: e.target.value })} placeholder={range ? `To ${range.max.toLocaleString()}` : 'To'} aria-label="Maximum tuition" />
              </div>
            ) : <p className="text-xs text-ink-mute">Select one currency to set a range. Fees are never converted.</p>}
          </div>
          {multi('app_fees', 'Application Fee', facets.appFees, 'Select application fee')}
          {flag('scholarship')}
          {anyScholarshipAmount && (
            <Field label={`Scholarship Amount at least${rangeCurrency ? ` (${rangeCurrency})` : ''}`}>
              {rangeCurrency ? (
                <Input type="number" min={0} value={f.scholarship_min} onChange={(e) => patch({ scholarship_min: e.target.value })} placeholder={scholarshipMax != null ? `Up to ${scholarshipMax.toLocaleString()} on record` : 'Amount'} />
              ) : <p className="text-xs text-ink-mute">Select one currency first.</p>}
            </Field>
          )}
          {flag('fee_waiver')}
        </Group>
      )}

      <Group title="Intake & Application" icon={CalendarDays}>
        <div className="grid gap-3.5 sm:grid-cols-2">
        {multi('intake_months', 'Intake Month', [...facets.intakeMonths].sort((a, b) => a - b).map((m) => ({ value: String(m), label: MONTH_NAMES[m - 1] })), 'Select month')}
        {multi('intake_years', 'Intake Year', [...facets.intakeYears].sort((a, b) => a - b).map(String), 'Select year')}
        {multi('intake_labels', 'Available Intake', facets.intakeLabels, 'Select intake')}
        </div>
        {(facets.flags.open || facets.flags.upcoming) && (
          <div className="space-y-2">
            {facets.flags.open && <Checkbox checked={f.availability.includes('open')} onCheckedChange={() => toggle('availability', 'open')} label="Open Programs" className="w-full" />}
            {facets.flags.upcoming && <Checkbox checked={f.availability.includes('upcoming')} onCheckedChange={() => toggle('availability', 'upcoming')} label="Upcoming Intakes" className="w-full" />}
          </div>
        )}
        {facets.flags.deadlines && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Deadline from"><DatePicker value={f.deadline_from} onChange={(v) => patch({ deadline_from: v ?? '' })} /></Field>
            <Field label="Deadline to"><DatePicker value={f.deadline_to} onChange={(v) => patch({ deadline_to: v ?? '' })} /></Field>
          </div>
        )}
      </Group>

      <Group title="Eligibility" icon={ShieldCheck}>
        {multi('backlogs', 'Backlog Range', facets.backlogs, 'Select backlog range')}
        {facets.flags.academic && (
          <Field label="Academic Entry Requirement contains">
            <Input value={f.academic} onChange={(e) => patch({ academic: e.target.value })} maxLength={200} placeholder="e.g. 2.2, Bachelor, 55%" />
          </Field>
        )}
        {ELIGIBILITY_FLAGS.filter((k) => k !== 'esl').some((k) => facets.flags[k]) && <div className="space-y-2">{ELIGIBILITY_FLAGS.filter((k) => k !== 'esl').map(flag)}</div>}
        {canManage && (
          <label className="flex items-center gap-3 border-t border-line pt-3 text-sm text-ink-soft">
            <Switch checked={f.include_inactive} onCheckedChange={(v) => patch({ include_inactive: v })} label="Include inactive courses" />
            Include inactive courses
          </label>
        )}
      </Group>
    </div>
  );
}

// ------------------------------------------------------------------ results

function statusOf(r: SearchRow): { label: string; tone: 'green' | 'blue' | 'slate' | 'red' } {
  if (!r.active) return { label: 'Inactive', tone: 'red' };
  if (r.intakes.some((i) => i.status === 'Available')) return { label: 'Open', tone: 'green' };
  if (r.intakes.length) return { label: 'Upcoming', tone: 'blue' };
  return { label: 'No open intake', tone: 'slate' };
}

function englishLine(r: SearchRow) {
  const band = (b: number | null) => (b != null ? ` (no band below ${b})` : '');
  return [
    r.ielts != null && `IELTS ${r.ielts}${band(r.ieltsBand)}`,
    r.toefl != null && `TOEFL ${r.toefl}${band(r.toeflBand)}`,
    r.pte != null && `PTE ${r.pte}${band(r.pteBand)}`,
    r.det != null && `DET ${r.det}`,
    r.sat != null && `SAT ${r.sat}`,
    r.act != null && `ACT ${r.act}`,
    r.gre != null && `GRE ${r.gre}`,
    r.gmat != null && `GMAT ${r.gmat}`,
  ].filter(Boolean) as string[];
}

function ResultCard({ r, canApply, onDetails, onUniversity, onApply }: { r: SearchRow; canApply: boolean; onDetails: () => void; onUniversity: () => void; onApply: () => void }) {
  const st = statusOf(r);
  const english = englishLine(r);
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-xl" aria-hidden>{countryFlag[r.university.country] ?? <Landmark className="h-5 w-5 text-ink-mute" />}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-semibold leading-snug text-heading">{r.name}</h3>
          <div className="mt-0.5 truncate text-[13px] text-ink-soft">{r.university.name}</div>
        </div>
        <Badge tone={st.tone} dot>{st.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={r.level === 'Postgraduate' ? 'navy' : 'orange'}>{r.programLevel ?? r.level}</Badge>
        {r.field && <Badge tone="slate">{r.field}</Badge>}
        {r.studyMode && <Badge tone="slate">{r.studyMode}</Badge>}
        {r.stem && <Badge tone="teal">STEM</Badge>}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
        <Line icon={MapPin} label="Location">{[r.campus || r.university.city, r.university.state, r.university.country].filter(Boolean).join(', ')}</Line>
        <Line icon={Clock} label="Duration">{r.duration || 'Not provided'}</Line>
        <Line icon={Languages} label="English / tests" wide>{english.length ? english.join(' · ') : 'Not provided'}</Line>
        <Line icon={CalendarDays} label="Available intakes" wide>
          {r.intakes.length === 0 ? 'None open' : (
            <span className="flex flex-wrap gap-1">
              {r.intakes.map((i) => <Badge key={i.label} tone={i.status === 'Available' ? 'green' : 'blue'}>{i.label}{i.deadline ? ` · apply by ${new Date(i.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</Badge>)}
            </span>
          )}
        </Line>
        <Line icon={Award} label="Scholarship" wide>
          {r.hasScholarship ? <span className="text-emerald-700 dark:text-emerald-400">{r.averageScholarship || r.scholarship || 'Available'}</span> : 'None on record'}
        </Line>
      </dl>
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
          <div className="min-w-0">
            <div className="text-[11px] text-ink-mute">Tuition / year</div>
            <div className="font-display text-lg font-semibold text-heading">{money(r.tuition, r.currency)}</div>
            {r.tuitionText && <div className="truncate text-[11px] text-ink-mute" title={r.tuitionText}>{r.tuitionText}</div>}
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="secondary" icon={Eye} onClick={onDetails}>Details</Button>
            <Button size="sm" variant="secondary" icon={Landmark} onClick={onUniversity}>University</Button>
            {canApply && <Button size="sm" icon={FilePlus2} onClick={onApply}>Select</Button>}
          </div>
        </div>
        {(r.websiteUrl || r.scholarshipUrl) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <ExternalLink href={r.websiteUrl} variant="text">Official course website</ExternalLink>
            <ExternalLink href={r.scholarshipUrl} variant="text">Scholarship details</ExternalLink>
          </div>
        )}
      </div>
    </Card>
  );
}

function Line({ icon: Icon, label, children, wide }: { icon: LucideIcon; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex min-w-0 gap-2', wide && 'sm:col-span-2')}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute" aria-hidden />
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="break-words text-ink-soft">{children}</dd>
      </div>
    </div>
  );
}

function UniversityDetails({ id, onClose, onOnly }: { id?: string; onClose: () => void; onOnly: (id: string) => void }) {
  const { db } = useStore();
  const u = db.universities.find((x) => x.id === id);
  const count = db.courses.filter((c) => c.universityId === id && c.active !== false).length;
  const facts: [string, ReactNode][] = u ? [
    ['Country', `${countryFlag[u.country] ?? ''} ${u.country}`], ['Province / state', u.state], ['City', u.city], ['Type', u.type], ['Active courses', count],
    ['Ranking', u.rankingDetails || (u.ranking ? String(u.ranking) : null)], ['CAS deposit', u.casDeposit], ['Payment plan', u.paymentPlan], ['Notes', u.notes],
  ] : [];
  return (
    <Modal open={!!u} onClose={onClose} title={u?.name ?? ''} subtitle="University details" footer={u && <Button icon={Search} onClick={() => onOnly(u.id)}>Show this university's courses</Button>}>
      {u && (
        <>
          {!u.active && u.active !== undefined && <Alert tone="warning" className="mb-4">This university is inactive.</Alert>}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {facts.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt>
                <dd className="mt-1 whitespace-pre-line break-words text-sm text-heading">{v}</dd>
              </div>
            ))}
          </dl>
          {u.website && <div className="mt-4"><ExternalLink href={/^https?:\/\//i.test(u.website) ? u.website : `https://${u.website}`}>University website</ExternalLink></div>}
        </>
      )}
    </Modal>
  );
}
