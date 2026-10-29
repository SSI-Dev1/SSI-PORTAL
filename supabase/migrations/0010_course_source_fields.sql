-- 0010_course_source_fields.sql — run after 0009_application_duplicates.sql
-- (Supabase SQL Editor: Save this query as "0010_course_source_fields")
--
-- Keeps every column of a course spreadsheet, not only the basic course details:
-- * courses get their own fields for the course website, scholarship link, application fee /
--   mode / deadline text, backlog range, remarks, English waiver, each test score and band,
--   the original tuition and scholarship text (with the approximate INR amounts), the original
--   intake text, and the source row itself (source_data: every column, including columns the
--   importer does not know yet) plus the sheet's footnotes (source_notes).
-- * universities get ranking_details (multi-line ranking text).
-- * catalogue_imports records every import (who, when, file, summary, notes, unmapped columns).
-- * import_catalogue() keeps its behaviour and also applies these fields. With p_overwrite =
--   false it only fills empty fields, so manual edits by Admin are kept. The source record
--   (source_data, source_row, source_notes) always reflects the latest import.
-- Nothing is deleted. Safe to run more than once.

-- =============================================================== columns
alter table public.universities add column if not exists ranking_details text;

alter table public.courses add column if not exists campus text;
alter table public.courses add column if not exists website_url text;
alter table public.courses add column if not exists scholarship_url text;
alter table public.courses add column if not exists open_intakes text;
alter table public.courses add column if not exists intake_year_text text;
alter table public.courses add column if not exists application_deadline_text text;
alter table public.courses add column if not exists application_fee text;
alter table public.courses add column if not exists application_mode text;
alter table public.courses add column if not exists tuition_text text;
alter table public.courses add column if not exists scholarship_available text;
alter table public.courses add column if not exists average_scholarship text;
alter table public.courses add column if not exists backlog_range text;
alter table public.courses add column if not exists remarks text;
alter table public.courses add column if not exists english_waiver text;
alter table public.courses add column if not exists ielts_band numeric;
alter table public.courses add column if not exists toefl_score numeric;
alter table public.courses add column if not exists toefl_band numeric;
alter table public.courses add column if not exists pte_score numeric;
alter table public.courses add column if not exists pte_band numeric;
alter table public.courses add column if not exists det_score numeric;
alter table public.courses add column if not exists source_serial text;
alter table public.courses add column if not exists source_row integer;
alter table public.courses add column if not exists source_data jsonb;
alter table public.courses add column if not exists source_notes text[] not null default '{}';

-- Links must be web addresses (they are opened from the Course Finder).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_links_http') then
    alter table public.courses add constraint courses_links_http check (
      (website_url is null or website_url ~* '^https?://') and (scholarship_url is null or scholarship_url ~* '^https?://'));
  end if;
end $$;

-- =============================================================== import history
create table if not exists public.catalogue_imports (
  id               text primary key default gen_random_uuid()::text,
  imported_at      timestamptz not null default now(),
  imported_by      uuid,
  source           text,
  file_name        text,
  overwrite        boolean not null default false,
  rows_read        integer,
  summary          jsonb not null default '{}',
  notes            text[] not null default '{}',
  unmapped_columns text[] not null default '{}'
);
alter table public.catalogue_imports enable row level security;
revoke all on public.catalogue_imports from anon, authenticated;
grant select on public.catalogue_imports to authenticated;
drop policy if exists "catalogue_imports: staff read" on public.catalogue_imports;
create policy "catalogue_imports: staff read" on public.catalogue_imports for select to authenticated
  using (public.staff_can('catalogue'));

-- =============================================================== import
-- The 0007 function becomes import_catalogue_base(); import_catalogue() wraps it.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'import_catalogue_base' and pronamespace = 'public'::regnamespace) then
    alter function public.import_catalogue(jsonb, boolean) rename to import_catalogue_base;
  end if;
end $$;
revoke all on function public.import_catalogue_base(jsonb, boolean) from public, anon, authenticated;

create or replace function public.import_catalogue(p jsonb, p_overwrite boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  res jsonb;
  u jsonb; c jsonb; uid text; cid text; k text; v jsonb; n int; changed int := 0; touched boolean;
  -- course field → column type; anything else in "details" is ignored (it is still kept in source_data)
  cols constant jsonb := '{"campus":"text","website_url":"text","scholarship_url":"text","open_intakes":"text","intake_year_text":"text",
    "application_deadline_text":"text","application_fee":"text","application_mode":"text","tuition_text":"text","scholarship_available":"text",
    "average_scholarship":"text","backlog_range":"text","remarks":"text","english_waiver":"text","ielts_band":"numeric",
    "toefl_score":"numeric","toefl_band":"numeric","pte_score":"numeric","pte_band":"numeric","det_score":"numeric","source_serial":"text"}';
begin
  if public.is_end_user_request() and not public.staff_can('catalogue') then
    raise exception 'Only staff with catalogue access can import courses';
  end if;
  res := public.import_catalogue_base(p, p_overwrite);

  for u in select * from jsonb_array_elements(coalesce(p -> 'universities', '[]')) loop
    if nullif(u ->> 'ranking_details', '') is null then continue; end if;
    update public.universities t set ranking_details = u ->> 'ranking_details'
    where public.norm_name(t.name) = public.norm_name(u ->> 'name')
      and (p_overwrite or t.ranking_details is null) and t.ranking_details is distinct from u ->> 'ranking_details';
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
