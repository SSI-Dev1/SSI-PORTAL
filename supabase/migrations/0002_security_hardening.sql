-- SSI GLOBAL CRM — security hardening (run after 0001).
--
-- * Four roles: super_admin, admin_staff (SSI GLOBAL) / partner_admin, partner_staff (consultancies)
-- * Staff privileges require an MFA-verified session (JWT aal = aal2), enforced in the database
-- * Account suspension (profiles.status) removes all data access immediately
-- * Tenant (partner_id) is derived server-side, never trusted from the browser
-- * Server-managed application refs/timelines, activity feed and append-only audit log
-- * Private document storage bucket with per-partner folder policies
-- Idempotent where practical; review before running on a database with real data.

-- =============================================================== roles & profiles
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists partner_users_need_partner;
alter table public.profiles drop constraint if exists profiles_partner_scope;

update public.profiles set role = 'super_admin'   where role = 'admin';
update public.profiles set role = 'partner_admin' where role = 'partner';

alter table public.profiles
  add constraint profiles_role_check check (role in ('super_admin', 'admin_staff', 'partner_admin', 'partner_staff')),
  add constraint profiles_partner_scope check (
    (role in ('super_admin', 'admin_staff') and partner_id is null)
    or (role in ('partner_admin', 'partner_staff') and partner_id is not null)
  );

alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active', 'suspended'));
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- =============================================================== helper functions
-- All helpers read the caller's own profile with SECURITY DEFINER (no RLS recursion)
-- and an empty search_path so they cannot be hijacked by objects in other schemas.

create or replace function public.jwt_is_aal2()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and status = 'active';
$$;

-- SSI GLOBAL staff with an MFA-verified session.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.jwt_is_aal2() and exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('super_admin', 'admin_staff'));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.jwt_is_aal2() and exists (
    select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'super_admin');
$$;

-- Kept for 0001 policies: "admin" now means MFA-verified, active staff.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff();
$$;

create or replace function public.my_partner_id()
returns text language sql stable security definer set search_path = '' as $$
  select partner_id from public.profiles
  where id = auth.uid() and status = 'active' and role in ('partner_admin', 'partner_staff');
$$;

create or replace function public.is_partner_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'partner_admin');
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

-- Requests from end users carry an "authenticated" JWT. Dashboard SQL, migrations and
-- the service role do not, and are trusted to bypass the guard triggers below.
create or replace function public.is_end_user_request()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'authenticated';
$$;

do $$
declare f text;
begin
  foreach f in array array['jwt_is_aal2()', 'my_role()', 'is_staff()', 'is_super_admin()', 'is_admin()',
                           'my_partner_id()', 'is_partner_admin()', 'is_active_user()', 'is_end_user_request()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =============================================================== least privilege
-- Anonymous visitors get nothing. Signed-in users are still limited by RLS below.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- =============================================================== profiles policies
drop policy if exists "profiles: read own or admin" on public.profiles;
drop policy if exists "profiles: admin writes" on public.profiles;

-- Own row is readable even before MFA so the app can route the user; staff read all.
create policy "profiles: read own or staff" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "profiles: super admin manages" on public.profiles
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Users may edit their own display name; the guard below blocks everything sensitive.
create policy "profiles: update own name" on public.profiles
  for update to authenticated using (id = auth.uid() and public.is_active_user()) with check (id = auth.uid());

-- No one can change their own role or status (prevents privilege escalation / self-unsuspend).
create or replace function public.guard_profile_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and new.id = auth.uid()
     and (new.role is distinct from old.role or new.status is distinct from old.status
          or new.partner_id is distinct from old.partner_id) then
    raise exception 'You cannot change your own role, organisation or status';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- =============================================================== partners
drop policy if exists "partners: admin writes" on public.partners;
create policy "partners: staff insert" on public.partners for insert to authenticated with check (public.is_staff());
create policy "partners: staff update" on public.partners for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "partners: super admin delete" on public.partners for delete to authenticated using (public.is_super_admin());

-- Partner admins may update their own organisation's contact details only.
create policy "partners: partner admin updates own contact" on public.partners for update to authenticated
  using (public.is_partner_admin() and id = public.my_partner_id())
  with check (public.is_partner_admin() and id = public.my_partner_id());

create or replace function public.guard_partner_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_staff()
     and (new.name, new.code, new.status, new.tier, new.branches, new.commission_rate, new.country, new.id)
         is distinct from (old.name, old.code, old.status, old.tier, old.branches, old.commission_rate, old.country, old.id) then
    raise exception 'Only SSI GLOBAL staff can change these partner details';
  end if;
  return new;
end $$;

drop trigger if exists partners_guard on public.partners;
create trigger partners_guard before update on public.partners
  for each row execute function public.guard_partner_changes();

-- =============================================================== catalogue
drop policy if exists "universities: read" on public.universities;
drop policy if exists "courses: read" on public.courses;
create policy "universities: read" on public.universities for select to authenticated using (public.is_active_user());
create policy "courses: read" on public.courses for select to authenticated using (public.is_active_user());

-- =============================================================== payments (finance)
-- Partner staff do not see finance; partner admins see only their own invoices.
drop policy if exists "payments: read own or admin" on public.payments;
create policy "payments: read" on public.payments for select to authenticated
  using (public.is_staff() or (public.is_partner_admin() and partner_id = public.my_partner_id()));

-- =============================================================== tenant derivation
-- students: partners always create records in their own organisation and cannot move them.
create or replace function public.set_student_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_staff() then
    if tg_op = 'INSERT' then
      new.partner_id := public.my_partner_id();
    elsif new.partner_id is distinct from old.partner_id then
      raise exception 'Students cannot be moved to another organisation';
    end if;
    if new.partner_id is null then raise exception 'Not permitted'; end if;
  end if;
  return new;
end $$;

drop trigger if exists students_tenant on public.students;
create trigger students_tenant before insert or update on public.students
  for each row execute function public.set_student_tenant();

-- Child records take partner_id from their student (never from the request), so a
-- partner can't attach records to another organisation's student: the derived
-- partner_id would fail the RLS check.
create or replace function public.set_child_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sp text;
begin
  select partner_id into sp from public.students where id = new.student_id;
  if sp is null then raise exception 'Unknown student'; end if;
  new.partner_id := sp;
  return new;
end $$;

drop trigger if exists applications_tenant on public.applications;
create trigger applications_tenant before insert or update on public.applications
  for each row execute function public.set_child_tenant();
drop trigger if exists documents_tenant on public.documents;
create trigger documents_tenant before insert or update on public.documents
  for each row execute function public.set_child_tenant();
drop trigger if exists assessments_tenant on public.assessments;
create trigger assessments_tenant before insert or update on public.assessments
  for each row execute function public.set_child_tenant();

-- =============================================================== applications
create sequence if not exists public.application_ref_seq start 24101;
alter table public.applications add column if not exists status_note text;
alter table public.applications add column if not exists updated_at timestamptz not null default now();

create or replace function public.actor_name()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), 'System');
$$;

-- Ref, applied date and timeline are server-managed; clients can only change status
-- (subject to the status guard) and pass a one-off note.
create or replace function public.manage_application()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.courses c where c.id = new.course_id and c.university_id = new.university_id) then
    raise exception 'Course does not belong to the selected university';
  end if;
  if tg_op = 'INSERT' then
    new.ref := 'SSI-' || nextval('public.application_ref_seq');
    new.applied_at := now();
    new.timeline := jsonb_build_array(jsonb_build_object(
      'status', new.status, 'at', now(), 'by', public.actor_name(), 'note', coalesce(new.status_note, 'Application created')));
  else
    new.ref := old.ref;
    new.applied_at := old.applied_at;
    new.timeline := old.timeline;
    if new.status is distinct from old.status then
      new.timeline := old.timeline || jsonb_build_array(jsonb_build_object(
        'status', new.status, 'at', now(), 'by', public.actor_name(), 'note', nullif(new.status_note, '')));
    end if;
  end if;
  new.status_note := null;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists applications_manage on public.applications;
create trigger applications_manage before insert or update on public.applications
  for each row execute function public.manage_application();

-- Re-define 0001 guards so trusted server contexts (no end-user JWT) can seed data.
create or replace function public.guard_application_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_staff()
     and new.status not in ('Draft', 'Pending Assessment')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'Only SSI GLOBAL staff can set status "%"', new.status;
  end if;
  return new;
end $$;

-- =============================================================== documents
alter table public.documents add column if not exists storage_path text;

create or replace function public.guard_document_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_staff() then
    if new.status <> 'Pending' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      raise exception 'Only SSI GLOBAL staff can verify documents';
    end if;
    if tg_op = 'UPDATE' and new.storage_path is distinct from old.storage_path then
      raise exception 'Document files cannot be replaced';
    end if;
  end if;
  -- The file must live in this record's partner/student folder (prevents pointing at another tenant's file).
  if new.storage_path is not null and (
       split_part(new.storage_path, '/', 1) <> new.partner_id
    or split_part(new.storage_path, '/', 2) <> new.student_id
    or new.storage_path like '%..%') then
    raise exception 'Invalid document path';
  end if;
  return new;
end $$;

-- =============================================================== assessments
create or replace function public.guard_assessment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_staff() then
    if tg_op = 'INSERT' then
      new.status := 'Pending';
      new.notes := '';
    elsif new.status is distinct from old.status or new.notes is distinct from old.notes then
      raise exception 'Only SSI GLOBAL staff can review assessments';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists assessments_guard on public.assessments;
create trigger assessments_guard before insert or update on public.assessments
  for each row execute function public.guard_assessment();

-- =============================================================== tasks (staff only)
create table if not exists public.tasks (
  id         text primary key default gen_random_uuid()::text,
  title      text not null check (char_length(title) between 1 and 300),
  due        timestamptz not null,
  priority   text not null default 'Normal' check (priority in ('High', 'Medium', 'Normal')),
  done       boolean not null default false,
  assignee   text,
  related    text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
drop policy if exists "tasks: staff" on public.tasks;
create policy "tasks: staff" on public.tasks for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- =============================================================== activity feed
-- Written only by triggers (no insert policy), so entries cannot be forged by clients.
create table if not exists public.activities (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  partner_id text references public.partners (id) on delete cascade,
  kind       text not null,
  title      text not null,
  detail     text,
  ref_id     text
);
create index if not exists activities_partner_idx on public.activities (partner_id, at desc);
alter table public.activities enable row level security;
drop policy if exists "activities: read" on public.activities;
create policy "activities: read" on public.activities for select to authenticated using (
  public.is_staff()
  or (partner_id is not null and partner_id = public.my_partner_id())
  or (kind = 'update' and exists (select 1 from public.announcements a where a.id = activities.ref_id))
);

create or replace function public.record_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  student_name text;
  uni_name text;
begin
  if tg_table_name = 'students' then
    insert into public.activities (partner_id, kind, title, detail, ref_id)
    values (new.partner_id, 'student', 'New student added', new.first_name || ' ' || new.last_name, new.id);
  elsif tg_table_name = 'applications' then
    select first_name || ' ' || last_name into student_name from public.students where id = new.student_id;
    select name into uni_name from public.universities where id = new.university_id;
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'application', 'New application created', student_name || ' · ' || coalesce(uni_name, ''), new.id);
    elsif new.status is distinct from old.status then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'status', 'Status changed to ' || new.status, student_name || ' · ' || coalesce(uni_name, ''), new.id);
    end if;
  elsif tg_table_name = 'documents' then
    if tg_op = 'INSERT' then
      select first_name || ' ' || last_name into student_name from public.students where id = new.student_id;
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'document', 'Document uploaded', new.type || ' · ' || coalesce(student_name, ''), new.id);
    end if;
  elsif tg_table_name = 'assessments' then
    select first_name || ' ' || last_name into student_name from public.students where id = new.student_id;
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'assessment', 'Assessment requested', student_name, new.id);
    elsif new.status is distinct from old.status then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.partner_id, 'assessment', 'Assessment marked ' || new.status, student_name, new.id);
    end if;
  elsif tg_table_name = 'payments' then
    if tg_op = 'UPDATE' then
      if new.paid is distinct from old.paid then
        insert into public.activities (partner_id, kind, title, detail, ref_id)
        values (new.partner_id, 'payment', 'Payment recorded', new.invoice_no, new.id);
      end if;
    end if;
  elsif tg_table_name = 'partners' then
    if tg_op = 'INSERT' then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (new.id, 'partner', 'New partner onboarded', new.name, new.id);
    end if;
  elsif tg_table_name = 'announcements' then
    if new.published and (tg_op = 'INSERT' or not old.published) then
      insert into public.activities (partner_id, kind, title, detail, ref_id)
      values (null, 'update', 'Announcement published', new.title, new.id);
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['students', 'applications', 'documents', 'assessments', 'payments', 'partners', 'announcements'] loop
    execute format('drop trigger if exists %1$s_activity on public.%1$I', t);
    execute format('create trigger %1$s_activity after insert or update on public.%1$I
                    for each row execute function public.record_activity()', t);
  end loop;
end $$;

-- =============================================================== audit log
-- Append-only. Stores who did what to which record, and which fields changed —
-- not the field values themselves (no personal data, passwords or tokens).
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor_role text,
  action     text not null,
  entity     text,
  entity_id  text,
  partner_id text,
  changes    jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from authenticated, anon;
grant select on public.audit_log to authenticated;
drop policy if exists "audit: super admin reads" on public.audit_log;
create policy "audit: super admin reads" on public.audit_log for select to authenticated using (public.is_super_admin());

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec jsonb := coalesce(n, o);
  changed jsonb := null;
begin
  if tg_op = 'UPDATE' then
    select jsonb_agg(key) into changed
    from jsonb_each(n) e(key, value)
    where e.value is distinct from o -> e.key and e.key not in ('timeline', 'status_note', 'updated_at');
    if changed is null then return new; end if;
    -- Status / role changes are operationally important and not personal data.
    changed := jsonb_build_object('fields', changed);
    if n ? 'status' and n -> 'status' is distinct from o -> 'status' then
      changed := changed || jsonb_build_object('status', jsonb_build_array(o -> 'status', n -> 'status'));
    end if;
    if n ? 'role' and n -> 'role' is distinct from o -> 'role' then
      changed := changed || jsonb_build_object('role', jsonb_build_array(o -> 'role', n -> 'role'));
    end if;
  end if;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id, changes)
  values (auth.uid(), public.my_role(), lower(tg_op), tg_table_name, rec ->> 'id',
          case when tg_table_name = 'partners' then rec ->> 'id' else rec ->> 'partner_id' end, changed);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'partners', 'students', 'applications', 'documents', 'assessments',
                           'payments', 'announcements', 'universities', 'courses', 'tasks'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Client-reported security events (sign-in, sign-out, MFA, downloads). The actor is
-- always the verified auth.uid(); clients can only choose from a fixed list of events.
-- Failed sign-ins and password resets are recorded by Supabase Auth's own audit log.
create or replace function public.log_event(event text, entity_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if event not in ('login', 'logout', 'idle_timeout', 'mfa_enrolled', 'mfa_verified', 'password_changed', 'document_download') then
    raise exception 'Unknown event';
  end if;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, partner_id)
  values (auth.uid(), public.my_role(), event, case when event = 'document_download' then 'documents' end,
          left(entity_id, 64), public.my_partner_id());
end $$;
revoke all on function public.log_event(text, text) from public, anon;
grant execute on function public.log_event(text, text) to authenticated;

-- Returns a document's storage path only if the caller may read the record
-- (SECURITY INVOKER: RLS on documents applies), and logs the access.
create or replace function public.authorize_document_download(doc_id text)
returns text language plpgsql security invoker set search_path = '' as $$
declare path text;
begin
  select storage_path into path from public.documents where id = doc_id;
  if path is null then raise exception 'Document not found'; end if;
  perform public.log_event('document_download', doc_id);
  return path;
end $$;
revoke all on function public.authorize_document_download(text) from public, anon;
grant execute on function public.authorize_document_download(text) to authenticated;

-- Retention: removes audit entries older than the given age. Schedule with pg_cron, e.g.
--   select cron.schedule('audit-retention', '0 3 * * 0', $$select public.purge_audit_log('3 years')$$);
create or replace function public.purge_audit_log(older_than interval default interval '3 years')
returns bigint language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  if public.is_end_user_request() and not public.is_super_admin() then raise exception 'Not permitted'; end if;
  delete from public.audit_log where at < now() - older_than;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_audit_log(interval) from public, anon, authenticated;

-- =============================================================== private document storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-documents', 'student-documents', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Object names are "<partner_id>/<student_id>/<uuid>.<ext>".
drop policy if exists "student docs: read" on storage.objects;
drop policy if exists "student docs: upload" on storage.objects;
drop policy if exists "student docs: delete" on storage.objects;

create policy "student docs: read" on storage.objects for select to authenticated using (
  bucket_id = 'student-documents'
  and (public.is_staff() or (storage.foldername(name))[1] = public.my_partner_id())
);
create policy "student docs: upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'student-documents'
  and position('..' in name) = 0
  and exists (
    select 1 from public.students s
    where s.id = (storage.foldername(name))[2]
      and s.partner_id = (storage.foldername(name))[1]
      and (public.is_staff() or s.partner_id = public.my_partner_id()))
);
create policy "student docs: delete" on storage.objects for delete to authenticated using (
  bucket_id = 'student-documents'
  and (public.is_staff() or (storage.foldername(name))[1] = public.my_partner_id())
);
-- No update policy: stored files are immutable.
