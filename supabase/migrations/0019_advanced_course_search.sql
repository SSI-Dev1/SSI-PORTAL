-- 0019_advanced_course_search.sql — run after 0018_application_chat.sql
-- (Supabase SQL Editor: Save this query as "0019_advanced_course_search")
--
-- Server-side Advanced Course Search over the existing universities, courses and course_intakes
-- tables. There is no second course database: every change Admin makes is searched immediately.
-- * New optional columns hold facts that are not in the data today (state, study mode, SAT/ACT/
--   GRE/GMAT, STEM, ...). They start empty and nothing is inferred: empty means "not recorded",
--   and a course only matches a filter when its record states that fact. Existing columns keep
--   their values, including the original tuition and scholarship text.
-- * course_search_facets() returns only the options that exist in the data, so a filter with no
--   recorded data is not offered, and appears by itself once Admin adds or imports that data.
-- * search_courses() validates the request, combines categories with AND and the options inside
--   a category with OR, and returns one page of results. Amounts are compared in the course's own
--   currency; there is no exchange-rate conversion.
-- Safe to run more than once.

-- =============================================================== verified search fields
alter table public.universities add column if not exists state text;

alter table public.courses add column if not exists program_level text;          -- more specific than "level"
alter table public.courses add column if not exists discipline_area text;
alter table public.courses add column if not exists study_mode text;
alter table public.courses add column if not exists esl_available boolean;
alter table public.courses add column if not exists sat_min numeric;
alter table public.courses add column if not exists act_min numeric;
alter table public.courses add column if not exists gre_min numeric;
alter table public.courses add column if not exists gmat_min numeric;
alter table public.courses add column if not exists english_required boolean;    -- false = no English test needed
alter table public.courses add column if not exists gre_required boolean;
alter table public.courses add column if not exists gmat_required boolean;
alter table public.courses add column if not exists maths_required boolean;
alter table public.courses add column if not exists stem boolean;
alter table public.courses add column if not exists accepts_fifteen_years boolean;
alter table public.courses add column if not exists application_fee_waiver boolean;
alter table public.courses add column if not exists scholarship_amount numeric;  -- in the course's currency

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_program_level_known') then
    alter table public.courses add constraint courses_program_level_known check (program_level is null or program_level in (
      'High School (11th-12th)', 'UG Diploma / Certificate / Associate Degree', 'Undergraduate', 'PG Diploma / Certificate', 'Postgraduate',
      'UG + PG Accelerated Degree', 'PhD', 'Short-Term / Summer Programs', 'Pathway Programs (UG)', 'Pathway Programs (PG)', 'Semester Study Abroad',
      'Twinning Programs (UG)', 'Twinning Programs (PG)', 'English Language Programs', 'Online / Distance Learning', 'Hybrid Programs'));
  end if;
end $$;

-- =============================================================== derived facts
-- Only from what the record states. Scholarship: "Yes"/"No" column first, else the summary text.
create or replace function public.course_has_scholarship(p_available text, p_summary text, p_amount numeric)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_available ~* '^\s*(yes|y|available)\y' then true
    when p_available ~* '^\s*(no|n|none|not available)\y' then false
    when coalesce(p_amount, 0) > 0 then true
    else coalesce(nullif(btrim(p_summary), '') !~* '^\s*(no|none|na|n/a|nil|-)\s*$', false)
  end;
$$;

-- Waiver text, unless it says there is none.
create or replace function public.course_has_waiver(p_waiver text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(p_waiver), '') !~* '^\s*(no|none|na|n/a|nil|not available)\y', false);
$$;

-- The entered amount, else the original amount when the source text starts with the course's own
-- currency code ("GBP 5000.00 (Approx INR 634436)" → 5000). The approximate INR is never used.
create or replace function public.course_scholarship_value(p_amount numeric, p_text text, p_currency text)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(p_amount, case when p_text ~ ('^\s*' || coalesce(p_currency, '') || '\s*[0-9]') and coalesce(p_currency, '') <> ''
    then replace((regexp_match(p_text, '^\s*[A-Za-z]+\s*([0-9][0-9,]*(\.[0-9]+)?)'))[1], ',', '')::numeric end);
$$;

create or replace function public.course_search_text(a text, b text, c text, d text, e text)
returns text language sql immutable set search_path = '' as $$
  select lower(concat_ws(' ', a, b, c, d, e));
$$;

create or replace function public.search_arr(f jsonb, k text)
returns text[] language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(f -> k) = 'array' then array(select jsonb_array_elements_text(f -> k)) else '{}'::text[] end;
$$;

-- =============================================================== indexes
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$
declare ext_schema text;
begin
  select n.nspname into ext_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists courses_search_trgm on public.courses using gin (public.course_search_text(name, field, faculty, campus, discipline_area) %I.gin_trgm_ops)', ext_schema);
  execute format('create index if not exists universities_search_trgm on public.universities using gin (lower(name) %I.gin_trgm_ops)', ext_schema);
end $$;
create index if not exists courses_university_idx on public.courses (university_id);
create index if not exists courses_level_idx on public.courses (level);
create index if not exists courses_program_level_idx on public.courses (program_level) where program_level is not null;
create index if not exists courses_tuition_idx on public.courses (currency, tuition);
create index if not exists courses_field_idx on public.courses (field);
create index if not exists courses_active_idx on public.courses (active);
create index if not exists universities_country_idx on public.universities (country, state);
create index if not exists course_intakes_when_idx on public.course_intakes (intake_year, intake_month) where active;
create index if not exists course_intakes_deadline_idx on public.course_intakes (application_deadline) where active and application_deadline is not null;

-- =============================================================== matching
-- One row per course that satisfies the filters.
create or replace function public.course_search_ids(f jsonb)
returns setof text language sql stable set search_path = '' as $$
  with p as materialized (
    select
      array(select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            from regexp_split_to_table(lower(btrim(coalesce(f ->> 'q', ''))), '\s+') w where w <> '') as words,
      public.search_arr(f, 'levels') as levels, public.search_arr(f, 'countries') as countries, public.search_arr(f, 'states') as states,
      public.search_arr(f, 'universities') as universities, public.search_arr(f, 'campuses') as campuses,
      public.search_arr(f, 'study_areas') as study_areas, public.search_arr(f, 'disciplines') as disciplines,
      public.search_arr(f, 'durations') as durations, public.search_arr(f, 'modes') as modes, public.search_arr(f, 'currencies') as currencies,
      public.search_arr(f, 'app_fees') as app_fees, public.search_arr(f, 'backlogs') as backlogs,
      array(select jsonb_array_elements_text(case when jsonb_typeof(f -> 'intake_months') = 'array' then f -> 'intake_months' else '[]'::jsonb end)::int) as months,
      array(select jsonb_array_elements_text(case when jsonb_typeof(f -> 'intake_years') = 'array' then f -> 'intake_years' else '[]'::jsonb end)::int) as years,
      public.search_arr(f, 'intake_labels') as labels, public.search_arr(f, 'availability') as availability,
      (f ->> 'deadline_from')::date as d_from, (f ->> 'deadline_to')::date as d_to,
      (f ->> 'tuition_min')::numeric as t_min, (f ->> 'tuition_max')::numeric as t_max, (f ->> 'scholarship_min')::numeric as s_min,
      coalesce(f -> 'exams', '{}'::jsonb) as ex, coalesce(f -> 'flags', '[]'::jsonb) as fl,
      '%' || replace(replace(replace(lower(btrim(coalesce(f ->> 'academic', ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as academic,
      coalesce((f ->> 'include_inactive')::boolean, false) and public.staff_can('catalogue') as with_inactive
  )
  select c.id
  from p
  cross join public.courses c
  join public.universities u on u.id = c.university_id
  where (p.with_inactive or (c.active and u.active))
    -- every word must appear in the course or university information
    and not exists (select 1 from unnest(p.words) w
                    where not (public.course_search_text(c.name, c.field, c.faculty, c.campus, c.discipline_area) like w or lower(u.name) like w
                               or lower(coalesce(u.city, '')) like w or lower(coalesce(u.country, '')) like w))
    and (cardinality(p.levels) = 0 or coalesce(c.program_level, c.level) = any (p.levels))
    and (cardinality(p.countries) = 0 or u.country = any (p.countries))
    and (cardinality(p.states) = 0 or u.state = any (p.states))
    and (cardinality(p.universities) = 0 or u.id = any (p.universities))
    and (cardinality(p.campuses) = 0 or c.campus = any (p.campuses))
    and (cardinality(p.study_areas) = 0 or c.field = any (p.study_areas))
    and (cardinality(p.disciplines) = 0 or c.discipline_area = any (p.disciplines))
    and (cardinality(p.durations) = 0 or lower(c.duration) in (select lower(x) from unnest(p.durations) x))
    and (cardinality(p.modes) = 0 or c.study_mode = any (p.modes))
    and (cardinality(p.currencies) = 0 or c.currency = any (p.currencies))
    and (cardinality(p.app_fees) = 0 or c.application_fee = any (p.app_fees))
    and (cardinality(p.backlogs) = 0 or c.backlog_range = any (p.backlogs))
    and (p.t_min is null or c.tuition >= p.t_min)
    and (p.t_max is null or c.tuition <= p.t_max)
    and (p.s_min is null or public.course_scholarship_value(c.scholarship_amount, c.average_scholarship, c.currency) >= p.s_min)
    and (p.academic = '%%' or lower(coalesce(c.academic_requirement, '')) like p.academic)
    -- exams: a course matches when its record states a requirement for one of the chosen exams,
    -- and that requirement is within the student's score / lowest band when they were entered
    and (p.ex = '{}'::jsonb
      or (p.ex ? 'IELTS' and coalesce(c.ielts_min, 0) > 0 and c.ielts_min <= coalesce((p.ex #>> '{IELTS,score}')::numeric, c.ielts_min)
          and ((p.ex #>> '{IELTS,band}') is null or c.ielts_band <= (p.ex #>> '{IELTS,band}')::numeric))
      or (p.ex ? 'TOEFL' and c.toefl_score is not null and c.toefl_score <= coalesce((p.ex #>> '{TOEFL,score}')::numeric, c.toefl_score)
          and ((p.ex #>> '{TOEFL,band}') is null or c.toefl_band <= (p.ex #>> '{TOEFL,band}')::numeric))
      or (p.ex ? 'PTE' and c.pte_score is not null and c.pte_score <= coalesce((p.ex #>> '{PTE,score}')::numeric, c.pte_score)
          and ((p.ex #>> '{PTE,band}') is null or c.pte_band <= (p.ex #>> '{PTE,band}')::numeric))
      or (p.ex ? 'DET' and c.det_score is not null and c.det_score <= coalesce((p.ex #>> '{DET,score}')::numeric, c.det_score))
      or (p.ex ? 'SAT' and c.sat_min is not null and c.sat_min <= coalesce((p.ex #>> '{SAT,score}')::numeric, c.sat_min))
      or (p.ex ? 'ACT' and c.act_min is not null and c.act_min <= coalesce((p.ex #>> '{ACT,score}')::numeric, c.act_min))
      or (p.ex ? 'GRE' and c.gre_min is not null and c.gre_min <= coalesce((p.ex #>> '{GRE,score}')::numeric, c.gre_min))
      or (p.ex ? 'GMAT' and c.gmat_min is not null and c.gmat_min <= coalesce((p.ex #>> '{GMAT,score}')::numeric, c.gmat_min)))
    -- yes/no facts: an empty column never matches
    and (not p.fl ? 'esl' or c.esl_available is true)
    and (not p.fl ? 'without_english' or c.english_required is false)
    and (not p.fl ? 'english_waiver' or public.course_has_waiver(c.english_waiver))
    and (not p.fl ? 'without_gre' or c.gre_required is false)
    and (not p.fl ? 'without_gmat' or c.gmat_required is false)
    and (not p.fl ? 'without_maths' or c.maths_required is false)
    and (not p.fl ? 'stem' or c.stem is true)
    and (not p.fl ? 'fifteen_years' or c.accepts_fifteen_years is true)
    and (not p.fl ? 'fee_waiver' or c.application_fee_waiver is true)
    and (not p.fl ? 'scholarship' or public.course_has_scholarship(c.scholarship_available, c.scholarship, c.scholarship_amount))
    -- intake conditions must hold on the same intake
    and ((cardinality(p.months) + cardinality(p.years) + cardinality(p.labels) + cardinality(p.availability) = 0 and p.d_from is null and p.d_to is null)
      or exists (
        select 1 from public.course_intakes i
        where i.course_id = c.id and i.active and i.status <> 'Closed'
          and (cardinality(p.months) = 0 or i.intake_month = any (p.months))
          and (cardinality(p.years) = 0 or i.intake_year = any (p.years))
          and (cardinality(p.labels) = 0 or public.intake_label(i.intake_month, i.intake_year) = any (p.labels))
          and (cardinality(p.availability) = 0
               or ('open' = any (p.availability) and i.status = 'Available')
               or ('upcoming' = any (p.availability) and i.status = 'Upcoming'))
          and (p.d_from is null or i.application_deadline >= p.d_from)
          and (p.d_to is null or i.application_deadline <= p.d_to)));
$$;
revoke all on function public.course_search_ids(jsonb) from public, anon, authenticated;

-- Rejects anything that is not a well-formed search request.
create or replace function public.course_search_validate(f jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare k text; e text; d text;
begin
  if f is null or jsonb_typeof(f) <> 'object' then raise exception 'SEARCH_INVALID'; end if;
  if exists (select 1 from jsonb_object_keys(f) x where x not in (
       'q', 'levels', 'countries', 'states', 'universities', 'campuses', 'study_areas', 'disciplines', 'durations', 'modes', 'currencies', 'app_fees', 'backlogs',
       'intake_months', 'intake_years', 'intake_labels', 'availability', 'deadline_from', 'deadline_to', 'tuition_min', 'tuition_max', 'scholarship_min',
       'exams', 'flags', 'academic', 'include_inactive')) then
    raise exception 'SEARCH_INVALID';
  end if;
  if char_length(coalesce(f ->> 'q', '')) > 200 or char_length(coalesce(f ->> 'academic', '')) > 200 then raise exception 'SEARCH_INVALID'; end if;
  foreach k in array array['levels', 'countries', 'states', 'universities', 'campuses', 'study_areas', 'disciplines', 'durations', 'modes', 'currencies', 'app_fees',
                           'backlogs', 'intake_months', 'intake_years', 'intake_labels', 'availability', 'flags'] loop
    if f ? k and (jsonb_typeof(f -> k) <> 'array' or jsonb_array_length(f -> k) > 300) then raise exception 'SEARCH_INVALID'; end if;
  end loop;
  foreach k in array array['intake_months', 'intake_years'] loop
    if exists (select 1 from jsonb_array_elements_text(coalesce(f -> k, '[]'::jsonb)) x where x !~ '^[0-9]{1,4}$') then raise exception 'SEARCH_INVALID'; end if;
  end loop;
  foreach k in array array['tuition_min', 'tuition_max', 'scholarship_min'] loop
    if (f ->> k) !~ '^[0-9]{1,12}(\.[0-9]{1,4})?$' then raise exception 'SEARCH_INVALID'; end if;
  end loop;
  foreach k in array array['deadline_from', 'deadline_to'] loop
    d := f ->> k;
    if d is not null then
      if d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'SEARCH_INVALID'; end if;
      perform d::date;
    end if;
  end loop;
  if f ? 'include_inactive' and jsonb_typeof(f -> 'include_inactive') <> 'boolean' then raise exception 'SEARCH_INVALID'; end if;
  if f ? 'exams' then
    if jsonb_typeof(f -> 'exams') <> 'object' then raise exception 'SEARCH_INVALID'; end if;
    for e in select * from jsonb_object_keys(f -> 'exams') loop
      if e not in ('IELTS', 'TOEFL', 'PTE', 'DET', 'SAT', 'ACT', 'GRE', 'GMAT') or jsonb_typeof(f -> 'exams' -> e) <> 'object' then raise exception 'SEARCH_INVALID'; end if;
      if (f -> 'exams' -> e ->> 'score') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' or (f -> 'exams' -> e ->> 'band') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' then raise exception 'SEARCH_INVALID'; end if;
    end loop;
  end if;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'SEARCH_INVALID';
end $$;
revoke all on function public.course_search_validate(jsonb) from public, anon, authenticated;

-- Same audience as the Course Finder: employees, and partners with that module.
create or replace function public.course_search_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() or public.partner_can('course_finder');
$$;
revoke all on function public.course_search_allowed() from public, anon;
grant execute on function public.course_search_allowed() to authenticated;

-- =============================================================== search
create or replace function public.search_courses(p_filters jsonb default '{}', p_sort text default 'name', p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 100000);
  res jsonb;
begin
  if not public.course_search_allowed() then raise exception 'SEARCH_DENIED' using errcode = '42501'; end if;
  perform public.course_search_validate(p_filters);
  if p_sort is null or p_sort not in ('name', 'tuition_asc', 'tuition_desc', 'ranking') then raise exception 'SEARCH_INVALID'; end if;

  with hits as materialized (
    select h as id from public.course_search_ids(p_filters) h
  ), page as (
    select c.id, u.id as uid,
      row_number() over (order by
        case when p_sort = 'tuition_asc' then c.tuition end asc nulls last,
        case when p_sort = 'tuition_desc' then c.tuition end desc nulls last,
        case when p_sort = 'ranking' then nullif(u.ranking, 0) end asc nulls last,
        lower(c.name), c.id) as ord
    from hits h
    join public.courses c on c.id = h.id
    join public.universities u on u.id = c.university_id
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'level', c.level, 'programLevel', c.program_level, 'field', c.field, 'disciplineArea', c.discipline_area,
        'duration', c.duration, 'campus', c.campus, 'studyMode', c.study_mode, 'active', c.active and u.active,
        'tuition', c.tuition, 'currency', c.currency, 'tuitionText', c.tuition_text,
        'websiteUrl', c.website_url, 'scholarshipUrl', c.scholarship_url,
        'hasScholarship', public.course_has_scholarship(c.scholarship_available, c.scholarship, c.scholarship_amount),
        'scholarship', c.scholarship, 'averageScholarship', c.average_scholarship,
        'applicationFee', c.application_fee, 'feeWaiver', c.application_fee_waiver, 'stem', c.stem,
        'ielts', nullif(c.ielts_min, 0), 'ieltsBand', c.ielts_band, 'toefl', c.toefl_score, 'toeflBand', c.toefl_band, 'pte', c.pte_score, 'pteBand', c.pte_band, 'det', c.det_score,
        'sat', c.sat_min, 'act', c.act_min, 'gre', c.gre_min, 'gmat', c.gmat_min, 'englishWaiver', c.english_waiver,
        'university', jsonb_build_object('id', u.id, 'name', u.name, 'country', u.country, 'state', u.state, 'city', u.city, 'ranking', u.ranking),
        'intakes', coalesce((select jsonb_agg(jsonb_build_object('label', public.intake_label(i.intake_month, i.intake_year), 'status', i.status, 'deadline', i.application_deadline)
                                              order by i.intake_year, i.intake_month)
                             from public.course_intakes i where i.course_id = c.id and i.active and i.status <> 'Closed'), '[]'::jsonb)
      ) order by pg.ord)
      from (select * from page order by ord limit v_limit offset v_offset) pg
      join public.courses c on c.id = pg.id
      join public.universities u on u.id = pg.uid), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.search_courses(jsonb, text, int, int) from public, anon;
grant execute on function public.search_courses(jsonb, text, int, int) to authenticated;

-- Options that exist in the live catalogue. Country narrows states; country and state narrow
-- universities; those narrow campuses; study area narrows disciplines. A filter whose list is
-- empty (or whose flag is false) has no recorded data and is not offered.
create or replace function public.course_search_facets(p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  res jsonb;
  countries text[] := public.search_arr(p_filters, 'countries');
  states text[] := public.search_arr(p_filters, 'states');
  unis text[] := public.search_arr(p_filters, 'universities');
  areas text[] := public.search_arr(p_filters, 'study_areas');
begin
  if not public.course_search_allowed() then raise exception 'SEARCH_DENIED' using errcode = '42501'; end if;
  perform public.course_search_validate(p_filters);
  with base as materialized (
    select c.*, u.country as u_country, u.state as u_state, u.name as u_name
    from public.courses c join public.universities u on u.id = c.university_id
    where c.active and u.active
  ), intakes as materialized (
    select i.* from public.course_intakes i join base b on b.id = i.course_id where i.active and i.status <> 'Closed'
  )
  select jsonb_build_object(
    'levels', (select coalesce(jsonb_agg(distinct coalesce(program_level, level)), '[]') from base),
    'countries', (select coalesce(jsonb_agg(distinct u_country), '[]') from base where nullif(u_country, '') is not null),
    'states', (select coalesce(jsonb_agg(distinct u_state), '[]') from base where nullif(u_state, '') is not null and (cardinality(countries) = 0 or u_country = any (countries))),
    'universities', (select coalesce(jsonb_agg(x order by x ->> 'name'), '[]') from (
        select distinct jsonb_build_object('id', university_id, 'name', u_name) as x from base
        where (cardinality(countries) = 0 or u_country = any (countries)) and (cardinality(states) = 0 or u_state = any (states))) y),
    'campuses', (select coalesce(jsonb_agg(distinct campus), '[]') from base where nullif(campus, '') is not null
        and (cardinality(countries) = 0 or u_country = any (countries)) and (cardinality(states) = 0 or u_state = any (states)) and (cardinality(unis) = 0 or university_id = any (unis))),
    'studyAreas', (select coalesce(jsonb_agg(distinct field), '[]') from base where nullif(field, '') is not null),
    'disciplines', (select coalesce(jsonb_agg(distinct discipline_area), '[]') from base where nullif(discipline_area, '') is not null and (cardinality(areas) = 0 or field = any (areas))),
    'durations', (select coalesce(jsonb_agg(d), '[]') from (select distinct on (lower(duration)) duration as d from base where nullif(duration, '') is not null order by lower(duration), duration) z),
    'modes', (select coalesce(jsonb_agg(distinct study_mode), '[]') from base where nullif(study_mode, '') is not null),
    'currencies', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('currency', currency, 'min', min(tuition), 'max', max(tuition),
                                  'scholarshipMax', max(public.course_scholarship_value(scholarship_amount, average_scholarship, currency))) as x
        from base where nullif(currency, '') is not null group by currency order by currency) y),
    'appFees', (select coalesce(jsonb_agg(distinct application_fee), '[]') from base where nullif(application_fee, '') is not null),
    'backlogs', (select coalesce(jsonb_agg(distinct backlog_range), '[]') from base where nullif(backlog_range, '') is not null),
    'exams', jsonb_build_object(
      'IELTS', (select jsonb_build_object('count', count(*), 'bands', count(ielts_band) > 0) from base where coalesce(ielts_min, 0) > 0),
      'TOEFL', (select jsonb_build_object('count', count(*), 'bands', count(toefl_band) > 0) from base where toefl_score is not null),
      'PTE', (select jsonb_build_object('count', count(*), 'bands', count(pte_band) > 0) from base where pte_score is not null),
      'DET', (select jsonb_build_object('count', count(*), 'bands', false) from base where det_score is not null),
      'SAT', (select jsonb_build_object('count', count(*), 'bands', false) from base where sat_min is not null),
      'ACT', (select jsonb_build_object('count', count(*), 'bands', false) from base where act_min is not null),
      'GRE', (select jsonb_build_object('count', count(*), 'bands', false) from base where gre_min is not null),
      'GMAT', (select jsonb_build_object('count', count(*), 'bands', false) from base where gmat_min is not null)),
    'flags', jsonb_build_object(
      'esl', exists (select 1 from base where esl_available is true),
      'without_english', exists (select 1 from base where english_required is false),
      'english_waiver', exists (select 1 from base where public.course_has_waiver(english_waiver)),
      'without_gre', exists (select 1 from base where gre_required is false),
      'without_gmat', exists (select 1 from base where gmat_required is false),
      'without_maths', exists (select 1 from base where maths_required is false),
      'stem', exists (select 1 from base where stem is true),
      'fifteen_years', exists (select 1 from base where accepts_fifteen_years is true),
      'fee_waiver', exists (select 1 from base where application_fee_waiver is true),
      'scholarship', exists (select 1 from base where public.course_has_scholarship(scholarship_available, scholarship, scholarship_amount)),
      'academic', exists (select 1 from base where nullif(btrim(academic_requirement), '') is not null),
      'open', exists (select 1 from intakes where status = 'Available'),
      'upcoming', exists (select 1 from intakes where status = 'Upcoming'),
      'deadlines', exists (select 1 from intakes where application_deadline is not null)),
    'intakeMonths', (select coalesce(jsonb_agg(distinct intake_month), '[]') from intakes),
    'intakeYears', (select coalesce(jsonb_agg(distinct intake_year), '[]') from intakes),
    'intakeLabels', (select coalesce(jsonb_agg(l order by y, m), '[]') from (select distinct public.intake_label(intake_month, intake_year) as l, intake_year as y, intake_month as m from intakes) z)
  ) into res;
  return res;
end $$;
revoke all on function public.course_search_facets(jsonb) from public, anon;
grant execute on function public.course_search_facets(jsonb) to authenticated;

-- =============================================================== import also fills the new fields
-- Same import as 0010, with the verified search fields added. Columns not in a file stay empty.
create or replace function public.import_catalogue(p jsonb, p_overwrite boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  res jsonb;
  u jsonb; c jsonb; uid text; cid text; k text; v jsonb; n int; changed int := 0; touched boolean;
  -- course field → column type; anything else in "details" is ignored (it is still kept in source_data)
  cols constant jsonb := '{"campus":"text","website_url":"text","scholarship_url":"text","open_intakes":"text","intake_year_text":"text",
    "application_deadline_text":"text","application_fee":"text","application_mode":"text","tuition_text":"text","scholarship_available":"text",
    "average_scholarship":"text","backlog_range":"text","remarks":"text","english_waiver":"text","ielts_band":"numeric",
    "toefl_score":"numeric","toefl_band":"numeric","pte_score":"numeric","pte_band":"numeric","det_score":"numeric","source_serial":"text",
    "program_level":"text","discipline_area":"text","study_mode":"text","esl_available":"boolean","sat_min":"numeric","act_min":"numeric","gre_min":"numeric",
    "gmat_min":"numeric","english_required":"boolean","gre_required":"boolean","gmat_required":"boolean","maths_required":"boolean","stem":"boolean",
    "accepts_fifteen_years":"boolean","application_fee_waiver":"boolean","scholarship_amount":"numeric"}';
begin
  if public.is_end_user_request() and not public.staff_can('catalogue') then
    raise exception 'Only staff with catalogue access can import courses';
  end if;
  res := public.import_catalogue_base(p, p_overwrite);

  for u in select * from jsonb_array_elements(coalesce(p -> 'universities', '[]')) loop
    if nullif(u ->> 'ranking_details', '') is not null then
      update public.universities t set ranking_details = u ->> 'ranking_details'
      where public.norm_name(t.name) = public.norm_name(u ->> 'name')
        and (p_overwrite or t.ranking_details is null) and t.ranking_details is distinct from u ->> 'ranking_details';
    end if;
    if nullif(u ->> 'state', '') is not null then
      update public.universities t set state = u ->> 'state'
      where public.norm_name(t.name) = public.norm_name(u ->> 'name')
        and (p_overwrite or t.state is null) and t.state is distinct from u ->> 'state';
    end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p -> 'courses', '[]')) loop
    select co.id into cid from public.courses co join public.universities un on un.id = co.university_id
    where public.norm_name(un.name) = public.norm_name(c ->> 'university') and public.norm_name(co.name) = public.norm_name(c ->> 'name')
    order by un.id, co.id limit 1;
    if cid is null then continue; end if;  -- rejected by the base import (already reported)
    touched := false;
    for k, v in select * from jsonb_each(coalesce(c -> 'details', '{}')) loop
      if not cols ? k or jsonb_typeof(v) = 'null' then continue; end if;
      execute format('update public.courses set %1$I = ($1 #>> ''{}'')::%2$s where id = $2 and ($3 or %1$I is null) and %1$I is distinct from ($1 #>> ''{}'')::%2$s',
                     k, cols ->> k) using v, cid, p_overwrite;
      get diagnostics n = row_count;
      touched := touched or n > 0;
    end loop;
    -- The source record always mirrors the latest import of this course.
    if c ? 'source_data' then
      update public.courses t set source_data = c -> 'source_data', source_row = (c ->> 'source_row')::int,
        source_notes = coalesce(array(select jsonb_array_elements_text(c -> 'source_notes')), '{}')
      where t.id = cid and (t.source_data, t.source_row, t.source_notes) is distinct from
        (c -> 'source_data', (c ->> 'source_row')::int, coalesce(array(select jsonb_array_elements_text(c -> 'source_notes')), '{}'));
      get diagnostics n = row_count;
      touched := touched or n > 0;
    end if;
    if touched then changed := changed + 1; end if;
  end loop;
  res := res || jsonb_build_object('details_updated', changed);

  insert into public.catalogue_imports (imported_by, source, file_name, overwrite, rows_read, summary, notes, unmapped_columns)
  values (auth.uid(), nullif(btrim(p ->> 'source'), ''), p ->> 'file_name', p_overwrite, (p ->> 'rows_read')::int, res,
          coalesce(array(select jsonb_array_elements_text(p -> 'notes')), '{}'),
          coalesce(array(select jsonb_array_elements_text(p -> 'unmapped_columns')), '{}'));
  return res;
end $$;
revoke all on function public.import_catalogue(jsonb, boolean) from public, anon;
grant execute on function public.import_catalogue(jsonb, boolean) to authenticated;
