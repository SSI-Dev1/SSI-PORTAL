-- 0007_course_catalogue.sql — run after 0006_realtime_catalogue.sql
-- (Supabase SQL Editor: Save this query as "0007_course_catalogue")
--
-- Course catalogue for real university data:
-- * Universities and courses get the details the toolkit spreadsheets carry (fees,
--   scholarships, entry / English / compliance requirements, CAS deposit, MOI lists) and an
--   active flag. Nothing is hard-coded in the app.
-- * course_intakes: one row per intake (month + year, induction / start / end dates, CAS
--   deadline, enrolment deadline, status Available / Upcoming / Closed, active flag).
--   courses.intakes (used by application forms) is kept in sync automatically.
-- * blacklisted_institutions: institutions whose qualifications are not accepted.
-- * import_catalogue(): validated, transactional upsert used by the Admin Excel import and
--   by 0008. It never deletes anything; matching is by name (case/space-insensitive).
-- * Only employees with the "catalogue" permission can change any of it (RLS); every
--   change is in the audit log and streamed by Realtime.

-- =============================================================== universities / courses
alter table public.universities add column if not exists active boolean not null default true;
alter table public.universities add column if not exists cas_deposit text;
alter table public.universities add column if not exists payment_plan text;
alter table public.universities add column if not exists moi_accepted text[] not null default '{}';
alter table public.universities add column if not exists notes text;
alter table public.universities add column if not exists source text;
alter table public.universities add column if not exists updated_at timestamptz not null default now();

alter table public.courses add column if not exists active boolean not null default true;
alter table public.courses add column if not exists faculty text;
alter table public.courses add column if not exists scholarship text;
alter table public.courses add column if not exists tuition_after_scholarship numeric;
alter table public.courses add column if not exists early_bird text;
alter table public.courses add column if not exists accommodation text;
alter table public.courses add column if not exists academic_requirement text;
alter table public.courses add column if not exists english_requirement text;
alter table public.courses add column if not exists compliance_requirement text;
alter table public.courses add column if not exists course_requirement text;
alter table public.courses add column if not exists documents_required text;
alter table public.courses add column if not exists source text;
alter table public.courses add column if not exists updated_at timestamptz not null default now();

create index if not exists universities_name_key on public.universities (lower(btrim(name)));
create index if not exists courses_name_key on public.courses (university_id, lower(btrim(name)));

do $$
declare t text;
begin
  foreach t in array array['universities', 'courses'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- =============================================================== intakes
create table if not exists public.course_intakes (
  id                  text primary key default gen_random_uuid()::text,
  course_id           text not null references public.courses (id) on delete cascade,
  intake_month        int  not null check (intake_month between 1 and 12),
  intake_year         int  not null check (intake_year between 2000 and 2100),
  induction_date      date,
  start_date          date,
  end_date            date,
  application_deadline date,          -- e.g. CAS deadline
  enrolment_deadline  date,
  status              text not null default 'Available' check (status in ('Available', 'Upcoming', 'Closed')),
  active              boolean not null default true,
  notes               text,
  source              text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (course_id, intake_year, intake_month)
);
create index if not exists course_intakes_course_idx on public.course_intakes (course_id);
alter table public.course_intakes enable row level security;
revoke all on public.course_intakes from anon;
grant select, insert, update, delete on public.course_intakes to authenticated;

drop policy if exists "course intakes: read" on public.course_intakes;
drop policy if exists "course intakes: staff writes" on public.course_intakes;
create policy "course intakes: read" on public.course_intakes for select to authenticated using (public.is_active_user());
create policy "course intakes: staff writes" on public.course_intakes for all to authenticated
  using (public.staff_can('catalogue')) with check (public.staff_can('catalogue'));

drop trigger if exists course_intakes_touch on public.course_intakes;
create trigger course_intakes_touch before update on public.course_intakes for each row execute function public.touch_updated_at();

-- courses.intakes = labels of the course's open intakes ("Jan 2027"), oldest first.
create or replace function public.intake_label(m int, y int)
returns text language sql immutable set search_path = '' as $$
  select to_char(make_date(y, m, 1), 'Mon YYYY');
$$;

create or replace function public.sync_course_intakes(p_course text)
returns void language sql security definer set search_path = '' as $$
  update public.courses c set intakes = coalesce((
    select array_agg(public.intake_label(i.intake_month, i.intake_year) order by i.intake_year, i.intake_month)
    from public.course_intakes i
    where i.course_id = c.id and i.active and i.status <> 'Closed'), '{}')
  where c.id = p_course;
$$;
revoke all on function public.sync_course_intakes(text) from public, anon, authenticated;

create or replace function public.course_intakes_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_course_intakes(coalesce(new.course_id, old.course_id));
  if tg_op = 'UPDATE' and new.course_id is distinct from old.course_id then
    perform public.sync_course_intakes(old.course_id);
  end if;
  return null;
end $$;
drop trigger if exists course_intakes_sync on public.course_intakes;
create trigger course_intakes_sync after insert or update or delete on public.course_intakes
  for each row execute function public.course_intakes_changed();

-- Existing courses: turn their "Mon YYYY" intake labels into intake rows (once).
insert into public.course_intakes (course_id, intake_month, intake_year, status, source)
select c.id, extract(month from to_date(l, 'Mon YYYY'))::int, extract(year from to_date(l, 'Mon YYYY'))::int, 'Available', 'existing'
from public.courses c, unnest(c.intakes) l
where l ~ '^[A-Za-z]{3} [0-9]{4}$'
on conflict (course_id, intake_year, intake_month) do nothing;

-- =============================================================== blacklist
create table if not exists public.blacklisted_institutions (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  source     text,
  created_at timestamptz not null default now()
);
create unique index if not exists blacklisted_name_key on public.blacklisted_institutions (lower(btrim(name)));
alter table public.blacklisted_institutions enable row level security;
revoke all on public.blacklisted_institutions from anon;
grant select, insert, update, delete on public.blacklisted_institutions to authenticated;
drop policy if exists "blacklist: read" on public.blacklisted_institutions;
drop policy if exists "blacklist: staff writes" on public.blacklisted_institutions;
create policy "blacklist: read" on public.blacklisted_institutions for select to authenticated using (public.is_active_user());
create policy "blacklist: staff writes" on public.blacklisted_institutions for all to authenticated
  using (public.staff_can('catalogue')) with check (public.staff_can('catalogue'));

-- =============================================================== audit + realtime
do $$
declare t text;
begin
  foreach t in array array['course_intakes', 'blacklisted_institutions'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['course_intakes', 'blacklisted_institutions'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =============================================================== import
create or replace function public.norm_name(t text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g'));
$$;

-- Applies a catalogue payload (see src/lib/catalogue/types.ts) in one transaction.
-- p_overwrite = false keeps existing non-empty values (only fills blanks).
-- Returns counts per kind plus a list of rejected records with reasons.
create or replace function public.import_catalogue(p jsonb, p_overwrite boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u jsonb; c jsonb; i jsonb; b jsonb; before jsonb; after jsonb;
  uid text; cid text; iid text;
  src text := nullif(btrim(p ->> 'source'), '');
  res jsonb := jsonb_build_object(
    'universities', jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0),
    'courses',      jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0),
    'intakes',      jsonb_build_object('new', 0, 'updated', 0, 'unchanged', 0),
    'blacklist',    jsonb_build_object('new', 0, 'unchanged', 0),
    'invalid',      '[]'::jsonb);
  n int;
  levels text[] := array['Foundation', 'Diploma', 'Undergraduate', 'Postgraduate', 'PhD'];
  bump text;
begin
  if public.is_end_user_request() and not public.staff_can('catalogue') then
    raise exception 'Only staff with catalogue access can import courses';
  end if;

  -- ---------------------------------------------------------------- universities
  for u in select * from jsonb_array_elements(coalesce(p -> 'universities', '[]')) loop
    if public.norm_name(u ->> 'name') = '' or nullif(btrim(u ->> 'country'), '') is null then
      res := jsonb_set(res, '{invalid}', (res -> 'invalid') || jsonb_build_object('kind', 'university', 'name', u ->> 'name', 'reason', 'Name and country are required'));
      continue;
    end if;
    select id into uid from public.universities where public.norm_name(name) = public.norm_name(u ->> 'name') order by id limit 1;
    if uid is null then
      insert into public.universities (name, country, city, cas_deposit, payment_plan, moi_accepted, notes, website, source)
      values (btrim(u ->> 'name'), btrim(u ->> 'country'), u ->> 'city', u ->> 'cas_deposit', u ->> 'payment_plan',
              coalesce(array(select jsonb_array_elements_text(u -> 'moi_accepted')), '{}'), u ->> 'notes', u ->> 'website', src);
      bump := 'new';
    else
      update public.universities t set
        country      = case when p_overwrite or nullif(t.country, '') is null then coalesce(nullif(u ->> 'country', ''), t.country) else t.country end,
        city         = case when p_overwrite or nullif(t.city, '') is null then coalesce(nullif(u ->> 'city', ''), t.city) else t.city end,
        cas_deposit  = case when p_overwrite or t.cas_deposit is null then coalesce(u ->> 'cas_deposit', t.cas_deposit) else t.cas_deposit end,
        payment_plan = case when p_overwrite or t.payment_plan is null then coalesce(u ->> 'payment_plan', t.payment_plan) else t.payment_plan end,
        moi_accepted = case when (p_overwrite or cardinality(t.moi_accepted) = 0) and jsonb_array_length(coalesce(u -> 'moi_accepted', '[]')) > 0
                            then array(select jsonb_array_elements_text(u -> 'moi_accepted')) else t.moi_accepted end,
        notes        = case when p_overwrite or t.notes is null then coalesce(u ->> 'notes', t.notes) else t.notes end
      where t.id = uid
        and (t.country, t.city, t.cas_deposit, t.payment_plan, t.moi_accepted, t.notes) is distinct from (
          case when p_overwrite or nullif(t.country, '') is null then coalesce(nullif(u ->> 'country', ''), t.country) else t.country end,
          case when p_overwrite or nullif(t.city, '') is null then coalesce(nullif(u ->> 'city', ''), t.city) else t.city end,
          case when p_overwrite or t.cas_deposit is null then coalesce(u ->> 'cas_deposit', t.cas_deposit) else t.cas_deposit end,
          case when p_overwrite or t.payment_plan is null then coalesce(u ->> 'payment_plan', t.payment_plan) else t.payment_plan end,
          case when (p_overwrite or cardinality(t.moi_accepted) = 0) and jsonb_array_length(coalesce(u -> 'moi_accepted', '[]')) > 0
               then array(select jsonb_array_elements_text(u -> 'moi_accepted')) else t.moi_accepted end,
          case when p_overwrite or t.notes is null then coalesce(u ->> 'notes', t.notes) else t.notes end);
      get diagnostics n = row_count;
      bump := case when n > 0 then 'updated' else 'unchanged' end;
    end if;
    res := jsonb_set(res, array['universities', bump], to_jsonb((res -> 'universities' ->> bump)::int + 1));
  end loop;

  -- ---------------------------------------------------------------- courses + intakes
  for c in select * from jsonb_array_elements(coalesce(p -> 'courses', '[]')) loop
    select id into uid from public.universities where public.norm_name(name) = public.norm_name(c ->> 'university') order by id limit 1;
    if uid is null or public.norm_name(c ->> 'name') = '' then
      res := jsonb_set(res, '{invalid}', (res -> 'invalid') || jsonb_build_object('kind', 'course', 'name', c ->> 'name', 'reason', 'Unknown university or missing course name'));
      continue;
    end if;
    if not (c ->> 'level' = any (levels)) then
      res := jsonb_set(res, '{invalid}', (res -> 'invalid') || jsonb_build_object('kind', 'course', 'name', c ->> 'name', 'reason', 'Unknown study level "' || coalesce(c ->> 'level', '') || '"'));
      continue;
    end if;
    select id into cid from public.courses where university_id = uid and public.norm_name(name) = public.norm_name(c ->> 'name') order by id limit 1;
    if cid is null then
      if (c ->> 'tuition') is null then
        res := jsonb_set(res, '{invalid}', (res -> 'invalid') || jsonb_build_object('kind', 'course', 'name', c ->> 'name', 'reason', 'Tuition fee is required for a new course'));
        continue;
      end if;
      insert into public.courses (university_id, name, level, field, faculty, duration, tuition, currency, ielts_min, scholarship,
        tuition_after_scholarship, early_bird, accommodation, academic_requirement, english_requirement, compliance_requirement,
        course_requirement, documents_required, source)
      values (uid, btrim(c ->> 'name'), c ->> 'level', c ->> 'category', c ->> 'faculty', c ->> 'duration', (c ->> 'tuition')::numeric,
        coalesce(c ->> 'currency', 'GBP'), (c ->> 'ielts_min')::numeric, c ->> 'scholarship', (c ->> 'tuition_after_scholarship')::numeric,
        c ->> 'early_bird', c ->> 'accommodation', c ->> 'academic_requirement', c ->> 'english_requirement', c ->> 'compliance_requirement',
        c ->> 'course_requirement', c ->> 'documents_required', src)
      returning id into cid;
      bump := 'new';
    else
      select to_jsonb(t) - 'updated_at' - 'intakes' into before from public.courses t where t.id = cid;
      update public.courses t set
        level = case when p_overwrite then c ->> 'level' else t.level end,
        field = case when p_overwrite or t.field is null then coalesce(c ->> 'category', t.field) else t.field end,
        faculty = case when p_overwrite or t.faculty is null then coalesce(c ->> 'faculty', t.faculty) else t.faculty end,
        duration = case when p_overwrite or t.duration is null then coalesce(c ->> 'duration', t.duration) else t.duration end,
        tuition = case when p_overwrite then coalesce((c ->> 'tuition')::numeric, t.tuition) else t.tuition end,
        currency = case when p_overwrite then coalesce(c ->> 'currency', t.currency) else t.currency end,
        ielts_min = case when p_overwrite or t.ielts_min is null then coalesce((c ->> 'ielts_min')::numeric, t.ielts_min) else t.ielts_min end,
        scholarship = case when p_overwrite or t.scholarship is null then coalesce(c ->> 'scholarship', t.scholarship) else t.scholarship end,
        tuition_after_scholarship = case when p_overwrite or t.tuition_after_scholarship is null then coalesce((c ->> 'tuition_after_scholarship')::numeric, t.tuition_after_scholarship) else t.tuition_after_scholarship end,
        early_bird = case when p_overwrite or t.early_bird is null then coalesce(c ->> 'early_bird', t.early_bird) else t.early_bird end,
        accommodation = case when p_overwrite or t.accommodation is null then coalesce(c ->> 'accommodation', t.accommodation) else t.accommodation end,
        academic_requirement = case when p_overwrite or t.academic_requirement is null then coalesce(c ->> 'academic_requirement', t.academic_requirement) else t.academic_requirement end,
        english_requirement = case when p_overwrite or t.english_requirement is null then coalesce(c ->> 'english_requirement', t.english_requirement) else t.english_requirement end,
        compliance_requirement = case when p_overwrite or t.compliance_requirement is null then coalesce(c ->> 'compliance_requirement', t.compliance_requirement) else t.compliance_requirement end,
        course_requirement = case when p_overwrite or t.course_requirement is null then coalesce(c ->> 'course_requirement', t.course_requirement) else t.course_requirement end,
        documents_required = case when p_overwrite or t.documents_required is null then coalesce(c ->> 'documents_required', t.documents_required) else t.documents_required end
      where t.id = cid
      returning (to_jsonb(t) - 'updated_at' - 'intakes') into after;
      bump := case when after is distinct from before then 'updated' else 'unchanged' end;
    end if;
    res := jsonb_set(res, array['courses', bump], to_jsonb((res -> 'courses' ->> bump)::int + 1));

    for i in select * from jsonb_array_elements(coalesce(c -> 'intakes', '[]')) loop
      if (i ->> 'month') is null or (i ->> 'year') is null or (i ->> 'month')::int not between 1 and 12 then
        res := jsonb_set(res, '{invalid}', (res -> 'invalid') || jsonb_build_object('kind', 'intake', 'name', c ->> 'name', 'reason', 'Intake month and year are required'));
        continue;
      end if;
      select id into iid from public.course_intakes
      where course_id = cid and intake_year = (i ->> 'year')::int and intake_month = (i ->> 'month')::int;
      if iid is null then
        insert into public.course_intakes (course_id, intake_month, intake_year, induction_date, start_date, end_date,
          application_deadline, enrolment_deadline, status, notes, source)
        values (cid, (i ->> 'month')::int, (i ->> 'year')::int, (i ->> 'induction_date')::date, (i ->> 'start_date')::date,
          (i ->> 'end_date')::date, (i ->> 'application_deadline')::date, (i ->> 'enrolment_deadline')::date,
          coalesce(i ->> 'status', 'Available'), i ->> 'notes', src);
        bump := 'new';
      else
        update public.course_intakes t set
          induction_date = case when p_overwrite or t.induction_date is null then coalesce((i ->> 'induction_date')::date, t.induction_date) else t.induction_date end,
          start_date = case when p_overwrite or t.start_date is null then coalesce((i ->> 'start_date')::date, t.start_date) else t.start_date end,
          end_date = case when p_overwrite or t.end_date is null then coalesce((i ->> 'end_date')::date, t.end_date) else t.end_date end,
          application_deadline = case when p_overwrite or t.application_deadline is null then coalesce((i ->> 'application_deadline')::date, t.application_deadline) else t.application_deadline end,
          enrolment_deadline = case when p_overwrite or t.enrolment_deadline is null then coalesce((i ->> 'enrolment_deadline')::date, t.enrolment_deadline) else t.enrolment_deadline end,
          notes = case when p_overwrite or t.notes is null then coalesce(i ->> 'notes', t.notes) else t.notes end
        where t.id = iid
          and (t.induction_date, t.start_date, t.end_date, t.application_deadline, t.enrolment_deadline, t.notes) is distinct from (
            case when p_overwrite or t.induction_date is null then coalesce((i ->> 'induction_date')::date, t.induction_date) else t.induction_date end,
            case when p_overwrite or t.start_date is null then coalesce((i ->> 'start_date')::date, t.start_date) else t.start_date end,
            case when p_overwrite or t.end_date is null then coalesce((i ->> 'end_date')::date, t.end_date) else t.end_date end,
            case when p_overwrite or t.application_deadline is null then coalesce((i ->> 'application_deadline')::date, t.application_deadline) else t.application_deadline end,
            case when p_overwrite or t.enrolment_deadline is null then coalesce((i ->> 'enrolment_deadline')::date, t.enrolment_deadline) else t.enrolment_deadline end,
            case when p_overwrite or t.notes is null then coalesce(i ->> 'notes', t.notes) else t.notes end);
        get diagnostics n = row_count;
        bump := case when n > 0 then 'updated' else 'unchanged' end;
      end if;
      res := jsonb_set(res, array['intakes', bump], to_jsonb((res -> 'intakes' ->> bump)::int + 1));
    end loop;
  end loop;

  -- ---------------------------------------------------------------- blacklist
  for b in select * from jsonb_array_elements(coalesce(p -> 'blacklist', '[]')) loop
    if public.norm_name(b #>> '{}') = '' then continue; end if;
    insert into public.blacklisted_institutions (name, source) values (btrim(b #>> '{}'), src)
    on conflict (lower(btrim(name))) do nothing;
    get diagnostics n = row_count;
    bump := case when n > 0 then 'new' else 'unchanged' end;
    res := jsonb_set(res, array['blacklist', bump], to_jsonb((res -> 'blacklist' ->> bump)::int + 1));
  end loop;

  if public.is_end_user_request() then
    insert into public.audit_log (actor_id, actor_role, action, entity, changes)
    values (auth.uid(), public.my_role(), 'catalogue_import', 'courses',
            jsonb_build_object('source', src, 'overwrite', p_overwrite, 'summary', res - 'invalid', 'invalid', jsonb_array_length(res -> 'invalid')));
  end if;
  return res;
end $$;
revoke all on function public.import_catalogue(jsonb, boolean) from public, anon;
grant execute on function public.import_catalogue(jsonb, boolean) to authenticated;
