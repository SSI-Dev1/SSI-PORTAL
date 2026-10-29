-- SSI GLOBAL CRM — real-time sync, notifications, live activity, assignments (run after 0004).
--
-- * Tables join the supabase_realtime publication. Supabase Realtime checks each
--   subscriber's RLS SELECT policy before delivering a change, so every portal only hears
--   about rows it may read; the app then re-fetches those tables through RLS.
-- * notifications: per-user inbox written only by triggers (after the change commits with
--   the transaction), so users cannot forge or read other people's notifications.
-- * activities: every entry is stamped server-side with who did it, their role and their
--   organisation / department.
-- * updated_at on every editable table: the app sends it with edits so a stale form cannot
--   silently overwrite someone else's newer change.

-- =============================================================== new columns
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists designation text;

alter table public.partners add column if not exists address text;

alter table public.applications add column if not exists assigned_to uuid references public.profiles (id) on delete set null;
alter table public.tasks add column if not exists assigned_to uuid references public.profiles (id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['partners', 'students', 'documents', 'assessments', 'payments', 'tasks', 'announcements'] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
  end loop;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['partners', 'students', 'documents', 'assessments', 'payments', 'tasks', 'announcements'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Only employees may assign work.
create or replace function public.guard_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_staff()
     and new.assigned_to is distinct from (case when tg_op = 'UPDATE' then old.assigned_to end) then
    raise exception 'Only SSI GLOBAL staff can assign work';
  end if;
  if new.assigned_to is not null and not exists (
       select 1 from public.profiles p where p.id = new.assigned_to and p.role = any (public.staff_roles())) then
    raise exception 'Work can only be assigned to SSI GLOBAL staff';
  end if;
  return new;
end $$;
drop trigger if exists applications_assignment on public.applications;
create trigger applications_assignment before insert or update on public.applications
  for each row execute function public.guard_assignment();
drop trigger if exists tasks_assignment on public.tasks;
create trigger tasks_assignment before insert or update on public.tasks
  for each row execute function public.guard_assignment();

-- Employees with "tasks" also see tasks assigned to them even without the module.
drop policy if exists "tasks: staff" on public.tasks;
create policy "tasks: staff" on public.tasks for all to authenticated
  using (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid()))
  with check (public.staff_can('tasks') or (public.is_staff() and assigned_to = auth.uid()));

-- =============================================================== activity feed: who did it
alter table public.activities add column if not exists actor_id uuid;
alter table public.activities add column if not exists actor_name text;
alter table public.activities add column if not exists actor_role text;
alter table public.activities add column if not exists actor_org text;
alter table public.activities add column if not exists student_name text;

create or replace function public.stamp_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  new.at := now();
  new.actor_id := coalesce(new.actor_id, auth.uid());
  select pr.full_name, pr.role, pr.department, o.name as org into p
  from public.profiles pr left join public.partners o on o.id = pr.partner_id
  where pr.id = new.actor_id;
  if found then
    new.actor_name := coalesce(p.full_name, 'User');
    new.actor_role := p.role;
    new.actor_org := case when p.org is not null then p.org else 'SSI GLOBAL' || coalesce(' · ' || p.department, '') end;
  else
    new.actor_name := coalesce(new.actor_name, 'System');
    new.actor_org := coalesce(new.actor_org, 'SSI GLOBAL');
  end if;
  return new;
end $$;
drop trigger if exists activities_stamp on public.activities;
create trigger activities_stamp before insert on public.activities
  for each row execute function public.stamp_activity();

-- Account events (written by the admin-users function) are for Super Admins only.
drop policy if exists "activities: read" on public.activities;
create policy "activities: read" on public.activities for select to authenticated using (
  (kind = 'account' and public.is_super_admin())
  or (kind <> 'account' and public.is_staff())
  or (kind <> 'account' and partner_id is not null and partner_id = public.my_partner_id())
  or (kind = 'update' and exists (select 1 from public.announcements a where a.id = activities.ref_id))
);

create or replace function public.record_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  sname text;
  uni_name text;
  r record := coalesce(new, old);
begin
  if tg_table_name in ('applications', 'documents', 'assessments') then
    select first_name || ' ' || last_name into sname from public.students where id = r.student_id;
  end if;

  if tg_table_name = 'students' then
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'student', 'New student added', new.first_name || ' ' || new.last_name, new.id, new.first_name || ' ' || new.last_name);
    elsif tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'student', 'Student details updated', new.first_name || ' ' || new.last_name, new.id, new.first_name || ' ' || new.last_name);
    elsif tg_op = 'DELETE' then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (old.partner_id, 'student', 'Student removed', old.first_name || ' ' || old.last_name, old.id, old.first_name || ' ' || old.last_name);
    end if;
  elsif tg_table_name = 'applications' then
    select name into uni_name from public.universities where id = r.university_id;
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'application', 'New application created', new.ref || ' · ' || coalesce(uni_name, ''), new.id, sname);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'status', 'Status changed to ' || new.status, new.ref || ' · ' || coalesce(uni_name, ''), new.id, sname);
    elsif tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'application', 'Application assigned', new.ref, new.id, sname);
    end if;
  elsif tg_table_name = 'documents' then
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'document', 'Document uploaded', new.type, new.id, sname);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'document', 'Document ' || lower(new.status), new.type, new.id, sname);
    end if;
  elsif tg_table_name = 'assessments' then
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'assessment', 'Assessment requested', sname, new.id, sname);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.activities (partner_id, kind, title, detail, ref_id, student_name)
      values (new.partner_id, 'assessment', 'Assessment marked ' || new.status, sname, new.id, sname);
    end if;
  elsif tg_table_name = 'payments' then
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'payment', 'Invoice issued', new.invoice_no, new.id);
    elsif tg_op = 'UPDATE' and new.paid is distinct from old.paid then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'payment', 'Payment recorded', new.invoice_no, new.id);
    end if;
  elsif tg_table_name = 'partners' then
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.id, 'partner', 'New partner onboarded', new.name, new.id);
    elsif tg_op = 'UPDATE' and (new.portal_enabled, new.status, new.archived_at) is distinct from (old.portal_enabled, old.status, old.archived_at) then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.id, 'partner',
              case when new.archived_at is not null then 'Partner archived'
                   when new.portal_enabled and new.status <> 'Inactive' then 'Partner portal enabled'
                   else 'Partner portal disabled' end,
              new.name, new.id);
    end if;
  elsif tg_table_name = 'announcements' then
    if tg_op <> 'DELETE' and new.published and (tg_op = 'INSERT' or not old.published) then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (null, 'update', 'Announcement published', new.title, new.id);
    end if;
  elsif tg_table_name = 'tasks' then
    if tg_op <> 'DELETE' and new.assigned_to is not null
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (null, 'task', 'Task assigned', new.title, new.id);
    elsif tg_op = 'UPDATE' and new.done and not old.done then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (null, 'task', 'Task completed', new.title, new.id);
    end if;
  end if;
  return r;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students', 'applications', 'documents', 'assessments', 'payments', 'partners', 'announcements', 'tasks'] loop
    execute format('drop trigger if exists %1$s_activity on public.%1$I', t);
    execute format('create trigger %1$s_activity after insert or update or delete on public.%1$I
                    for each row execute function public.record_activity()', t);
  end loop;
end $$;

-- =============================================================== notifications
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind       text not null,
  title      text not null,
  body       text,
  link       text,          -- portal-relative path, e.g. "applications"
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
grant select, update, delete on public.notifications to authenticated;

drop policy if exists "notifications: own" on public.notifications;
drop policy if exists "notifications: mark read" on public.notifications;
drop policy if exists "notifications: clear" on public.notifications;
create policy "notifications: own" on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.my_profile_ok());
create policy "notifications: mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid() and public.my_profile_ok()) with check (user_id = auth.uid());
create policy "notifications: clear" on public.notifications for delete to authenticated
  using (user_id = auth.uid() and public.my_profile_ok());

-- Users can only change read_at on their own rows.
create or replace function public.guard_notification_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Only the read state can be changed';
  end if;
  return new;
end $$;
drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard before update on public.notifications
  for each row execute function public.guard_notification_update();

-- Recipients ---------------------------------------------------------------
create or replace function public.partner_recipients(p_partner text, p_module text, p_admin_only boolean default false)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.partners o on o.id = p.partner_id
  where p.partner_id = p_partner and p.status = 'active'
    and o.portal_enabled and o.archived_at is null and o.status <> 'Inactive'
    and p_module = any (o.modules)
    and (not p_admin_only or p.role = 'partner_admin');
$$;

create or replace function public.staff_recipients(p_module text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.status = 'active' and p.role = any (public.staff_roles())
    and (p.role = 'super_admin' or p_module = any (coalesce(p.permissions, public.role_default_permissions(p.role))));
$$;

create or replace function public.notify(p_users uuid[], p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct u, p_kind, p_title, p_body, p_link
  from unnest(p_users) u
  where u is not null and u is distinct from auth.uid();   -- never notify the person who acted
$$;

revoke all on function public.partner_recipients(text, text, boolean) from public, anon, authenticated;
revoke all on function public.staff_recipients(text) from public, anon, authenticated;
revoke all on function public.notify(uuid[], text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_on_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  by_partner boolean := public.my_partner_id() is not null;   -- change made by a partner user
  org text;
  sname text;
begin
  if tg_table_name = 'students' and tg_op = 'INSERT' and by_partner then
    select name into org from public.partners where id = new.partner_id;
    perform public.notify(array(select public.staff_recipients('students')), 'student',
      'New student from ' || coalesce(org, 'a partner'), new.first_name || ' ' || new.last_name, 'students/' || new.id);

  elsif tg_table_name = 'applications' then
    select first_name || ' ' || last_name into sname from public.students where id = new.student_id;
    if tg_op = 'INSERT' and by_partner then
      select name into org from public.partners where id = new.partner_id;
      perform public.notify(array(select public.staff_recipients('applications')), 'application',
        'New application from ' || coalesce(org, 'a partner'), new.ref || ' · ' || coalesce(sname, ''), 'applications?open=' || new.id);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      if not by_partner then
        perform public.notify(array(select public.partner_recipients(new.partner_id, 'applications')), 'status',
          'Application ' || new.ref || ': ' || new.status, sname, 'applications?open=' || new.id);
      end if;
      perform public.notify(array[new.assigned_to], 'status',
        'Application ' || new.ref || ': ' || new.status, sname, 'applications?open=' || new.id);
    end if;
    if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
      perform public.notify(array[new.assigned_to], 'assignment',
        'Application assigned to you', new.ref || ' · ' || coalesce(sname, ''), 'applications?open=' || new.id);
    end if;

  elsif tg_table_name = 'documents' then
    select first_name || ' ' || last_name into sname from public.students where id = new.student_id;
    if tg_op = 'INSERT' and by_partner then
      perform public.notify(array(select public.staff_recipients('documents')), 'document',
        'Document to verify', new.type || ' · ' || coalesce(sname, ''), 'documents');
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('Verified', 'Rejected') then
      perform public.notify(array(select public.partner_recipients(new.partner_id, 'documents')), 'document',
        'Document ' || lower(new.status), new.type || ' · ' || coalesce(sname, ''), 'documents');
    end if;

  elsif tg_table_name = 'assessments' then
    select first_name || ' ' || last_name into sname from public.students where id = new.student_id;
    if tg_op = 'INSERT' and by_partner then
      perform public.notify(array(select public.staff_recipients('assessments')), 'assessment',
        'Assessment requested', sname, 'assessments');
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status and not by_partner then
      perform public.notify(array(select public.partner_recipients(new.partner_id, 'assessments')), 'assessment',
        'Assessment: ' || new.status, sname, 'assessments');
    end if;

  elsif tg_table_name = 'payments' and tg_op = 'INSERT' then
    perform public.notify(array(select public.partner_recipients(new.partner_id, 'finance', true)), 'payment',
      'New invoice ' || new.invoice_no, null, 'finance');

  elsif tg_table_name = 'tasks' then
    if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
      perform public.notify(array[new.assigned_to], 'task', 'Task assigned to you', new.title, 'tasks');
    end if;

  elsif tg_table_name = 'announcements' then
    if new.published and new.publish_at <= now() and (tg_op = 'INSERT' or not old.published) then
      perform public.notify(array(
        select r from public.partners o, lateral public.partner_recipients(o.id, 'updates') r
        where new.audience is null or o.id = any (new.audience)), 'update', new.title, new.category, 'updates');
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students', 'applications', 'documents', 'assessments', 'payments', 'tasks', 'announcements'] loop
    execute format('drop trigger if exists %1$s_notify on public.%1$I', t);
    execute format('create trigger %1$s_notify after insert or update on public.%1$I
                    for each row execute function public.notify_on_change()', t);
  end loop;
end $$;

-- Staff directory for assigning work (employees only; no emails or permissions).
create or replace function public.staff_directory()
returns table (id uuid, full_name text, role text, department text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role, p.department from public.profiles p
  where public.is_staff() and p.status = 'active' and p.role = any (public.staff_roles())
  order by p.full_name;
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

-- Directory now also returns the contact fields.
drop function if exists public.user_directory();
create function public.user_directory()
returns table (id uuid, full_name text, email text, role text, status text, partner_id text, partner_name text,
               permissions text[], must_change_password boolean, created_at timestamptz,
               last_sign_in_at timestamptz, phone text, department text, designation text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.role, p.status, p.partner_id, o.name,
         case when p.role = any (public.staff_roles()) then coalesce(p.permissions, public.role_default_permissions(p.role)) end,
         p.must_change_password, p.created_at, u.last_sign_in_at, p.phone, p.department, p.designation
  from public.profiles p
  left join public.partners o on o.id = p.partner_id
  left join auth.users u on u.id = p.id
  where public.is_super_admin()
  order by p.created_at desc;
$$;
revoke all on function public.user_directory() from public, anon;
grant execute on function public.user_directory() to authenticated;

-- my_access() also tells the app which portal to open.
drop function if exists public.my_access();
create function public.my_access()
returns table (role text, status text, permissions text[], partner_id text, partner_name text,
               partner_modules text[], portal_open boolean, must_change_password boolean, department text)
language sql stable security definer set search_path = '' as $$
  select p.role, p.status, public.my_permissions(), p.partner_id, o.name,
         case when public.my_partner_id() is not null then o.modules else array[]::text[] end,
         public.my_partner_id() is not null, p.must_change_password, p.department
  from public.profiles p left join public.partners o on o.id = p.partner_id
  where p.id = auth.uid();
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- =============================================================== realtime publication
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['partners', 'profiles', 'students', 'applications', 'documents', 'assessments',
                             'payments', 'tasks', 'announcements', 'activities', 'notifications'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
