-- 0025_hr_org_structure.sql — run after 0024_account_credentials.sql
-- (Supabase SQL Editor: Save this query as "0025_hr_org_structure")
--
-- Departments and designations managed from the HR Portal:
-- * departments get a description and a department manager (an employee).
-- * HR staff with "hr_accounts" may now create and edit designations (name, description,
--   department, active). What a designation grants — default role, default permissions,
--   workspace and daily report template — stays a Super Admin decision, so HR cannot use a
--   designation to give new accounts more access than they could give directly.
-- * Designations and departments are never deleted while employees or history use them; they are
--   deactivated instead. Changing an employee's designation keeps earlier daily reports and the
--   designation history untouched (reports store their own template and version).
-- Safe to run more than once.

alter table public.departments add column if not exists description text;
alter table public.departments add column if not exists manager_id uuid references public.employees (id) on delete set null;
alter table public.designations add column if not exists description text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departments_name_len') then
    alter table public.departments add constraint departments_name_len check (char_length(btrim(name)) between 2 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'departments_description_len') then
    alter table public.departments add constraint departments_description_len check (description is null or char_length(description) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'designations_name_len') then
    alter table public.designations add constraint designations_name_len check (char_length(btrim(name)) between 2 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'designations_description_len') then
    alter table public.designations add constraint designations_description_len check (description is null or char_length(description) <= 500);
  end if;
end $$;

-- What a designation grants is a Super Admin decision; HR may only describe and organise it.
create or replace function public.guard_designation_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_end_user_request() or public.is_super_admin() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.id !~ '^[a-z][a-z0-9_]{1,59}$' then
      raise exception 'Designation ID must be lowercase letters, numbers and underscores';
    end if;
    if new.default_role <> 'support_staff' or new.workspace <> 'employee' or new.report_template is not null
       or coalesce(new.default_permissions, '{}') <> '{tasks}' then
      new.default_role := 'support_staff';
      new.workspace := 'employee';
      new.report_template := null;
      new.default_permissions := '{tasks}';
    end if;
  elsif new.id is distinct from old.id or new.default_role is distinct from old.default_role
     or new.default_permissions is distinct from old.default_permissions or new.workspace is distinct from old.workspace
     or new.report_template is distinct from old.report_template then
    raise exception 'Only a Super Admin can change the access, workspace or report template of a designation';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists designations_guard on public.designations;
create trigger designations_guard before insert or update on public.designations
  for each row execute function public.guard_designation_changes();

-- A department manager must be a current employee.
create or replace function public.guard_department()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_id is not null and not exists (
    select 1 from public.employees e join public.profiles p on p.id = e.id
    where e.id = new.manager_id and e.employment_status <> 'Resigned' and p.status = 'active') then
    raise exception 'The department manager must be a current employee';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
drop trigger if exists departments_guard on public.departments;
create trigger departments_guard before insert or update on public.departments
  for each row execute function public.guard_department();

-- HR with "hr_accounts" (and Super Admins) create and edit designations; only Super Admins delete.
drop policy if exists "designations: super admin" on public.designations;
drop policy if exists "designations: manage insert" on public.designations;
drop policy if exists "designations: manage update" on public.designations;
drop policy if exists "designations: super admin delete" on public.designations;
create policy "designations: manage insert" on public.designations for insert to authenticated
  with check (public.can_manage_employees());
create policy "designations: manage update" on public.designations for update to authenticated
  using (public.can_manage_employees()) with check (public.can_manage_employees());
create policy "designations: super admin delete" on public.designations for delete to authenticated
  using (public.is_super_admin());

-- Departments: keep "manage" for insert/update; deleting is for Super Admins (deactivate instead).
drop policy if exists "departments: manage" on public.departments;
drop policy if exists "departments: manage insert" on public.departments;
drop policy if exists "departments: manage update" on public.departments;
drop policy if exists "departments: super admin delete" on public.departments;
create policy "departments: manage insert" on public.departments for insert to authenticated
  with check (public.can_manage_employees());
create policy "departments: manage update" on public.departments for update to authenticated
  using (public.can_manage_employees()) with check (public.can_manage_employees());
create policy "departments: super admin delete" on public.departments for delete to authenticated
  using (public.is_super_admin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'departments') then
      alter publication supabase_realtime add table public.departments;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'designations') then
      alter publication supabase_realtime add table public.designations;
    end if;
  end if;
end $$;
