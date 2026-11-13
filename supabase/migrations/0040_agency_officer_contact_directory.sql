-- 0040_agency_officer_contact_directory.sql — run after 0039_linkedin_outreach_onboarding.sql
-- (Supabase SQL Editor: Save this query as "0040_agency_officer_contact_directory")
--
-- Agency List administration and the link to Clients & Branches.
-- * Officer assignment (administrators = agency_manager(): Super Admin, or Admin Staff with
--   "Partner registrations"): preview_agency_officer() shows how many agencies are unassigned,
--   already with that officer, or with someone else; assign_agency_officer() applies it and never
--   replaces another officer unless p_replace is true. Only eligible employees (active staff with
--   the Agencies & proposals permission and an HR record) can be chosen. Every change, from any
--   path (bulk, single, claim, edit), is kept in agency_officer_history. A linked partner's
--   Partnership Officer follows when it was empty or the previous officer. Work reports are not
--   touched: earlier credit stays with whoever did the work.
-- * Contact status correction: preview_agency_contact() / bulk_set_agency_contact(). Changes only
--   contact_status and its audit fields. It does NOT set first contact / last contact dates, does
--   NOT log calls or outreach and does NOT create work-report activity — a correction is not work.
--   The pipeline stage is never changed. Each operation is recorded in agency_bulk_operations.
-- * onboarded_agency_directory(): onboarded agencies for Clients & Branches — linked to a partner
--   (verified) or historically onboarded without one (pending verification), with a suggested
--   existing partner when the names match exactly (case, spaces and punctuation ignored) or one
--   name starts with the other. Suggestions are never applied automatically: an administrator
--   links them (reconcile_agency) or issues the registration (issue_agency_registration); portal
--   access and logins still come only from registration approval / activation.
-- Safe to run more than once.

-- =============================================================== history and audit
create table if not exists public.agency_officer_history (
  id           bigint generated always as identity primary key,
  prospect_id  uuid not null references public.agency_prospects (id) on delete cascade,
  from_officer uuid,
  to_officer   uuid,
  changed_by   uuid,
  change_kind  text not null default 'single' check (change_kind in ('single', 'bulk', 'claim', 'system')),
  operation_id uuid,
  note         text check (char_length(note) <= 500),
  at           timestamptz not null default now()
);
create index if not exists agency_officer_history_idx on public.agency_officer_history (prospect_id, at desc);

create table if not exists public.agency_bulk_operations (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('officer', 'contact_status')),
  request_key uuid not null unique,
  actor       uuid,
  note        text check (char_length(note) <= 500),
  summary     jsonb not null default '{}',
  at          timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['agency_officer_history', 'agency_bulk_operations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists "agency officer history: read" on public.agency_officer_history;
create policy "agency officer history: read" on public.agency_officer_history for select to authenticated using (public.agency_access());
drop policy if exists "agency bulk operations: read" on public.agency_bulk_operations;
create policy "agency bulk operations: read" on public.agency_bulk_operations for select to authenticated using (public.agency_manager());

-- Every officer change, whichever function made it.
create or replace function public.track_agency_officer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_officer is distinct from old.assigned_officer then
    insert into public.agency_officer_history (prospect_id, from_officer, to_officer, changed_by, change_kind, operation_id, note)
    values (new.id, old.assigned_officer, new.assigned_officer, auth.uid(),
            coalesce(nullif(current_setting('ssi.officer_change_kind', true), ''), case when auth.uid() is null then 'system' else 'single' end),
            nullif(current_setting('ssi.officer_operation', true), '')::uuid,
            nullif(current_setting('ssi.officer_note', true), ''));
  end if;
  return null;
end $$;
drop trigger if exists agency_prospects_officer_history on public.agency_prospects;
create trigger agency_prospects_officer_history after update of assigned_officer on public.agency_prospects
  for each row execute function public.track_agency_officer();

-- =============================================================== officers
-- Employees who may hold agencies: active staff with "Agencies & proposals" and an HR record.
create or replace function public.agency_officer_candidates()
returns table (id uuid, full_name text, designation text, department text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, d.name, dep.name
  from public.profiles p
  join public.employees e on e.id = p.id and e.employment_status <> 'Resigned'
  left join public.designations d on d.id = e.designation_id
  left join public.departments dep on dep.id = e.department_id
  where public.agency_access()
    and p.status = 'active' and p.role = any (public.staff_roles())
    and (p.role = 'super_admin' or 'agency_outreach' = any (coalesce(p.permissions, public.role_default_permissions(p.role))))
  order by p.full_name;
$$;

create or replace function public.agency_officer_eligible(p_officer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.employees e on e.id = p.id and e.employment_status <> 'Resigned'
                 where p.id = p_officer and p.status = 'active' and p.role = any (public.staff_roles())
                   and (p.role = 'super_admin' or 'agency_outreach' = any (coalesce(p.permissions, public.role_default_permissions(p.role)))));
$$;

-- What an assignment would do, before anything changes.
create or replace function public.preview_agency_officer(p_ids uuid[], p_officer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.agency_manager() then raise exception 'Only administrators can assign officers'; end if;
  if p_officer is not null and not public.agency_officer_eligible(p_officer) then raise exception 'This employee cannot be an agency officer'; end if;
  select jsonb_build_object(
    'selected', coalesce(cardinality(p_ids), 0),
    'found', count(*),
    'already', count(*) filter (where a.assigned_officer is not distinct from p_officer),
    'unassigned', count(*) filter (where a.assigned_officer is null and p_officer is not null),
    'other', count(*) filter (where a.assigned_officer is not null and a.assigned_officer is distinct from p_officer),
    'others', coalesce((select jsonb_agg(jsonb_build_object('officer_id', x.o, 'name', x.n, 'count', x.c) order by x.c desc)
                        from (select b.assigned_officer o, pr.full_name n, count(*) c from public.agency_prospects b
                              left join public.profiles pr on pr.id = b.assigned_officer
                              where b.id = any (p_ids) and b.assigned_officer is not null and b.assigned_officer is distinct from p_officer
                              group by 1, 2) x), '[]'),
    'officer_name', (select full_name from public.profiles where id = p_officer))
  into res
  from public.agency_prospects a where a.id = any (p_ids);
  return res;
end $$;

-- Assigns (or with p_officer null, unassigns). Agencies with another officer are skipped unless p_replace.
create or replace function public.assign_agency_officer(p_ids uuid[], p_officer uuid, p_replace boolean, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid; prev jsonb; a record; changed int := 0; same int := 0; conflict int := 0;
begin
  if not public.agency_manager() then raise exception 'Only administrators can assign officers'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if p_officer is not null and not public.agency_officer_eligible(p_officer) then raise exception 'This employee cannot be an agency officer'; end if;
  if p_officer is null and not coalesce(p_replace, false) then raise exception 'Removing officers needs explicit confirmation'; end if;
  select summary into prev from public.agency_bulk_operations where request_key = p_request;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if;
  insert into public.agency_bulk_operations (kind, request_key, actor, note) values ('officer', p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into op;
  perform set_config('ssi.officer_change_kind', case when cardinality(p_ids) > 1 then 'bulk' else 'single' end, true);
  perform set_config('ssi.officer_operation', op::text, true);
  perform set_config('ssi.officer_note', coalesce(left(btrim(p_note), 500), ''), true);
  for a in select id, assigned_officer, partner_id from public.agency_prospects where id = any (p_ids) order by id for update loop
    if a.assigned_officer is not distinct from p_officer then same := same + 1; continue; end if;
    if a.assigned_officer is not null and not coalesce(p_replace, false) then conflict := conflict + 1; continue; end if;
    update public.agency_prospects set assigned_officer = p_officer, updated_at = now() where id = a.id;
    perform public.agency_log(a.id, 'officer_changed', p_note, jsonb_build_object('from', a.assigned_officer, 'to', p_officer, 'operation', op));
    -- The linked partner's Partnership Officer follows when it was empty or the same person.
    if a.partner_id is not null and p_officer is not null then
      update public.partners set partnership_officer_id = p_officer
      where id = a.partner_id and (partnership_officer_id is null or partnership_officer_id is not distinct from a.assigned_officer);
    end if;
    changed := changed + 1;
  end loop;
  perform set_config('ssi.officer_change_kind', '', true);
  perform set_config('ssi.officer_operation', '', true);
  perform set_config('ssi.officer_note', '', true);
  update public.agency_bulk_operations set summary = jsonb_build_object('operation', op, 'officer', p_officer, 'changed', changed, 'unchanged', same,
    'skipped_other_officer', conflict, 'replace', coalesce(p_replace, false)) where id = op;
  return (select summary from public.agency_bulk_operations where id = op) || jsonb_build_object('replayed', false);
end $$;

-- =============================================================== contact status correction
create or replace function public.preview_agency_contact(p_ids uuid[], p_status text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.agency_manager() then raise exception 'Only administrators can correct contact status in bulk'; end if;
  if p_status not in ('unknown', 'not_connected', 'connected') then raise exception 'Unknown contact status'; end if;
  select jsonb_build_object('selected', coalesce(cardinality(p_ids), 0), 'found', count(*),
    'already', count(*) filter (where contact_status = p_status),
    'change', count(*) filter (where contact_status <> p_status),
    'from', coalesce((select jsonb_object_agg(s, c) from (select contact_status s, count(*) c from public.agency_prospects
                       where id = any (p_ids) and contact_status <> p_status group by 1) x), '{}'))
  into res from public.agency_prospects where id = any (p_ids);
  return res;
end $$;

-- Changes only the contact status (and who / when): no contact dates, no calls, no work activity, no stage change.
create or replace function public.bulk_set_agency_contact(p_ids uuid[], p_status text, p_note text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid; prev jsonb; a record; changed int := 0; same int := 0;
begin
  if not public.agency_manager() then raise exception 'Only administrators can correct contact status in bulk'; end if;
  if p_status not in ('unknown', 'not_connected', 'connected') then raise exception 'Unknown contact status'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select summary into prev from public.agency_bulk_operations where request_key = p_request;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if;
  insert into public.agency_bulk_operations (kind, request_key, actor, note) values ('contact_status', p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into op;
  for a in select id, contact_status from public.agency_prospects where id = any (p_ids) order by id for update loop
    if a.contact_status = p_status then same := same + 1; continue; end if;
    update public.agency_prospects set contact_status = p_status, contact_changed_by = auth.uid(), contact_changed_at = now(), updated_at = now() where id = a.id;
    perform public.agency_log(a.id, 'contact_status_corrected', p_note, jsonb_build_object('from', a.contact_status, 'to', p_status, 'operation', op, 'correction', true));
    changed := changed + 1;
  end loop;
  update public.agency_bulk_operations set summary = jsonb_build_object('operation', op, 'status', p_status, 'changed', changed, 'unchanged', same) where id = op;
  return (select summary from public.agency_bulk_operations where id = op) || jsonb_build_object('replayed', false);
end $$;

-- =============================================================== Clients & Branches
create or replace function public.agency_name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '', 'g'), '');
$$;

-- Onboarded agencies with their partner link (verified) or without one (pending verification).
-- Readable by staff who may see Clients & Branches or the Agency List; no commission or finance data.
create or replace function public.onboarded_agency_directory()
returns table (agency_id uuid, reference text, company_name text, contact_name text, phone text, email text, country text,
               assigned_officer uuid, officer_name text, partner_id text, verification text, historical boolean,
               needs_reconciliation boolean, reconciliation_note text, source_status text, registration_id uuid, registration_status text,
               suggested_partner_id text, suggested_partner_name text, stage_changed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.reference, a.company_name, a.contact_name, a.phone, a.email, a.country, a.assigned_officer, pr.full_name, a.partner_id,
         case when a.partner_id is not null then 'verified' else 'pending' end,
         a.historical_onboarded, a.needs_reconciliation, a.reconciliation_note, a.source_status, a.registration_id, r.status,
         s.id, s.name, a.stage_changed_at
  from public.agency_prospects a
  left join public.profiles pr on pr.id = a.assigned_officer
  left join public.partner_registrations r on r.id = a.registration_id
  left join lateral (
    select o.id, o.name from public.partners o
    where a.partner_id is null and o.archived_at is null
      and not exists (select 1 from public.agency_prospects x where x.partner_id = o.id)
      and public.agency_name_key(o.name) is not null and public.agency_name_key(a.company_name) is not null
      and (public.agency_name_key(o.name) = public.agency_name_key(a.company_name)
           or (length(public.agency_name_key(o.name)) >= 5 and public.agency_name_key(a.company_name) like public.agency_name_key(o.name) || '%')
           or (length(public.agency_name_key(a.company_name)) >= 5 and public.agency_name_key(o.name) like public.agency_name_key(a.company_name) || '%')
           or (a.email is not null and lower(o.email) = lower(a.email)))
    order by (public.agency_name_key(o.name) = public.agency_name_key(a.company_name)) desc, (lower(o.email) = lower(coalesce(a.email, ''))) desc, o.name
    limit 1) s on true
  where a.stage = 'onboarded'
    and public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access())
  order by a.company_name nulls last, a.reference;
$$;

-- =============================================================== realtime + grants
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agency_officer_history'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['agency_officer_candidates()', 'preview_agency_officer(uuid[], uuid)', 'assign_agency_officer(uuid[], uuid, boolean, text, uuid)',
                           'preview_agency_contact(uuid[], text)', 'bulk_set_agency_contact(uuid[], text, text, uuid)', 'onboarded_agency_directory()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['track_agency_officer()', 'agency_officer_eligible(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
