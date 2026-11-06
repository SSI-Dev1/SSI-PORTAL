-- 0022_partner_team.sql — run after 0021_attendance_auto_close.sql
-- (Supabase SQL Editor: Save this query as "0022_partner_team")
--
-- Partner Company Employees and commission visibility.
-- * Hierarchy: SSI GLOBAL Super Admin → Partner Company Admin (role partner_admin, created by SSI)
--   → Partner Company Employees (role partner_staff, created by the Partner Admin through the
--   partner-team Edge Function). The organisation always comes from the caller's own profile.
-- * profiles.partner_permissions: what one partner employee may do, from a fixed catalogue
--   (partner_permission_keys()). NULL keeps the access partner_staff accounts had before this
--   migration (every enabled module except finance and team management). A permission only works
--   while SSI GLOBAL keeps its module enabled for the organisation, so a Partner Admin can never
--   grant more than SSI allowed. Only the Edge Function (service role) or a Super Admin can change
--   it; nobody can change their own.
-- * partner_can() now also checks the user's own permissions, so every module rule (assessments,
--   updates, course finder, storage, chat …) narrows per employee. Students, applications and
--   documents get one policy per action (view / add / edit; view / create / update; view / upload).
-- * team.manage: Partner Admins always; an employee only when the Partner Admin grants it. Team
--   managers cannot manage other managers, cannot grant team.manage and never touch admins.
-- * Commission: partners.commission_rate is no longer selectable by end users. It is read through
--   partner_commissions(): SSI staff with Partners or Finance, Super Admin, and the organisation's
--   Partner Admin while SSI keeps commission_visible on. Commission invoices follow the same rule.
--   Partner employees never get commission or finance access.
-- * Attribution: students, applications and documents record created_by = the signed-in user
--   (set by the server); the audit log already records the actual actor of every change.
-- Safe to run more than once.

-- =============================================================== catalogue
create or replace function public.partner_permission_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['students.view', 'students.add', 'students.edit', 'applications.view', 'applications.create', 'applications.update',
               'chat', 'documents.view', 'documents.upload', 'course_finder', 'updates', 'assessments', 'team.manage'];
$$;

-- The partner module a permission depends on (null: no module needed).
create or replace function public.partner_perm_module(k text)
returns text language sql immutable set search_path = '' as $$
  select case
    when k like 'students.%' then 'students'
    when k like 'applications.%' or k = 'chat' then 'applications'
    when k like 'documents.%' then 'documents'
    when k in ('course_finder', 'updates', 'assessments') then k
    else null end;
$$;

alter table public.profiles add column if not exists partner_permissions text[];
alter table public.profiles drop constraint if exists profiles_partner_permissions_known;
alter table public.profiles add constraint profiles_partner_permissions_known
  check (partner_permissions is null or partner_permissions <@ public.partner_permission_keys());
alter table public.partners add column if not exists commission_visible boolean not null default true;

-- Permissions this organisation's users can hold (modules SSI enabled; team management always).
create or replace function public.partner_org_keys(p_partner text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(k order by k), '{}') from public.partners o, unnest(public.partner_permission_keys()) k
  where o.id = p_partner and (public.partner_perm_module(k) is null or public.partner_perm_module(k) = any (o.modules));
$$;

-- Effective permissions of the signed-in partner user ('{}' for everyone else).
create or replace function public.my_partner_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when public.my_partner_id() is null then '{}'::text[]
    when p.role = 'partner_admin' then public.partner_org_keys(p.partner_id)
    else coalesce((select array_agg(k order by k) from unnest(public.partner_org_keys(p.partner_id)) k
                   where (p.partner_permissions is null and k <> 'team.manage') or k = any (p.partner_permissions)), '{}') end
  from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.partner_perm(k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(k = any (public.my_partner_permissions()), false);
$$;

-- Module-level access (finance: Partner Admin only, as before).
create or replace function public.partner_can(m text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.partners o where o.id = public.my_partner_id() and m = any (o.modules))
     and (public.is_partner_admin()
          or exists (select 1 from unnest(public.my_partner_permissions()) k where public.partner_perm_module(k) = m));
$$;

-- Deleting records: Partner Admins, and accounts that kept the pre-0022 access.
create or replace function public.partner_can_delete()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_partner_admin()
      or (public.my_partner_id() is not null and (select partner_permissions is null from public.profiles where id = auth.uid()));
$$;

create or replace function public.can_view_commission(p_partner text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and (
    public.is_super_admin() or public.staff_can('partners') or public.staff_can('finance')
    or (public.is_partner_admin() and p_partner = public.my_partner_id()
        and exists (select 1 from public.partners o where o.id = p_partner and o.commission_visible)));
$$;

-- =============================================================== record policies
do $$
declare
  t text;
  keys jsonb := '{"students": ["students.view", "students.add", "students.edit"],
                  "applications": ["applications.view", "applications.create", "applications.update"],
                  "documents": ["documents.view", "documents.upload", "documents.upload"]}';
begin
  foreach t in array array['students', 'applications', 'documents'] loop
    execute coalesce((select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
             from pg_policy where polrelid = format('public.%I', t)::regclass), 'select 1');
    execute format('create policy "%1$s: read" on public.%1$I for select to authenticated
       using (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_perm(%2$L)))', t, keys -> t ->> 0);
    execute format('create policy "%1$s: add" on public.%1$I for insert to authenticated
       with check (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_perm(%2$L)))', t, keys -> t ->> 1);
    execute format('create policy "%1$s: edit" on public.%1$I for update to authenticated
       using (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_perm(%2$L)))
       with check (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_perm(%2$L)))', t, keys -> t ->> 2);
    execute format('create policy "%1$s: delete" on public.%1$I for delete to authenticated
       using (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_can(%1$L) and public.partner_can_delete()))', t);
  end loop;
end $$;

-- Storage: viewing and uploading student files follow the same permissions.
drop policy if exists "student docs: read" on storage.objects;
drop policy if exists "student docs: upload" on storage.objects;
drop policy if exists "student docs: delete" on storage.objects;
create policy "student docs: read" on storage.objects for select to authenticated using (
  bucket_id = 'student-documents'
  and (public.staff_can('documents')
       or ((storage.foldername(name))[1] = public.my_partner_id() and public.partner_perm('documents.view'))));
create policy "student docs: upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'student-documents'
  and position('..' in name) = 0
  and exists (
    select 1 from public.students s
    where s.id = (storage.foldername(name))[2]
      and s.partner_id = (storage.foldername(name))[1]
      and (public.staff_can('documents') or (s.partner_id = public.my_partner_id() and public.partner_perm('documents.upload')))));
create policy "student docs: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'student-documents'
  and (public.staff_can('documents')
       or ((storage.foldername(name))[1] = public.my_partner_id() and public.partner_can('documents') and public.partner_can_delete())));

-- =============================================================== attribution
create or replace function public.stamp_created_by()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() then new.created_by := auth.uid(); end if;   -- never taken from the browser
  return new;
end $$;
revoke all on function public.stamp_created_by() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['students', 'applications', 'documents'] loop
    execute format('alter table public.%I add column if not exists created_by uuid references public.profiles (id) on delete set null', t);
    execute format('drop trigger if exists %1$s_created_by on public.%1$I', t);
    execute format('create trigger %1$s_created_by before insert on public.%1$I for each row execute function public.stamp_created_by()', t);
  end loop;
end $$;

-- =============================================================== chat and notifications
create or replace function public.partner_recipients(p_partner text, p_module text, p_admin_only boolean default false)
returns setof uuid language sql stable security definer set search_path = '' as $$
  -- p_module: a module ('students') or a permission ('chat'); each user must hold it.
  with need as (
    select case when p_module = any (public.partner_permission_keys()) then public.partner_perm_module(p_module) else p_module end as module,
           p_module = any (public.partner_permission_keys()) as is_key
  )
  select p.id from public.profiles p join public.partners o on o.id = p.partner_id, need
  where p.partner_id = p_partner and p.status = 'active'
    and o.portal_enabled and o.archived_at is null and o.status <> 'Inactive'
    and need.module = any (o.modules)
    and (not p_admin_only or p.role = 'partner_admin')
    and (p.role = 'partner_admin'
         or (p.partner_permissions is null and need.module <> 'finance')
         or (need.is_key and p_module = any (p.partner_permissions))
         or (not need.is_key and exists (select 1 from unnest(p.partner_permissions) k where public.partner_perm_module(k) = need.module)));
$$;
revoke all on function public.partner_recipients(text, text, boolean) from public, anon, authenticated;

create or replace function public.can_access_application_chat(p_application text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_profile_ok() and exists (
    select 1 from public.applications a
    left join public.partners o on o.id = a.partner_id
    where a.id = p_application and (
      public.is_super_admin()
      or (public.is_staff() and public.staff_can('applications'))
      or (public.is_staff() and auth.uid() in (a.assigned_to, o.partnership_officer_id))
      or (a.partner_id = public.my_partner_id() and public.partner_perm('chat'))
    ));
$$;

create or replace function public.my_application_chats()
returns table (application_id text, unread bigint, total bigint, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (
    select auth.uid() as uid, public.my_profile_ok() as ok,
           public.is_super_admin() or (public.is_staff() and public.staff_can('applications')) as all_apps,
           public.is_staff() as staff, public.my_partner_id() as partner, public.partner_perm('chat') as partner_ok
  )
  select a.id,
         count(m.id) filter (where m.sender_id is distinct from me.uid and m.id > coalesce(r.last_read_id, 0)),
         count(m.id),
         max(m.created_at)
  from me
  join public.applications a on me.ok and (
    me.all_apps
    or (me.staff and a.assigned_to = me.uid)
    or (me.staff and exists (select 1 from public.partners o where o.id = a.partner_id and o.partnership_officer_id = me.uid))
    or (a.partner_id = me.partner and me.partner_ok))
  left join public.application_chat_reads r on r.application_id = a.id and r.user_id = me.uid
  left join public.application_messages m on m.application_id = a.id
  group by a.id;
$$;

create or replace function public.notify_application_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  app record;
  v_link text := 'applications?chat=' || new.application_id;
  people uuid[];
begin
  select a.ref, a.partner_id, a.assigned_to, o.partnership_officer_id as officer, s.first_name || ' ' || s.last_name as student
  into app
  from public.applications a
  join public.students s on s.id = a.student_id
  left join public.partners o on o.id = a.partner_id
  where a.id = new.application_id;

  select array_agg(distinct u) into people from (
    select r as u from public.partner_recipients(app.partner_id, 'chat') r
    union select p.id from public.profiles p
      where p.status = 'active' and (p.role = 'super_admin'
        or (p.role = 'admin_staff' and 'applications' = any (coalesce(p.permissions, public.role_default_permissions(p.role)))))
    union select p.id from public.profiles p
      where p.status = 'active' and p.role = any (public.staff_roles()) and p.id in (app.assigned_to, app.officer)
    union select p.id from public.application_chat_reads r join public.profiles p on p.id = r.user_id
      where r.application_id = new.application_id and p.status = 'active' and p.role = any (public.staff_roles())
        and 'applications' = any (coalesce(p.permissions, public.role_default_permissions(p.role)))
  ) x
  where u is distinct from new.sender_id
    and not exists (select 1 from public.notifications n where n.user_id = u and n.kind = 'chat' and n.link = v_link and n.read_at is null);

  if people is not null then
    perform public.notify(people, 'chat', 'New message · ' || app.ref, new.sender_name || ' · ' || coalesce(app.student, ''), v_link);
  end if;
  return null;
end $$;

-- =============================================================== commission
-- Column privileges: every partners column except commission_rate stays readable as before.
do $$
declare cols text;
begin
  revoke select on public.partners from authenticated, anon;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'partners' and column_name <> 'commission_rate';
  execute format('grant select (%s) on public.partners to authenticated', cols);
end $$;

create or replace function public.partner_commissions()
returns table (partner_id text, commission_rate numeric)
language sql stable security definer set search_path = '' as $$
  select o.id, o.commission_rate from public.partners o where public.can_view_commission(o.id);
$$;

drop policy if exists "payments: read" on public.payments;
create policy "payments: read" on public.payments for select to authenticated
  using (public.staff_can('finance')
         or (public.is_partner_admin() and partner_id = public.my_partner_id() and public.partner_can('finance')
             and (type <> 'Commission' or public.can_view_commission(partner_id))));

-- Only a Super Admin changes commission visibility.
create or replace function public.guard_partner_commission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_super_admin()
     and new.commission_visible is distinct from old.commission_visible then
    raise exception 'Only a Super Admin can change commission visibility';
  end if;
  return new;
end $$;
drop trigger if exists partners_guard_commission on public.partners;
create trigger partners_guard_commission before update on public.partners
  for each row execute function public.guard_partner_commission();

-- =============================================================== accounts
-- Partner permissions change only through the partner-team / admin-users functions (service role)
-- or a Super Admin; never by the user themself.
create or replace function public.guard_partner_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_super_admin()
     and new.partner_permissions is distinct from old.partner_permissions then
    raise exception 'Partner permissions can only be changed by the Partner Admin';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_partner_permissions on public.profiles;
create trigger profiles_guard_partner_permissions before update on public.profiles
  for each row execute function public.guard_partner_permissions();

-- Team managers read their organisation's accounts (directory, realtime).
drop policy if exists "profiles: partner team read" on public.profiles;
create policy "profiles: partner team read" on public.profiles for select to authenticated
  using (partner_id is not null and partner_id = public.my_partner_id() and public.partner_perm('team.manage'));

-- The team directory, with last sign-in (from Supabase Auth).
create or replace function public.partner_team()
returns table (id uuid, full_name text, email text, phone text, designation text, department text, role text, status text,
               partner_permissions text[], effective_permissions text[], last_sign_in_at timestamptz, created_at timestamptz,
               created_by_name text, manageable boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.phone, p.designation, p.department, p.role, p.status, p.partner_permissions,
         case when p.role = 'partner_admin' then public.partner_org_keys(p.partner_id)
              else coalesce((select array_agg(k order by k) from unnest(public.partner_org_keys(p.partner_id)) k
                             where (p.partner_permissions is null and k <> 'team.manage') or k = any (p.partner_permissions)), '{}') end,
         u.last_sign_in_at, p.created_at, c.full_name,
         p.role = 'partner_staff' and p.id <> auth.uid()
           and (public.is_partner_admin() or not ('team.manage' = any (coalesce(p.partner_permissions, '{}'))))
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.profiles c on c.id = p.created_by
  where public.partner_perm('team.manage') and p.partner_id = public.my_partner_id()
  order by p.role, p.full_name;
$$;

-- Permissions this caller may grant.
create or replace function public.partner_team_grantable()
returns text[] language sql stable security definer set search_path = '' as $$
  select case when not public.partner_perm('team.manage') then '{}'::text[]
              else array(select k from unnest(public.partner_org_keys(public.my_partner_id())) k
                         where k <> 'team.manage' or public.is_partner_admin()) end;
$$;

-- Authorises a team action for the caller and returns their organisation. Called by the
-- partner-team Edge Function with the caller's own token before it writes anything.
create or replace function public.partner_team_authorize(p_action text, p_target uuid default null, p_permissions text[] default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  org text := public.my_partner_id();
  t record;
begin
  if org is null or not public.partner_perm('team.manage') then
    raise exception 'TEAM_DENIED: Only your Partner Admin can manage team accounts' using errcode = '42501';
  end if;
  if p_action not in ('create', 'update', 'status', 'reset_password') then raise exception 'TEAM_INVALID: Unknown action'; end if;
  if p_permissions is not null then
    if not (p_permissions <@ public.partner_permission_keys()) then raise exception 'TEAM_INVALID: Unknown permission'; end if;
    if not (p_permissions <@ public.partner_team_grantable()) then
      raise exception 'TEAM_DENIED: You cannot grant a permission your organisation or role does not allow' using errcode = '42501';
    end if;
  end if;
  if p_action = 'create' then
    if p_target is not null then raise exception 'TEAM_INVALID: Unexpected account'; end if;
    return org;
  end if;
  select p.id, p.role, p.partner_id, p.partner_permissions into t from public.profiles p where p.id = p_target;
  if t.id is null or t.partner_id is distinct from org then
    raise exception 'TEAM_DENIED: This account is not in your organisation' using errcode = '42501';
  end if;
  if t.id = auth.uid() then raise exception 'TEAM_DENIED: You cannot manage your own account here' using errcode = '42501'; end if;
  if t.role <> 'partner_staff' then
    raise exception 'TEAM_DENIED: Partner Admin accounts are managed by SSI GLOBAL' using errcode = '42501';
  end if;
  if not public.is_partner_admin() and 'team.manage' = any (coalesce(t.partner_permissions, '{}')) then
    raise exception 'TEAM_DENIED: Only the Partner Admin can manage another team manager' using errcode = '42501';
  end if;
  return org;
end $$;

-- =============================================================== my_access
drop function if exists public.my_access();
create function public.my_access()
returns table (role text, status text, permissions text[], partner_id text, partner_name text,
               partner_modules text[], portal_open boolean, must_change_password boolean, department text,
               employee boolean, designations text[], has_team boolean,
               partner_permissions text[], commission boolean)
language sql stable security definer set search_path = '' as $$
  select p.role, p.status, public.my_permissions(), p.partner_id, o.name,
         case when public.my_partner_id() is not null then o.modules else array[]::text[] end,
         public.my_partner_id() is not null, p.must_change_password, p.department,
         e.id is not null and public.is_staff(),
         case when e.id is not null and public.is_staff() then array[e.designation_id] || e.additional_designations else array[]::text[] end,
         public.is_staff() and exists (select 1 from public.employees r where r.reporting_manager_id = p.id),
         public.my_partner_permissions(),
         case when p.partner_id is not null then public.can_view_commission(p.partner_id) else public.can_view_commission(null) or public.is_super_admin() or public.staff_can('partners') or public.staff_can('finance') end
  from public.profiles p
  left join public.partners o on o.id = p.partner_id
  left join public.employees e on e.id = p.id
  where p.id = auth.uid();
$$;

-- =============================================================== grants
do $$
declare f text;
begin
  foreach f in array array['my_access()', 'my_partner_permissions()', 'partner_perm(text)', 'partner_can(text)', 'partner_can_delete()',
                           'can_view_commission(text)', 'partner_commissions()', 'partner_team()', 'partner_team_grantable()',
                           'partner_team_authorize(text, uuid, text[])',
                           'can_access_application_chat(text)', 'my_application_chats()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.partner_org_keys(text) from public, anon, authenticated;
end $$;
