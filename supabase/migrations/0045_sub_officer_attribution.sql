-- 0045 · Assigned Sub Officer and agency-wise application performance
--
-- * The Main Officer stays agency_prospects.assigned_officer (partners.partnership_officer_id for a
--   client without an Agency List record). One Sub Officer per agency: agency_prospects.sub_officer,
--   mirrored to the linked client (partners.sub_officer_id) by trigger — one assignment, never two
--   that disagree. NULL = Unassigned.
-- * Who may assign: Super Admins and agency administrators (any eligible employee), or the agency's
--   Main Officer (only employees in their reporting line, employees.reporting_manager_id). Every
--   change is in sub_officer_history (previous, new, main officer, who, when, reason).
-- * application_attribution: when an application is created, the client's Main Officer and Sub
--   Officer at that moment are stored with the real creator and processing staff. Later
--   reassignments never rewrite it; only a Super Admin correction does (kept with the old value).
--   Applications created before this migration are not attributed (no evidence of who was
--   responsible then).
-- * portfolio_performance(): an officer's own portfolio (applications through agencies they are
--   Sub Officer for) and, as Main Officer, the team's — each application counted once.
-- Personal Daily Work Report activities are unchanged (still credited to whoever did them).
-- Safe to run more than once.

alter table public.agency_prospects add column if not exists sub_officer uuid references public.profiles (id) on delete set null;
alter table public.agency_prospects add column if not exists sub_officer_since timestamptz;
alter table public.partners add column if not exists sub_officer_id uuid references public.profiles (id) on delete set null;
grant select (sub_officer_id) on public.partners to authenticated;
create index if not exists agency_prospects_sub_officer_idx on public.agency_prospects (sub_officer);

create table if not exists public.sub_officer_history (
  id           bigint generated always as identity primary key,
  prospect_id  uuid references public.agency_prospects (id) on delete cascade,
  partner_id   text references public.partners (id) on delete cascade,
  from_officer uuid,
  to_officer   uuid,
  main_officer uuid,
  changed_by   uuid,
  operation_id uuid,
  reason       text check (char_length(reason) <= 500),
  effective_at timestamptz not null default now(),
  check (prospect_id is not null or partner_id is not null)
);
create index if not exists sub_officer_history_prospect_idx on public.sub_officer_history (prospect_id, effective_at desc);
create index if not exists sub_officer_history_partner_idx on public.sub_officer_history (partner_id, effective_at desc);
alter table public.sub_officer_history enable row level security;
revoke all on public.sub_officer_history from anon;
grant select on public.sub_officer_history to authenticated;
drop policy if exists "sub officer history: read" on public.sub_officer_history;
create policy "sub officer history: read" on public.sub_officer_history for select to authenticated
  using (public.my_profile_ok() and public.is_staff() and (public.agency_access() or public.staff_can('partners')));

alter table public.agency_bulk_operations drop constraint if exists agency_bulk_operations_kind_check;
alter table public.agency_bulk_operations add constraint agency_bulk_operations_kind_check check (kind in ('officer', 'contact_status', 'agency_type', 'sub_officer'));

-- =============================================================== team and eligibility
-- Is p_emp in p_manager's reporting line (direct or indirect, up to 10 levels)?
create or replace function public.in_reporting_line(p_manager uuid, p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select e.reporting_manager_id as m, 1 as depth from public.employees e where e.id = p_emp
    union all
    select e.reporting_manager_id, up.depth + 1 from up join public.employees e on e.id = up.m where up.depth < 10 and up.m is not null
  )
  select p_manager is not null and p_emp is not null and exists (select 1 from up where m = p_manager);
$$;

create or replace function public.sub_officer_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and (public.is_super_admin() or public.agency_manager());
$$;

-- May the signed-in user set the Sub Officer of a portfolio whose Main Officer is p_main?
create or replace function public.can_assign_sub_officer(p_main uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.sub_officer_admin() or (p_main is not null and p_main = auth.uid() and public.agency_access());
$$;

-- Is p_sub a valid Sub Officer under Main Officer p_main for the signed-in user?
create or replace function public.sub_officer_eligible(p_main uuid, p_sub uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.employees e on e.id = p.id and e.employment_status <> 'Resigned'
                 where p.id = p_sub and p.status = 'active' and p.role = any (public.staff_roles()))
     and p_sub is distinct from p_main
     and (public.in_reporting_line(p_main, p_sub)
          or (public.sub_officer_admin() and (public.agency_officer_eligible(p_sub) or public.in_reporting_line(p_main, p_sub))));
$$;

-- Employees the signed-in user may choose as Sub Officer under Main Officer p_main.
create or replace function public.sub_officer_candidates(p_main uuid)
returns table (id uuid, full_name text, designation text, department text, in_team boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, d.name, dep.name, public.in_reporting_line(p_main, p.id)
  from public.profiles p
  join public.employees e on e.id = p.id and e.employment_status <> 'Resigned'
  left join public.designations d on d.id = e.designation_id
  left join public.departments dep on dep.id = e.department_id
  where public.can_assign_sub_officer(p_main)
    and p.status = 'active' and p.role = any (public.staff_roles())
    and public.sub_officer_eligible(p_main, p.id)
  order by public.in_reporting_line(p_main, p.id) desc, p.full_name;
$$;

-- =============================================================== keeping agency and client in step
create or replace function public.sub_officer_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sub_officer is null and new.partner_id is not null and (tg_op = 'INSERT' or old.partner_id is distinct from new.partner_id) then
    new.sub_officer := (select o.sub_officer_id from public.partners o where o.id = new.partner_id);
  end if;
  return new;
end $$;
create or replace function public.sub_officer_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.partner_id is not null then
    update public.partners set sub_officer_id = new.sub_officer where id = new.partner_id and sub_officer_id is distinct from new.sub_officer;
  end if;
  return null;
end $$;
drop trigger if exists sub_officer_before on public.agency_prospects;
create trigger sub_officer_before before insert or update of partner_id on public.agency_prospects for each row execute function public.sub_officer_before();
drop trigger if exists sub_officer_sync on public.agency_prospects;
create trigger sub_officer_sync after insert or update of sub_officer, partner_id on public.agency_prospects for each row execute function public.sub_officer_sync();

-- =============================================================== assigning
create or replace function public.preview_agency_sub_officer(p_ids uuid[], p_sub uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.agency_access() and not public.sub_officer_admin() then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'selected', coalesce(cardinality(p_ids), 0), 'found', count(*),
    'out_of_scope', count(*) filter (where not public.can_assign_sub_officer(a.assigned_officer)),
    'not_eligible', count(*) filter (where public.can_assign_sub_officer(a.assigned_officer) and p_sub is not null and not public.sub_officer_eligible(a.assigned_officer, p_sub)),
    'already', count(*) filter (where public.can_assign_sub_officer(a.assigned_officer) and a.sub_officer is not distinct from p_sub),
    'change', count(*) filter (where public.can_assign_sub_officer(a.assigned_officer) and a.sub_officer is distinct from p_sub
                                 and (p_sub is null or public.sub_officer_eligible(a.assigned_officer, p_sub))),
    'replacing', count(*) filter (where public.can_assign_sub_officer(a.assigned_officer) and a.sub_officer is not null and a.sub_officer is distinct from p_sub
                                    and (p_sub is null or public.sub_officer_eligible(a.assigned_officer, p_sub))),
    'sub_name', (select full_name from public.profiles where id = p_sub))
  into res from public.agency_prospects a where a.id = any (p_ids);
  return res;
end $$;

-- One agency or many. Rows outside the caller's scope or where the employee is not eligible under
-- that agency's Main Officer are skipped and reported, never changed. p_sub NULL = Unassigned.
create or replace function public.assign_agency_sub_officer(p_ids uuid[], p_sub uuid, p_reason text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op uuid; prev jsonb; a record; changed int := 0; same int := 0; skipped int := 0; ineligible int := 0; why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.agency_access() and not public.sub_officer_admin() then raise exception 'Not allowed to assign Sub Officers'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'Select at least one agency'; end if;
  if cardinality(p_ids) > 5000 then raise exception 'Select at most 5000 agencies at a time'; end if;
  select summary into prev from public.agency_bulk_operations where request_key = p_request;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if;
  insert into public.agency_bulk_operations (kind, request_key, actor, note) values ('sub_officer', p_request, auth.uid(), why) returning id into op;
  for a in select id, assigned_officer, sub_officer from public.agency_prospects where id = any (p_ids) order by id for update loop
    if not public.can_assign_sub_officer(a.assigned_officer) then skipped := skipped + 1; continue; end if;
    if a.sub_officer is not distinct from p_sub then same := same + 1; continue; end if;
    if p_sub is not null and not public.sub_officer_eligible(a.assigned_officer, p_sub) then ineligible := ineligible + 1; continue; end if;
    update public.agency_prospects set sub_officer = p_sub, sub_officer_since = case when p_sub is null then null else now() end, updated_at = now() where id = a.id;
    insert into public.sub_officer_history (prospect_id, partner_id, from_officer, to_officer, main_officer, changed_by, operation_id, reason)
    values (a.id, (select partner_id from public.agency_prospects where id = a.id), a.sub_officer, p_sub, a.assigned_officer, auth.uid(), op, why);
    perform public.agency_log(a.id, 'sub_officer_changed', why, jsonb_build_object('from', a.sub_officer, 'to', p_sub, 'operation', op));
    changed := changed + 1;
  end loop;
  if cardinality(p_ids) = 1 and changed = 0 and same = 0 then
    raise exception '%', case when skipped > 0 then 'Only an administrator or this agency''s Main Officer can assign its Sub Officer'
                              else 'This employee is not in the Main Officer''s team' end;
  end if;
  update public.agency_bulk_operations set summary = jsonb_build_object('operation', op, 'sub_officer', p_sub, 'changed', changed, 'unchanged', same,
    'out_of_scope', skipped, 'not_eligible', ineligible) where id = op;
  return (select summary from public.agency_bulk_operations where id = op) || jsonb_build_object('replayed', false);
end $$;

-- A client in Clients & Branches: through its agency when linked, otherwise on the client itself.
create or replace function public.assign_partner_sub_officer(p_partner text, p_sub uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o record; aid uuid; why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select id, partnership_officer_id, sub_officer_id into o from public.partners where id = p_partner for update;
  if o.id is null then raise exception 'Client not found'; end if;
  select id into aid from public.agency_prospects where partner_id = p_partner;
  if aid is not null then
    return public.assign_agency_sub_officer(array[aid], p_sub, p_reason, gen_random_uuid());
  end if;
  if not public.can_assign_sub_officer(o.partnership_officer_id) then raise exception 'Only an administrator or this client''s Main Officer can assign its Sub Officer'; end if;
  if o.sub_officer_id is not distinct from p_sub then return jsonb_build_object('changed', 0, 'unchanged', 1); end if;
  if p_sub is not null and not public.sub_officer_eligible(o.partnership_officer_id, p_sub) then raise exception 'This employee is not in the Main Officer''s team'; end if;
  update public.partners set sub_officer_id = p_sub where id = p_partner;
  insert into public.sub_officer_history (partner_id, from_officer, to_officer, main_officer, changed_by, reason)
  values (p_partner, o.sub_officer_id, p_sub, o.partnership_officer_id, auth.uid(), why);
  return jsonb_build_object('changed', 1, 'unchanged', 0);
end $$;

-- =============================================================== application attribution
create table if not exists public.application_attribution (
  application_id         text primary key references public.applications (id) on delete cascade,
  partner_id             text,
  agency_id              uuid,
  main_officer_id        uuid,
  sub_officer_id         uuid,
  creator_id             uuid,
  processing_staff_id    uuid,
  application_created_at timestamptz not null default now(),
  attributed_at          timestamptz not null default now(),
  source                 text not null default 'creation' check (source in ('creation', 'correction')),
  previous_sub_officer   uuid,
  corrected_by           uuid,
  corrected_at           timestamptz,
  correction_reason      text check (char_length(correction_reason) <= 500)
);
create index if not exists application_attribution_sub_idx on public.application_attribution (sub_officer_id);
create index if not exists application_attribution_main_idx on public.application_attribution (main_officer_id);
alter table public.application_attribution enable row level security;
revoke all on public.application_attribution from anon;
grant select on public.application_attribution to authenticated;
drop policy if exists "application attribution: read" on public.application_attribution;
create policy "application attribution: read" on public.application_attribution for select to authenticated
  using (public.my_profile_ok() and public.is_staff()
         and (public.is_super_admin() or public.agency_manager() or public.staff_can('applications')
              or sub_officer_id = auth.uid() or main_officer_id = auth.uid()));
do $$ begin
  begin alter publication supabase_realtime add table public.application_attribution; exception when others then null; end;
end $$;

-- Snapshot at creation: who was responsible for the client then. Never changed by reassignment.
create or replace function public.attribute_application()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; o record;
begin
  if new.partner_id is null then return null; end if;
  select id, assigned_officer, sub_officer into a from public.agency_prospects where partner_id = new.partner_id;
  select partnership_officer_id, sub_officer_id into o from public.partners where id = new.partner_id;
  insert into public.application_attribution (application_id, partner_id, agency_id, main_officer_id, sub_officer_id, creator_id, processing_staff_id, application_created_at)
  values (new.id, new.partner_id, a.id, coalesce(a.assigned_officer, o.partnership_officer_id), coalesce(a.sub_officer, o.sub_officer_id),
          new.created_by, new.assigned_to, coalesce(new.applied_at, now()))
  on conflict (application_id) do nothing;
  return null;
end $$;
drop trigger if exists applications_attribution on public.applications;
create trigger applications_attribution after insert on public.applications for each row execute function public.attribute_application();

-- Super Admin correction (kept with the previous value and reason).
create or replace function public.correct_application_attribution(p_application text, p_sub uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can correct application attribution'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for the correction'; end if;
  select * into r from public.application_attribution where application_id = p_application for update;
  if r.application_id is null then
    insert into public.application_attribution (application_id, partner_id, main_officer_id, creator_id, processing_staff_id, application_created_at, source)
    select ap.id, ap.partner_id, o.partnership_officer_id, ap.created_by, ap.assigned_to, coalesce(ap.applied_at, ap.updated_at, now()), 'correction'
    from public.applications ap left join public.partners o on o.id = ap.partner_id where ap.id = p_application;
    if not found then raise exception 'Application not found'; end if;
  end if;
  update public.application_attribution set previous_sub_officer = sub_officer_id, sub_officer_id = p_sub, source = 'correction',
    corrected_by = auth.uid(), corrected_at = now(), correction_reason = btrim(p_reason)
  where application_id = p_application;
end $$;

-- =============================================================== performance
-- Status groups: submitted = beyond Draft / Pending Assessment; offers = conditional or later.
create or replace function public.app_group(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case when p_status in ('Draft', 'Pending Assessment') then 'pending_submission'
              when p_status in ('Submitted', 'Offer Pending') then 'submitted'
              when p_status in ('Conditional Offer', 'Unconditional Offer', 'Visa Lodged') then 'offer'
              when p_status = 'Visa Granted' then 'visa_granted'
              when p_status = 'Visa Refused' then 'visa_refused' else 'other' end;
$$;

-- p_officer: NULL = me. Others: Super Admin / agency administrators, or a manager for someone in
-- their reporting line.
create or replace function public.portfolio_performance(p_officer uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := coalesce(p_officer, auth.uid()); res jsonb;
begin
  if not (public.my_profile_ok() and public.is_staff()) then return null; end if;
  if me <> auth.uid() and not (public.sub_officer_admin() or public.in_reporting_line(auth.uid(), me)) then raise exception 'Not allowed'; end if;
  with apps as (
    select x.*, ap.status, public.app_group(ap.status) g from public.application_attribution x join public.applications ap on ap.id = x.application_id
  ),
  stats as (
    select jsonb_build_object('applications', count(*), 'submitted', count(*) filter (where g in ('submitted', 'offer', 'visa_granted', 'visa_refused')),
      'pending', count(*) filter (where g in ('pending_submission', 'submitted')), 'offers', count(*) filter (where g in ('offer', 'visa_granted')),
      'visa_granted', count(*) filter (where g = 'visa_granted'), 'visa_refused', count(*) filter (where g = 'visa_refused')) s, 'mine' k
    from apps where sub_officer_id = me
    union all
    select jsonb_build_object('applications', count(*), 'submitted', count(*) filter (where g in ('submitted', 'offer', 'visa_granted', 'visa_refused')),
      'pending', count(*) filter (where g in ('pending_submission', 'submitted')), 'offers', count(*) filter (where g in ('offer', 'visa_granted')),
      'visa_granted', count(*) filter (where g = 'visa_granted'), 'visa_refused', count(*) filter (where g = 'visa_refused')), 'team'
    from apps where main_officer_id = me
  )
  select jsonb_build_object(
    'officer', me,
    'mine', jsonb_build_object(
      'agencies', (select count(*) from public.agency_prospects where sub_officer = me),
      'onboarded', (select count(*) from public.agency_prospects where sub_officer = me and stage = 'onboarded'),
      'clients_without_agency', (select count(*) from public.partners o where o.sub_officer_id = me and o.archived_at is null
                                   and not exists (select 1 from public.agency_prospects a where a.partner_id = o.id))) || (select s from stats where k = 'mine'),
    'team', jsonb_build_object(
      'agencies', (select count(*) from public.agency_prospects where assigned_officer = me),
      'allocated', (select count(*) from public.agency_prospects where assigned_officer = me and sub_officer is not null),
      'unassigned', (select count(*) from public.agency_prospects where assigned_officer = me and sub_officer is null),
      'onboarded', (select count(*) from public.agency_prospects where assigned_officer = me and stage = 'onboarded'),
      'in_progress', (select count(*) from public.agency_prospects where assigned_officer = me
                        and stage in ('proposal_sent', 'proposal_confirmed', 'mou_sent', 'registration_pending', 'registration_submitted', 'under_review', 'approved')),
      'by_sub', coalesce((select jsonb_agg(r order by (r ->> 'applications')::int desc, r ->> 'name') from (
          select jsonb_build_object('sub_officer', s.sub, 'name', coalesce(pr.full_name, 'Unassigned'),
            'agencies', (select count(*) from public.agency_prospects a where a.assigned_officer = me and a.sub_officer is not distinct from s.sub),
            'applications', (select count(*) from apps where main_officer_id = me and sub_officer_id is not distinct from s.sub),
            'offers', (select count(*) from apps where main_officer_id = me and sub_officer_id is not distinct from s.sub and g in ('offer', 'visa_granted'))) r
          from (select distinct sub_officer sub from public.agency_prospects where assigned_officer = me
                union select distinct sub_officer_id from public.application_attribution where main_officer_id = me) s
          left join public.profiles pr on pr.id = s.sub) t), '[]')) || (select s from stats where k = 'team'))
  into res;
  return res;
end $$;

-- Application counts per agency / client (for officers who cannot read applications themselves).
create or replace function public.agency_application_counts()
returns table (agency_id uuid, partner_id text, applications bigint)
language sql stable security definer set search_path = '' as $$
  select a.id, o.id, (select count(*) from public.applications ap where ap.partner_id = o.id)
  from public.partners o left join public.agency_prospects a on a.partner_id = o.id
  where public.my_profile_ok() and public.is_staff() and (public.agency_access() or public.staff_can('partners'));
$$;

-- Names of the people shown as Main / Sub Officer (for lists whose readers cannot read every profile).
create or replace function public.portfolio_officer_names()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.profiles p
  where public.my_profile_ok() and public.is_staff() and (public.agency_access() or public.staff_can('partners'))
    and p.id in (select assigned_officer from public.agency_prospects union select sub_officer from public.agency_prospects
                 union select partnership_officer_id from public.partners union select sub_officer_id from public.partners);
$$;

-- =============================================================== Clients & Branches status (+ officers)
drop function if exists public.partnership_onboarding_summary(text);
drop function if exists public.partner_directory_status();
create function public.partner_directory_status()
returns table (partner_id text, business_status text, portal_status text, onboarding_source text, users integer, agency_id uuid,
               agency_reference text, contact_name text, phone text, agency_type text, main_officer_id uuid, sub_officer_id uuid)
language sql stable security definer set search_path = '' as $$
  with u as (select p.partner_id, count(*) filter (where p.status = 'active')::int as n from public.profiles p where p.partner_id is not null group by 1)
  select o.id,
         case when o.onboarding_source = 'historical' and coalesce(u.n, 0) = 0 then 'historical'
              when o.status in ('Active', 'Inactive') then 'verified'
              else 'not_onboarded' end,
         case when o.archived_at is not null then 'deactivated'
              when o.status = 'Inactive' then 'suspended'
              when coalesce(u.n, 0) = 0 then 'no_account'
              when not o.portal_enabled or o.status <> 'Active' then 'pending'
              else 'active' end,
         o.onboarding_source, coalesce(u.n, 0), a.id, a.reference, o.contact_name, o.phone, coalesce(o.agency_type, a.agency_type),
         coalesce(a.assigned_officer, o.partnership_officer_id), coalesce(a.sub_officer, o.sub_officer_id)
  from public.partners o
  left join u on u.partner_id = o.id
  left join public.agency_prospects a on a.partner_id = o.id
  where public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access());
$$;

create function public.partnership_onboarding_summary(p_type text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with d as (select s.*, o.partnership_officer_id from public.partner_directory_status() s join public.partners o on o.id = s.partner_id
             where o.archived_at is null
               and (p_type is null or (p_type = 'unclassified' and s.agency_type is null) or s.agency_type = p_type)),
  open_agencies as (select a.* from public.agency_prospects a where a.stage = 'onboarded' and a.partner_id is null
               and (p_type is null or (p_type = 'unclassified' and a.agency_type is null) or a.agency_type = p_type))
  select jsonb_build_object(
    'total', (select count(*) from d where business_status in ('historical', 'verified')) + (select count(*) from open_agencies),
    'historical', (select count(*) from d where business_status = 'historical'),
    'verified', (select count(*) from d where business_status = 'verified'),
    'unlinked', (select count(*) from open_agencies),
    'portal_active', (select count(*) from d where portal_status = 'active'),
    'no_account', (select count(*) from d where business_status in ('historical', 'verified') and portal_status = 'no_account'),
    'mine', (select count(*) from d where business_status in ('historical', 'verified') and partnership_officer_id = auth.uid())
            + (select count(*) from open_agencies where assigned_officer = auth.uid()))
  where public.my_profile_ok() and public.is_staff() and (public.staff_can('partners') or public.agency_access())
    and (p_type is null or p_type in ('domestic', 'international', 'unclassified'));
$$;

-- =============================================================== grants
do $$
declare f text;
begin
  foreach f in array array['in_reporting_line(uuid, uuid)', 'sub_officer_admin()', 'can_assign_sub_officer(uuid)', 'sub_officer_eligible(uuid, uuid)',
                           'sub_officer_candidates(uuid)', 'preview_agency_sub_officer(uuid[], uuid)', 'assign_agency_sub_officer(uuid[], uuid, text, uuid)',
                           'assign_partner_sub_officer(text, uuid, text)', 'correct_application_attribution(text, uuid, text)', 'portfolio_performance(uuid)',
                           'agency_application_counts()', 'portfolio_officer_names()', 'partner_directory_status()', 'partnership_onboarding_summary(text)', 'app_group(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['sub_officer_before()', 'sub_officer_sync()', 'attribute_application()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
