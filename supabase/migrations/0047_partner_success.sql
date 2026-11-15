-- 0047_partner_success.sql — run after 0046_linkedin_pending_fix.sql
-- (Supabase SQL Editor: Save this query as "0047_partner_success")
--
-- Partner Success Officers (designation partner_success_officer, and anyone given the new
-- "partner_success" permission) look after onboarded clients as Sub Officer:
-- * Permission "partner_success" by designation (never by name). "partners" (create / edit
--   partner organisations) is removed from that designation and its employees — they never
--   create partners, registrations, accounts or proposals, and have no agency_outreach.
-- * onboarded_client_directory(): every onboarded client (verified partners, historical clients
--   and onboarded agencies not yet linked) with officers — read-only; contact details only for
--   the officer's own clients (Sub Officer) or for administrators / partnership staff.
-- * my_clients(): only clients whose current Sub Officer is the signed-in user, with application
--   counts attributed to them (application_attribution snapshot — never the client's current
--   assignment, so reassignment never rewrites history).
-- * client_activities + log_client_activity(): relationship work on own clients only; recorded
--   with employee, client, type, outcome and time, and counted in the existing Partner Success
--   report fields (partner queries, training, options suggested, admission guidance).
-- * portfolio_day(): applications and first offers through the officer's clients on a day —
--   shown next to (never inside) the personal Daily Work Report.
-- * Admins can choose any Partner Success Officer as Sub Officer.
-- Safe to run more than once.

-- =============================================================== permission
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary',
               'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit',
               'partner_onboarding', 'agency_outreach', 'partner_accounts', 'partner_success'];
$$;

update public.designations
set default_permissions = array_append(array_remove(default_permissions, 'partners'), 'partner_success')
where id = 'partner_success_officer' and not ('partner_success' = any (default_permissions));
update public.designations set default_permissions = array_remove(default_permissions, 'partners')
where id = 'partner_success_officer' and 'partners' = any (default_permissions);
-- Existing Partner Success Officers (by designation): add partner_success, drop partner editing and
-- any partnership-development permissions they should not have.
update public.profiles p
set permissions = array_append(array_remove(array_remove(array_remove(array_remove(p.permissions, 'partners'), 'agency_outreach'), 'partner_onboarding'), 'partner_accounts'), 'partner_success')
from public.employees e
where e.id = p.id and e.designation_id = 'partner_success_officer' and p.permissions is not null and p.role not in ('super_admin', 'admin_staff')
  and not ('partner_success' = any (p.permissions));

create or replace function public.partner_success_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and public.is_staff() and public.staff_can('partner_success');
$$;
-- Who may see the onboarded client directory: Partner Success, partnership staff, administrators.
create or replace function public.client_directory_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and public.is_staff() and (public.is_super_admin() or public.staff_can('partner_success') or public.agency_access() or public.staff_can('partners'));
$$;

-- Admins may pick any Partner Success Officer as Sub Officer (Main Officers: their reporting line, as before).
create or replace function public.sub_officer_eligible(p_main uuid, p_sub uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.employees e on e.id = p.id and e.employment_status <> 'Resigned'
                 where p.id = p_sub and p.status = 'active' and p.role = any (public.staff_roles()))
     and p_sub is distinct from p_main
     and (public.in_reporting_line(p_main, p_sub)
          or (public.sub_officer_admin() and (public.agency_officer_eligible(p_sub) or public.in_reporting_line(p_main, p_sub)
              or exists (select 1 from public.profiles p where p.id = p_sub and 'partner_success' = any (coalesce(p.permissions, public.role_default_permissions(p.role)))))));
$$;

-- =============================================================== onboarded client directory
-- One row per onboarded client: a verified or historical partner organisation, or an agency marked
-- onboarded that is not linked to a partner yet. key = 'p:<partner id>' or 'a:<agency id>'.
create or replace function public.onboarded_client_directory()
returns table (key text, partner_id text, agency_id uuid, name text, country text, city text, agency_type text, business_status text,
               onboarded_on date, main_officer_id uuid, main_officer text, sub_officer_id uuid, sub_officer text, mine boolean,
               contact_name text, phone text, email text)
language sql stable security definer set search_path = '' as $$
  with full_view as (select public.is_super_admin() or public.agency_access() or public.staff_can('partners') as ok),
  rows as (
    -- same business status rule as partner_directory_status() (0045), which is reserved for partnership staff
    select 'p:' || o.id as key, o.id as partner_id, a.id as agency_id, o.name, o.country, o.city, coalesce(o.agency_type, a.agency_type) as agency_type,
           case when o.onboarding_source = 'historical' and coalesce(u.n, 0) = 0 then 'historical' else 'verified' end as business_status,
           coalesce(a.stage_changed_at::date, o.joined_at::date) as onboarded_on,
           coalesce(a.assigned_officer, o.partnership_officer_id) as main_id, coalesce(a.sub_officer, o.sub_officer_id) as sub_id,
           o.contact_name, o.phone, o.email
    from public.partners o
    left join (select p.partner_id, count(*) filter (where p.status = 'active')::int as n from public.profiles p where p.partner_id is not null group by 1) u on u.partner_id = o.id
    left join public.agency_prospects a on a.partner_id = o.id
    where o.archived_at is null
      and ((o.onboarding_source = 'historical' and coalesce(u.n, 0) = 0) or o.status in ('Active', 'Inactive'))
    union all
    select 'a:' || a.id, null, a.id, coalesce(a.company_name, a.contact_name, a.reference), a.country, null, a.agency_type,
           'historical', a.stage_changed_at::date, a.assigned_officer, a.sub_officer, a.contact_name, a.phone, a.email
    from public.agency_prospects a
    where a.stage = 'onboarded' and a.partner_id is null
  )
  select r.key, r.partner_id, r.agency_id, r.name, r.country, r.city, r.agency_type, r.business_status, r.onboarded_on,
         r.main_id, pm.full_name, r.sub_id, ps.full_name, r.sub_id = auth.uid(),
         case when r.sub_id = auth.uid() or f.ok then r.contact_name end,
         case when r.sub_id = auth.uid() or f.ok then r.phone end,
         case when r.sub_id = auth.uid() or f.ok then r.email end
  from rows r cross join full_view f
  left join public.profiles pm on pm.id = r.main_id
  left join public.profiles ps on ps.id = r.sub_id
  where public.client_directory_access()
  order by r.name;
$$;

-- Relationship activities (table first: my_clients() reads it).
create table if not exists public.client_activities (
  id             bigint generated always as identity primary key,
  client_key     text not null,                  -- 'p:<partner id>' or 'a:<agency id>'
  partner_id     text references public.partners (id) on delete set null,
  agency_id      uuid references public.agency_prospects (id) on delete set null,
  employee_id    uuid not null,
  kind           text not null check (kind in ('query', 'training', 'course_options', 'admission_guidance', 'follow_up', 'meeting', 'note')),
  outcome        text check (outcome in ('completed', 'pending', 'no_response', 'escalated')),
  note           text check (char_length(note) <= 2000),
  next_follow_up date,
  at             timestamptz not null default now(),
  request_id     uuid unique
);
create index if not exists client_activities_key_idx on public.client_activities (client_key, at desc);
create index if not exists client_activities_emp_idx on public.client_activities (employee_id, at desc);

-- My Clients: current Sub Officer = me (from the session, never a parameter), with the
-- applications attributed to me through each client.
create or replace function public.my_clients()
returns table (key text, partner_id text, agency_id uuid, name text, country text, city text, agency_type text, business_status text,
               onboarded_on date, main_officer text, contact_name text, phone text, email text,
               applications bigint, pending bigint, submitted bigint, offers bigint, visa_granted bigint, last_activity timestamptz, next_follow_up date)
language sql stable security definer set search_path = '' as $$
  with d as (select * from public.onboarded_client_directory() where mine),
  apps as (select x.partner_id, x.agency_id, public.app_group(ap.status) g
           from public.application_attribution x join public.applications ap on ap.id = x.application_id where x.sub_officer_id = auth.uid())
  select d.key, d.partner_id, d.agency_id, d.name, d.country, d.city, d.agency_type, d.business_status, d.onboarded_on, d.main_officer,
         d.contact_name, d.phone, d.email,
         (select count(*) from apps where apps.partner_id is not distinct from d.partner_id and (d.partner_id is not null or apps.agency_id = d.agency_id)),
         (select count(*) from apps where (apps.partner_id = d.partner_id or (d.partner_id is null and apps.agency_id = d.agency_id)) and g in ('pending_submission', 'submitted')),
         (select count(*) from apps where (apps.partner_id = d.partner_id or (d.partner_id is null and apps.agency_id = d.agency_id)) and g in ('submitted', 'offer', 'visa_granted', 'visa_refused')),
         (select count(*) from apps where (apps.partner_id = d.partner_id or (d.partner_id is null and apps.agency_id = d.agency_id)) and g in ('offer', 'visa_granted')),
         (select count(*) from apps where (apps.partner_id = d.partner_id or (d.partner_id is null and apps.agency_id = d.agency_id)) and g = 'visa_granted'),
         (select max(c.at) from public.client_activities c where c.client_key = d.key),
         (select min(c.next_follow_up) from public.client_activities c where c.client_key = d.key and c.next_follow_up >= public.company_today())
  from d order by d.name;
$$;

-- =============================================================== relationship activities
alter table public.client_activities enable row level security;
revoke all on public.client_activities from anon, authenticated;
grant select on public.client_activities to authenticated;
drop policy if exists "client activities: read" on public.client_activities;
-- Own entries, entries on clients I am Sub Officer for, and administrators / partnership staff.
create policy "client activities: read" on public.client_activities for select to authenticated
  using (public.my_profile_ok() and public.is_staff()
         and (employee_id = auth.uid() or public.is_super_admin() or public.agency_access()
              or exists (select 1 from public.onboarded_client_directory() d where d.key = client_key and d.mine)));

create or replace function public.log_client_activity(p_key text, p_kind text, p_outcome text, p_note text, p_next date, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare d record; rid bigint; me uuid := public.my_employee_id(); wt text;
begin
  if not public.partner_success_access() then raise exception 'Not allowed to log client activities'; end if;
  if p_request is null then raise exception 'A request id is required'; end if;
  select * into d from public.onboarded_client_directory() where key = p_key;
  if d.key is null then raise exception 'Client not found'; end if;
  if not d.mine then raise exception 'You can only log activities for your own clients (where you are the Sub Officer)'; end if;
  if p_kind not in ('query', 'training', 'course_options', 'admission_guidance', 'follow_up', 'meeting', 'note') then raise exception 'Unknown activity'; end if;
  if p_outcome is not null and p_outcome not in ('completed', 'pending', 'no_response', 'escalated') then raise exception 'Unknown outcome'; end if;
  if p_kind = 'note' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Write the note'; end if;
  if p_next is not null and p_next < public.company_today() then raise exception 'The follow-up date cannot be in the past'; end if;
  insert into public.client_activities (client_key, partner_id, agency_id, employee_id, kind, outcome, note, next_follow_up, request_id)
  values (p_key, d.partner_id, d.agency_id, auth.uid(), p_kind, p_outcome, nullif(btrim(coalesce(p_note, '')), ''), p_next, p_request)
  on conflict (request_id) do nothing returning id into rid;
  if rid is null then return (select id from public.client_activities where request_id = p_request); end if;
  -- The existing Partner Success report fields (personal work, counted once per entry).
  wt := case p_kind when 'query' then 'partner_query' when 'training' then 'partner_training' when 'course_options' then 'course_options'
                    when 'admission_guidance' then 'admission_guidance' end;
  if wt is not null then
    perform public.record_work_activity(me, wt, 'client-act:' || rid, 'client', p_key, null, null, d.partner_id, null, null, 1, p_note);
    update public.work_activities set source = 'crm' where dedupe_key = 'client-act:' || rid;
  end if;
  return rid;
end $$;

-- =============================================================== portfolio for a day (not personal work)
create or replace function public.portfolio_day(p_date date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with dd as (select coalesce(p_date, public.company_today()) as d),
  mine as (select x.application_id, x.application_created_at from public.application_attribution x where x.sub_officer_id = auth.uid()),
  first_offer as (
    select a.ref_id, min(a.at) as at from public.activities a
    where a.kind = 'status' and a.title in ('Status changed to Conditional Offer', 'Status changed to Unconditional Offer') and a.ref_id in (select application_id from mine)
    group by a.ref_id)
  select jsonb_build_object(
    'date', (select d from dd),
    'agencies', (select count(*) from public.onboarded_client_directory() where mine),
    'applications', (select count(*) from mine where (application_created_at at time zone public.company_tz())::date = (select d from dd)),
    'offers', (select count(*) from first_offer where (at at time zone public.company_tz())::date = (select d from dd)))
  where public.my_profile_ok() and public.is_staff();
$$;

do $$
declare f text;
begin
  foreach f in array array['partner_success_access()', 'client_directory_access()', 'onboarded_client_directory()', 'my_clients()',
                           'log_client_activity(text, text, text, text, date, uuid)', 'portfolio_day(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  begin alter publication supabase_realtime add table public.client_activities; exception when others then null; end;
end $$;

-- Partner Success Officers keep "applications" for their application work, but see only their own
-- attribution rows (not other officers' portfolio credit).
drop policy if exists "application attribution: read" on public.application_attribution;
create policy "application attribution: read" on public.application_attribution for select to authenticated
  using (public.my_profile_ok() and public.is_staff()
         and (public.is_super_admin() or public.agency_manager() or (public.staff_can('applications') and not public.staff_can('partner_success'))
              or sub_officer_id = auth.uid() or main_officer_id = auth.uid()));
