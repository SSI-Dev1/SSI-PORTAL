-- 0061_student_import.sql — run after 0060_client_reconciliation.sql
-- (Supabase SQL Editor: Save this query as "0061_student_import")
--
-- Student data import with university preferences.
-- * student_university_preferences: every university choice of a student, one row per spreadsheet
--   row, with all of its application-level source values (portal, submission, status, pending
--   documents, offer, current status, payment, deferral, visa, remarks and their dates). The original
--   cells are kept in "source" (passport excluded). Priority 1 = the primary choice; blank = other
--   option (no 2 / 3 / 4 is invented). At most one primary per student (unique index); two Priority 1
--   rows for one student import with no primary and the student flagged "Priority conflict".
-- * students: priority intake (text + month), import key, the agent name as written, conflict flag.
-- * student_agent_mappings: Agent Name (as written) → existing partner, reused by later imports, so
--   spelling variants never create new partner organisations. Unmapped agents keep the student in
--   the preview for review; nothing is guessed.
-- * preview_student_import / apply_student_import (Super Admin, or Admin Staff with Students):
--   matching by passport (exact), earlier import key, never by name alone (a same-name student under
--   the same agent is "review"). Apply is idempotent (stable keys + on conflict do nothing), fills
--   only blank fields of existing students, never overwrites, records the batch, sends nothing and
--   records no employee work (historical data, not today's work).
-- * set_primary_university: change the primary choice in one transaction, recorded with who / when.
-- Applications are not created from the sheet: the sheet names universities and courses as free text,
-- which cannot be matched reliably to catalogue courses. A preference links to an application later.
-- Safe to run more than once.

-- =============================================================== schema
alter table public.students add column if not exists priority_intake text check (char_length(priority_intake) <= 60);
alter table public.students add column if not exists priority_intake_month date;
alter table public.students add column if not exists agent_name_source text check (char_length(agent_name_source) <= 200);
alter table public.students add column if not exists import_key text;
alter table public.students add column if not exists import_batch_id uuid;
alter table public.students add column if not exists priority_conflict boolean not null default false;
create unique index if not exists students_import_key_idx on public.students (import_key) where import_key is not null;
create index if not exists students_passport_idx on public.students (upper(btrim(passport_no))) where passport_no is not null and btrim(passport_no) <> '';

create table if not exists public.student_import_batches (
  id          uuid primary key default gen_random_uuid(),
  file_name   text check (char_length(file_name) <= 300),
  file_sha256 text check (char_length(file_sha256) <= 64),
  imported_by uuid,
  imported_at timestamptz not null default now(),
  summary     jsonb not null default '{}'
);

create table if not exists public.student_agent_mappings (
  agent_key  text primary key,               -- lower-case, spaces collapsed
  agent_text text not null,
  partner_id text not null references public.partners (id) on delete cascade,
  mapped_by  uuid,
  mapped_at  timestamptz not null default now()
);

create table if not exists public.student_university_preferences (
  id                    uuid primary key default gen_random_uuid(),
  student_id            text not null references public.students (id) on delete cascade,
  is_primary            boolean not null default false,
  priority_source       text,                -- the Priority cell as written ('1' or blank)
  university_name       text not null check (char_length(university_name) <= 300),
  university_id         text references public.universities (id) on delete set null,
  course_name           text check (char_length(course_name) <= 300),
  program_intake        text check (char_length(program_intake) <= 60),
  program_intake_month  date,
  country               text check (char_length(country) <= 80),
  application_portal    text check (char_length(application_portal) <= 200),
  application_submitted text check (char_length(application_submitted) <= 40),
  submission_date       date,
  application_status    text check (char_length(application_status) <= 200),
  pending_documents     text check (char_length(pending_documents) <= 1000),
  offer_status          text check (char_length(offer_status) <= 200),
  offer_status_date     date,
  current_status        text check (char_length(current_status) <= 200),
  current_status_date   date,
  payment               text check (char_length(payment) <= 200),
  payment_status_date   date,
  deferral_details      text check (char_length(deferral_details) <= 1000),
  visa_status           text check (char_length(visa_status) <= 200),
  visa_status_date      date,
  remarks               text check (char_length(remarks) <= 4000),
  application_id        text references public.applications (id) on delete set null,
  source                jsonb not null default '{}',   -- original cells by column (passport excluded) + source row
  date_issues           text[] not null default '{}',  -- columns whose value was kept as text (not a valid date)
  import_key            text unique,
  import_batch_id       uuid references public.student_import_batches (id) on delete set null,
  primary_set_by        uuid,
  primary_set_at        timestamptz,
  created_at            timestamptz not null default now()
);
create unique index if not exists student_university_one_primary on public.student_university_preferences (student_id) where is_primary;
create index if not exists student_university_student_idx on public.student_university_preferences (student_id);

-- Staff only: the sheet's internal statuses, payments and remarks are SSI GLOBAL working data.
alter table public.student_university_preferences enable row level security;
alter table public.student_import_batches enable row level security;
alter table public.student_agent_mappings enable row level security;
revoke all on public.student_university_preferences, public.student_import_batches, public.student_agent_mappings from anon;
revoke insert, update, delete on public.student_university_preferences, public.student_import_batches, public.student_agent_mappings from authenticated;
grant select on public.student_university_preferences, public.student_import_batches, public.student_agent_mappings to authenticated;
drop policy if exists "student preferences: staff read" on public.student_university_preferences;
create policy "student preferences: staff read" on public.student_university_preferences for select to authenticated
  using ((select public.is_staff()) and exists (select 1 from public.students s where s.id = student_id));

create or replace function public.can_import_students()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and (public.is_super_admin() or (public.my_role() = 'admin_staff' and public.staff_can('students')));
$$;
drop policy if exists "student import batches: admin read" on public.student_import_batches;
create policy "student import batches: admin read" on public.student_import_batches for select to authenticated using ((select public.can_import_students()));
drop policy if exists "student agent mappings: staff read" on public.student_agent_mappings;
create policy "student agent mappings: staff read" on public.student_agent_mappings for select to authenticated using ((select public.is_staff()));
do $$ begin
  begin alter publication supabase_realtime add table public.student_university_preferences; exception when others then null; end;
end $$;

create or replace function public.import_text_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g'), '');
$$;

-- =============================================================== preview / apply
-- p_groups: [{ key, name, passport, agent, priority_intake, priority_intake_month, country,
--              source_rows: [int], flags: [text],
--              prefs: [{ key, source_row, priority, university, course, program_intake, program_intake_month,
--                        country, portal, submitted, submission_date, application_status, pending_documents,
--                        offer_status, offer_status_date, current_status, current_status_date, payment,
--                        payment_status_date, deferral, visa_status, visa_status_date, remarks,
--                        date_issues: [text], source: {...} }] }]
-- p_agent_map: { "<agent text>": "<partner id>" } — the administrator's choices for this import.
create or replace function public.student_import_plan(p_groups jsonb, p_agent_map jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g jsonb; out jsonb := '[]'; agent text; akey text; pid text; agent_status text; match text; sid text; n int; why text;
        p1 int; cand jsonb;
begin
  for g in select * from jsonb_array_elements(coalesce(p_groups, '[]')) loop
    agent := nullif(btrim(coalesce(g ->> 'agent', '')), '');
    akey := public.import_text_key(agent);
    pid := null; agent_status := 'unmapped'; cand := null;
    if akey is null then agent_status := 'missing';
    elsif p_agent_map ? agent and nullif(p_agent_map ->> agent, '') is not null then
      pid := p_agent_map ->> agent;
      agent_status := case when exists (select 1 from public.partners o where o.id = pid and o.archived_at is null) then 'chosen' else 'unmapped' end;
      if agent_status = 'unmapped' then pid := null; end if;
    else
      select m.partner_id into pid from public.student_agent_mappings m where m.agent_key = akey;
      if pid is not null then agent_status := 'mapped';
      else
        select count(*), min(o.id), jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)) into n, pid, cand from public.partners o
        where o.archived_at is null and not o.internal and public.import_text_key(o.name) = akey;
        if n = 1 then agent_status := 'matched'; elsif n > 1 then agent_status := 'ambiguous'; pid := null; else pid := null; end if;
      end if;
    end if;
    -- Student match: an earlier import of the same key, else exact passport. A name alone is never enough.
    sid := null; match := 'new'; why := null;
    select id into sid from public.students where import_key = g ->> 'key';
    if sid is not null then match := 'existing';
    elsif nullif(btrim(coalesce(g ->> 'passport', '')), '') is not null then
      select count(*), min(id) into n, sid from public.students where upper(btrim(passport_no)) = upper(btrim(g ->> 'passport'));
      if n = 1 then match := 'existing'; elsif n > 1 then match := 'review'; why := 'Several students have this passport number'; sid := null; end if;
    end if;
    if match = 'new' and exists (select 1 from public.students s where public.import_text_key(s.first_name || ' ' || s.last_name) = public.import_text_key(g ->> 'name')
                                  and (pid is null or s.partner_id = pid)) then
      match := 'review'; why := 'A student with the same name already exists — check it is not the same person';
    end if;
    if nullif(g ->> 'review', '') is not null then match := 'review'; why := g ->> 'review'; sid := null; end if;
    if match = 'existing' and pid is not null and (select partner_id from public.students where id = sid) <> pid then
      match := 'review'; why := 'The matching student belongs to another agent';
    end if;
    select count(*) into p1 from jsonb_array_elements(coalesce(g -> 'prefs', '[]')) x where x ->> 'priority' ~ '^1(\.0+)?$';
    out := out || jsonb_build_object('key', g ->> 'key', 'name', g ->> 'name', 'agent', agent, 'agent_status', agent_status, 'partner_id', pid,
      'partner_name', (select name from public.partners where id = pid), 'agent_candidates', cand,
      'match', match, 'student_id', sid, 'match_reason', why, 'prefs', jsonb_array_length(coalesce(g -> 'prefs', '[]')),
      'primary', case when p1 = 1 then 'ok' when p1 > 1 then 'conflict' else 'none' end,
      'source_rows', g -> 'source_rows', 'flags', coalesce(g -> 'flags', '[]'),
      'importable', pid is not null and match in ('new', 'existing') and nullif(btrim(coalesce(g ->> 'name', '')), '') is not null);
  end loop;
  return out;
end $$;
revoke all on function public.student_import_plan(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.preview_student_import(p_groups jsonb, p_agent_map jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare plan jsonb;
begin
  if not public.can_import_students() then raise exception 'Only Super Admin or Admin Staff with Students can import students'; end if;
  if jsonb_typeof(coalesce(p_groups, '[]')) <> 'array' or jsonb_array_length(coalesce(p_groups, '[]')) > 5000 then raise exception 'Up to 5000 students per import'; end if;
  plan := public.student_import_plan(p_groups, coalesce(p_agent_map, '{}'));
  return jsonb_build_object('groups', plan,
    'existing_prefs', (select count(*) from public.student_university_preferences where import_key in (
                         select x ->> 'key' from jsonb_array_elements(p_groups) g, jsonb_array_elements(g -> 'prefs') x)));
end $$;

create or replace function public.apply_student_import(p_groups jsonb, p_agent_map jsonb, p_file_name text, p_sha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan jsonb; pl jsonb; g jsonb; x jsonb; bid uuid; sid text; nm text; fn text; ln text; v_agent text; k text; pid uuid;
        created int := 0; updated int := 0; matched int := 0; prefs_new int := 0; prefs_existing int := 0; primaries int := 0; conflicts int := 0;
        skipped jsonb := '[]'; p1 int; rid uuid;
begin
  if not public.can_import_students() then raise exception 'Only Super Admin or Admin Staff with Students can import students'; end if;
  if jsonb_typeof(coalesce(p_groups, '[]')) <> 'array' or jsonb_array_length(coalesce(p_groups, '[]')) > 5000 then raise exception 'Up to 5000 students per import'; end if;
  perform pg_advisory_xact_lock(hashtext('student-import'));
  -- Historical data: nothing here is anyone's work today, and no partner notification is due.
  perform set_config('ssi.historical_reconciliation', 'on', true);
  plan := public.student_import_plan(p_groups, coalesce(p_agent_map, '{}'));
  insert into public.student_import_batches (file_name, file_sha256, imported_by) values (left(p_file_name, 300), left(p_sha, 64), auth.uid()) returning id into bid;
  -- Remember the administrator's agent choices for later imports (one mapping per spelling).
  for v_agent in select jsonb_object_keys(coalesce(p_agent_map, '{}')) loop
    if public.import_text_key(v_agent) is not null and exists (select 1 from public.partners o where o.id = p_agent_map ->> v_agent and o.archived_at is null) then
      insert into public.student_agent_mappings (agent_key, agent_text, partner_id, mapped_by) values (public.import_text_key(v_agent), v_agent, p_agent_map ->> v_agent, auth.uid())
      on conflict (agent_key) do update set partner_id = excluded.partner_id, agent_text = excluded.agent_text, mapped_by = excluded.mapped_by, mapped_at = now();
    end if;
  end loop;
  for g, pl in select a.value, b.value from jsonb_array_elements(p_groups) with ordinality a(value, i) join jsonb_array_elements(plan) with ordinality b(value, j) on a.i = b.j loop
    if not (pl ->> 'importable')::boolean then
      skipped := skipped || jsonb_build_object('key', g ->> 'key', 'name', g ->> 'name', 'rows', g -> 'source_rows',
        'reason', case when (pl ->> 'match') = 'review' then pl ->> 'match_reason' when pl ->> 'partner_id' is null then 'Agent not mapped to a partner: ' || coalesce(pl ->> 'agent', '(blank)') else 'Student name missing' end);
      continue;
    end if;
    nm := regexp_replace(btrim(g ->> 'name'), '\s+', ' ', 'g');
    if pl ->> 'match' = 'existing' then
      sid := pl ->> 'student_id'; matched := matched + 1;
      -- Fill only what is blank; production values are never overwritten.
      update public.students set
        passport_no = case when nullif(btrim(coalesce(passport_no, '')), '') is null then nullif(btrim(coalesce(g ->> 'passport', '')), '') else passport_no end,
        priority_intake = coalesce(priority_intake, nullif(g ->> 'priority_intake', '')),
        priority_intake_month = coalesce(priority_intake_month, nullif(g ->> 'priority_intake_month', '')::date),
        agent_name_source = coalesce(agent_name_source, pl ->> 'agent'),
        import_key = coalesce(import_key, g ->> 'key'),
        preferred_countries = case when cardinality(preferred_countries) = 0 and nullif(g ->> 'country', '') is not null then array[g ->> 'country'] else preferred_countries end
      where id = sid and (
        (nullif(btrim(coalesce(passport_no, '')), '') is null and nullif(btrim(coalesce(g ->> 'passport', '')), '') is not null)
        or (priority_intake is null and nullif(g ->> 'priority_intake', '') is not null)
        or (agent_name_source is null and pl ->> 'agent' is not null)
        or import_key is null
        or (cardinality(preferred_countries) = 0 and nullif(g ->> 'country', '') is not null));
      if found then updated := updated + 1; end if;
    else
      fn := split_part(nm, ' ', 1);
      ln := btrim(substr(nm, char_length(fn) + 1));
      insert into public.students (partner_id, first_name, last_name, email, passport_no, preferred_countries, status,
                                   priority_intake, priority_intake_month, agent_name_source, import_key, import_batch_id)
      values (pl ->> 'partner_id', fn, ln, '', nullif(btrim(coalesce(g ->> 'passport', '')), ''),
              case when nullif(g ->> 'country', '') is not null then array[g ->> 'country'] else '{}' end, 'Active',
              nullif(g ->> 'priority_intake', ''), nullif(g ->> 'priority_intake_month', '')::date, pl ->> 'agent', g ->> 'key', bid)
      returning id into sid;
      created := created + 1;
    end if;
    select count(*) into p1 from jsonb_array_elements(g -> 'prefs') y where y ->> 'priority' ~ '^1(\.0+)?$';
    for x in select * from jsonb_array_elements(g -> 'prefs') loop
      insert into public.student_university_preferences (student_id, is_primary, priority_source, university_name, university_id, course_name,
        program_intake, program_intake_month, country, application_portal, application_submitted, submission_date, application_status,
        pending_documents, offer_status, offer_status_date, current_status, current_status_date, payment, payment_status_date,
        deferral_details, visa_status, visa_status_date, remarks, source, date_issues, import_key, import_batch_id)
      values (sid,
        -- Priority 1 becomes primary only when it is the student's single Priority 1 and no primary is set yet.
        coalesce(p1 = 1 and x ->> 'priority' ~ '^1(\.0+)?$', false) and not exists (select 1 from public.student_university_preferences e where e.student_id = sid and e.is_primary),
        nullif(x ->> 'priority', ''), btrim(x ->> 'university'),
        (select u.id from public.universities u where public.import_text_key(u.name) = public.import_text_key(x ->> 'university') limit 1),
        nullif(btrim(coalesce(x ->> 'course', '')), ''), nullif(x ->> 'program_intake', ''), nullif(x ->> 'program_intake_month', '')::date,
        nullif(x ->> 'country', ''), nullif(btrim(coalesce(x ->> 'portal', '')), ''), nullif(x ->> 'submitted', ''), nullif(x ->> 'submission_date', '')::date,
        nullif(btrim(coalesce(x ->> 'application_status', '')), ''), nullif(btrim(coalesce(x ->> 'pending_documents', '')), ''),
        nullif(btrim(coalesce(x ->> 'offer_status', '')), ''), nullif(x ->> 'offer_status_date', '')::date,
        nullif(btrim(coalesce(x ->> 'current_status', '')), ''), nullif(x ->> 'current_status_date', '')::date,
        nullif(btrim(coalesce(x ->> 'payment', '')), ''), nullif(x ->> 'payment_status_date', '')::date,
        nullif(btrim(coalesce(x ->> 'deferral', '')), ''), nullif(btrim(coalesce(x ->> 'visa_status', '')), ''), nullif(x ->> 'visa_status_date', '')::date,
        nullif(btrim(coalesce(x ->> 'remarks', '')), ''), coalesce(x -> 'source', '{}') - 'passport number',
        coalesce(array(select jsonb_array_elements_text(x -> 'date_issues')), '{}'), x ->> 'key', bid)
      on conflict (import_key) do nothing
      returning id into rid;
      if rid is not null then prefs_new := prefs_new + 1; else prefs_existing := prefs_existing + 1; end if;
      rid := null;
    end loop;
    if p1 > 1 and not exists (select 1 from public.student_university_preferences e where e.student_id = sid and e.is_primary) then
      update public.students set priority_conflict = true where id = sid and not priority_conflict;
      conflicts := conflicts + 1;
    end if;
    if exists (select 1 from public.student_university_preferences e where e.student_id = sid and e.is_primary) then primaries := primaries + 1; end if;
  end loop;
  update public.student_import_batches set summary = jsonb_build_object('students_created', created, 'students_matched', matched, 'students_updated', updated,
    'preferences_created', prefs_new, 'preferences_already_imported', prefs_existing, 'students_with_primary', primaries, 'priority_conflicts', conflicts,
    'skipped', skipped) where id = bid;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
  values (auth.uid(), case when public.is_super_admin() then 'super_admin' else 'admin_staff' end, 'student_import', 'student_import_batches', bid::text,
          jsonb_build_object('file', left(p_file_name, 300), 'created', created, 'matched', matched, 'preferences', prefs_new, 'skipped', jsonb_array_length(skipped)));
  perform set_config('ssi.historical_reconciliation', '', true);
  return jsonb_build_object('batch_id', bid, 'students_created', created, 'students_matched', matched, 'students_updated', updated,
    'preferences_created', prefs_new, 'preferences_already_imported', prefs_existing, 'students_with_primary', primaries,
    'priority_conflicts', conflicts, 'skipped', skipped);
end $$;

-- =============================================================== Set as Primary Choice
create or replace function public.set_primary_university(p_pref uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  if not (public.my_profile_ok() and public.is_staff() and (public.is_super_admin() or public.staff_can('students'))) then
    raise exception 'Not allowed to change university preferences';
  end if;
  select * into p from public.student_university_preferences where id = p_pref for update;
  if p.id is null then raise exception 'University choice not found'; end if;
  perform 1 from public.students where id = p.student_id for update;   -- one change at a time per student
  if p.is_primary then return; end if;
  update public.student_university_preferences set is_primary = false where student_id = p.student_id and is_primary;
  update public.student_university_preferences set is_primary = true, primary_set_by = auth.uid(), primary_set_at = now() where id = p_pref;
  update public.students set priority_conflict = false where id = p.student_id and priority_conflict;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
  values (auth.uid(), public.my_role(), 'primary_university_set', 'students', p.student_id,
          jsonb_build_object('preference_id', p_pref, 'university', p.university_name, 'course', p.course_name));
end $$;

do $$
declare f text;
begin
  foreach f in array array['can_import_students()', 'preview_student_import(jsonb, jsonb)', 'apply_student_import(jsonb, jsonb, text, text)',
                           'set_primary_university(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.import_text_key(text) from public, anon;
grant execute on function public.import_text_key(text) to authenticated;
