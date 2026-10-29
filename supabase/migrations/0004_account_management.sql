-- SSI GLOBAL CRM — admin-controlled accounts, employee roles and permissions (run after 0003).
--
-- * Six employee roles; each employee has module permissions (role defaults, overridable
--   by a Super Admin). Every table policy checks the module, so access is enforced here.
-- * Partner organisations get a portal switch and a list of enabled modules. Switching the
--   portal off, setting the partner Inactive or archiving it removes all partner access.
-- * Account status: active / suspended / deactivated. Any non-active status, or an
--   administrative password reset, revokes existing sessions (auth.sessions rows and any
--   access token issued before sessions_revoked_at).
-- * Accounts are created by the admin-users Edge Function (service role); no invitations.

-- =============================================================== columns & constraints
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_partner_scope;
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_role_check check (role in (
    'super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff',
    'partner_admin', 'partner_staff')),
  add constraint profiles_partner_scope check (
    (role in ('partner_admin', 'partner_staff')) = (partner_id is not null)),
  add constraint profiles_status_check check (status in ('active', 'suspended', 'deactivated'));

-- null = the role's default permissions
alter table public.profiles add column if not exists permissions text[];
alter table public.profiles add column if not exists sessions_revoked_at timestamptz;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists created_by uuid;
create unique index if not exists profiles_email_unique on public.profiles (lower(email)) where email is not null;

alter table public.partners add column if not exists portal_enabled boolean not null default true;
alter table public.partners add column if not exists modules text[] not null
  default array['students', 'applications', 'course_finder', 'assessments', 'documents', 'finance', 'updates'];
alter table public.partners add column if not exists archived_at timestamptz;

-- =============================================================== permission model
create or replace function public.staff_roles()
returns text[] language sql immutable set search_path = '' as $$
  select array['super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff'];
$$;

create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports'];
$$;

create or replace function public.partner_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['students', 'applications', 'course_finder', 'assessments', 'documents', 'finance', 'updates'];
$$;

create or replace function public.role_default_permissions(r text)
returns text[] language sql immutable set search_path = '' as $$
  select case r
    when 'super_admin'         then public.staff_modules()
    when 'admin_staff'         then public.staff_modules()
    when 'application_manager' then array['partners', 'students', 'applications', 'documents', 'catalogue', 'tasks', 'reports']
    when 'assessment_staff'    then array['partners', 'students', 'assessments', 'documents', 'catalogue', 'tasks']
    when 'finance_staff'       then array['partners', 'finance', 'reports', 'tasks']
    when 'support_staff'       then array['partners', 'students', 'updates', 'tasks']
    else array[]::text[]
  end;
$$;

-- The caller's profile, if it is active and the presented token was issued after the last
-- session revocation (password reset / suspension). Everything else builds on this.
create or replace function public.my_profile_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and (p.sessions_revoked_at is null
           or coalesce((auth.jwt() ->> 'iat')::bigint, 0) >= ceil(extract(epoch from p.sessions_revoked_at))::bigint));
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and public.my_profile_ok();
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = any (public.staff_roles()), false);
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'super_admin', false);
$$;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_staff() then array[]::text[]
    when p.role = 'super_admin' then public.staff_modules()
    else coalesce(p.permissions, public.role_default_permissions(p.role))
  end
  from public.profiles p where p.id = auth.uid();
$$;

-- Employee may use a module (Super Admin: everything).
create or replace function public.staff_can(m text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(m = any (public.my_permissions()), false);
$$;

-- Partner organisation of the caller, only while that organisation's portal is open.
create or replace function public.my_partner_id()
returns text language sql stable security definer set search_path = '' as $$
  select p.partner_id from public.profiles p
  join public.partners o on o.id = p.partner_id
  where p.id = auth.uid() and p.role in ('partner_admin', 'partner_staff') and public.my_profile_ok()
    and o.portal_enabled and o.archived_at is null and o.status <> 'Inactive';
$$;

create or replace function public.partner_can(m text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.partners o
    where o.id = public.my_partner_id() and m = any (o.modules));
$$;

create or replace function public.is_partner_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.my_partner_id() is not null and public.my_role() = 'partner_admin';
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() or public.my_partner_id() is not null;
$$;

-- What the app needs to build menus. Computed here so the browser never decides it.
create or replace function public.my_access()
returns table (role text, status text, permissions text[], partner_id text, partner_name text,
               partner_modules text[], portal_open boolean, must_change_password boolean)
language sql stable security definer set search_path = '' as $$
  select p.role, p.status, public.my_permissions(), p.partner_id, o.name,
         case when public.my_partner_id() is not null then o.modules else array[]::text[] end,
         public.my_partner_id() is not null, p.must_change_password
  from public.profiles p left join public.partners o on o.id = p.partner_id
  where p.id = auth.uid();
$$;

-- Clears the "change password at next sign-in" flag after the user has set a new password.
create or replace function public.password_change_done()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

do $$
declare f text;
begin
  foreach f in array array['my_profile_ok()', 'my_role()', 'is_staff()', 'is_super_admin()', 'my_permissions()',
                           'staff_can(text)', 'my_partner_id()', 'partner_can(text)', 'is_partner_admin()',
                           'is_active_user()', 'my_access()', 'password_change_done()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =============================================================== table policies (module-aware)
do $$
declare t text;
begin
  foreach t in array array['students', 'applications', 'documents', 'assessments'] loop
    execute format('drop policy if exists "%1$s: tenant access" on public.%1$I', t);
    execute format(
      'create policy "%1$s: tenant access" on public.%1$I for all to authenticated
         using (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_can(%1$L)))
         with check (public.staff_can(%1$L) or (partner_id = public.my_partner_id() and public.partner_can(%1$L)))', t);
  end loop;
end $$;

-- partners: every employee can read names (shown everywhere); editing needs "partners".
drop policy if exists "partners: read own or admin" on public.partners;
drop policy if exists "partners: staff insert" on public.partners;
drop policy if exists "partners: staff update" on public.partners;
create policy "partners: read" on public.partners for select to authenticated
  using (public.is_staff() or id = public.my_partner_id());
create policy "partners: staff insert" on public.partners for insert to authenticated with check (public.staff_can('partners'));
create policy "partners: staff update" on public.partners for update to authenticated
  using (public.staff_can('partners')) with check (public.staff_can('partners'));

-- Portal access, modules, activation and archiving are Super Admin decisions.
create or replace function public.guard_partner_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() then
    if not public.is_staff()
       and (new.name, new.code, new.status, new.tier, new.branches, new.commission_rate, new.country, new.id)
           is distinct from (old.name, old.code, old.status, old.tier, old.branches, old.commission_rate, old.country, old.id) then
      raise exception 'Only SSI GLOBAL staff can change these partner details';
    end if;
    if not public.is_super_admin()
       and (new.portal_enabled, new.modules, new.archived_at, new.status)
           is distinct from (old.portal_enabled, old.modules, old.archived_at, old.status) then
      raise exception 'Only a Super Admin can change partner access';
    end if;
  end if;
  if not (new.modules <@ public.partner_modules()) then raise exception 'Unknown partner module'; end if;
  return new;
end $$;

create or replace function public.guard_partner_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_super_admin() then
    -- New organisations start with the portal closed until a Super Admin opens it.
    new.portal_enabled := false;
    new.modules := public.partner_modules();
    new.archived_at := null;
  end if;
  return new;
end $$;
drop trigger if exists partners_guard_insert on public.partners;
create trigger partners_guard_insert before insert on public.partners
  for each row execute function public.guard_partner_insert();

-- payments
drop policy if exists "payments: read" on public.payments;
drop policy if exists "payments: admin writes" on public.payments;
create policy "payments: read" on public.payments for select to authenticated
  using (public.staff_can('finance')
         or (public.is_partner_admin() and partner_id = public.my_partner_id() and public.partner_can('finance')));
create policy "payments: staff writes" on public.payments for all to authenticated
  using (public.staff_can('finance')) with check (public.staff_can('finance'));

-- announcements
drop policy if exists "announcements: partner read" on public.announcements;
drop policy if exists "announcements: admin writes" on public.announcements;
create policy "announcements: read" on public.announcements for select to authenticated
  using (public.staff_can('updates')
         or (public.partner_can('updates') and published and publish_at <= now()
             and (audience is null or public.my_partner_id() = any (audience))));
create policy "announcements: staff writes" on public.announcements for all to authenticated
  using (public.staff_can('updates')) with check (public.staff_can('updates'));

-- catalogue (read by every active user: applications reference it)
drop policy if exists "universities: admin writes" on public.universities;
drop policy if exists "courses: admin writes" on public.courses;
create policy "universities: staff writes" on public.universities for all to authenticated
  using (public.staff_can('catalogue')) with check (public.staff_can('catalogue'));
create policy "courses: staff writes" on public.courses for all to authenticated
  using (public.staff_can('catalogue')) with check (public.staff_can('catalogue'));

-- tasks
drop policy if exists "tasks: staff" on public.tasks;
create policy "tasks: staff" on public.tasks for all to authenticated
  using (public.staff_can('tasks')) with check (public.staff_can('tasks'));

-- documents storage
drop policy if exists "student docs: read" on storage.objects;
drop policy if exists "student docs: upload" on storage.objects;
drop policy if exists "student docs: delete" on storage.objects;
create policy "student docs: read" on storage.objects for select to authenticated using (
  bucket_id = 'student-documents'
  and (public.staff_can('documents')
       or ((storage.foldername(name))[1] = public.my_partner_id() and public.partner_can('documents'))));
create policy "student docs: upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'student-documents'
  and position('..' in name) = 0
  and exists (
    select 1 from public.students s
    where s.id = (storage.foldername(name))[2]
      and s.partner_id = (storage.foldername(name))[1]
      and (public.staff_can('documents') or (s.partner_id = public.my_partner_id() and public.partner_can('documents')))));
create policy "student docs: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'student-documents'
  and (public.staff_can('documents')
       or ((storage.foldername(name))[1] = public.my_partner_id() and public.partner_can('documents'))));

-- =============================================================== profiles
-- Employees still read profiles (names in timelines); only Super Admins change accounts.
create or replace function public.guard_profile_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and new.id = auth.uid()
     and (new.role is distinct from old.role or new.status is distinct from old.status
          or new.partner_id is distinct from old.partner_id or new.permissions is distinct from old.permissions
          or new.sessions_revoked_at is distinct from old.sessions_revoked_at
          or (new.must_change_password and not old.must_change_password)) then
    raise exception 'You cannot change your own role, organisation, permissions or status';
  end if;
  if new.permissions is not null and not (new.permissions <@ public.staff_modules()) then
    raise exception 'Unknown permission';
  end if;
  if new.role not in ('super_admin', 'admin_staff', 'application_manager', 'assessment_staff', 'finance_staff', 'support_staff')
     and new.permissions is not null then
    new.permissions := null;
  end if;
  -- Leaving "active" ends every existing session.
  if new.status <> 'active' and old.status = 'active' then
    new.sessions_revoked_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.revoke_sessions_on_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sessions_revoked_at is distinct from old.sessions_revoked_at then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_revoke_sessions on public.profiles;
create trigger profiles_revoke_sessions after update on public.profiles
  for each row execute function public.revoke_sessions_on_status();

-- Used by the admin-users function after a password reset (service role only).
create or replace function public.admin_revoke_sessions(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  update public.profiles set sessions_revoked_at = now() where id = p_user;
$$;
revoke all on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;

-- User directory for Super Admins (adds sign-in times from auth.users; never password data).
create or replace function public.user_directory()
returns table (id uuid, full_name text, email text, role text, status text, partner_id text, partner_name text,
               permissions text[], must_change_password boolean, created_at timestamptz,
               last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.role, p.status, p.partner_id, o.name,
         case when p.role = any (public.staff_roles()) then coalesce(p.permissions, public.role_default_permissions(p.role)) end,
         p.must_change_password, p.created_at, u.last_sign_in_at
  from public.profiles p
  left join public.partners o on o.id = p.partner_id
  left join auth.users u on u.id = p.id
  where public.is_super_admin()
  order by p.created_at desc;
$$;
revoke all on function public.user_directory() from public, anon;
grant execute on function public.user_directory() to authenticated;

-- =============================================================== audit events
create or replace function public.log_event(event text, entity_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if event not in ('login', 'logout', 'idle_timeout', 'password_changed', 'document_download') then
    raise exception 'Unknown event';
  end if;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id)
  values (auth.uid(), public.my_role(), event, case when event = 'document_download' then 'documents' end,
          left(entity_id, 64), public.my_partner_id());
end $$;
