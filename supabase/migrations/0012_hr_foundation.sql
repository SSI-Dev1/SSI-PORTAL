-- 0012_hr_foundation.sql — run after 0011_import_course_finder_uea.sql
-- (Supabase SQL Editor: Save this query as "0012_hr_foundation")
--
-- Employee records for internal SSI GLOBAL staff, on top of the existing accounts (profiles):
-- * departments, designations (each designation can carry a daily report template and a
--   workspace), shifts, employees (employee ID, designation(s), department, reporting manager,
--   joining date, employment status, shift, date of birth for reminders), designation history.
-- * Salaries live in their own table, readable only by Super Admins and staff with the
--   "hr_salary" permission.
-- * New permissions: work_reports (all daily reports), hr (HR portal), hr_accounts (manage
--   employee accounts, never Super Admin / Admin accounts and never HR permissions),
--   hr_salary (salaries). Only a Super Admin grants hr / hr_accounts / hr_salary.
--   Admin Staff keep their business modules and get work_reports by default; HR access is
--   never a default of any role.
-- * Managers see the employees who report to them (directly or through their reports) —
--   never the whole company because of a job title.
-- * company_settings holds HR policies that were not specified as fixed rules.
-- Safe to run more than once.

-- =============================================================== permissions
create or replace function public.staff_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
               'catalogue', 'tasks', 'updates', 'reports', 'work_reports', 'hr', 'hr_accounts', 'hr_salary'];
$$;

-- HR-level permissions only a Super Admin can grant.
create or replace function public.hr_modules()
returns text[] language sql immutable set search_path = '' as $$
  select array['hr', 'hr_accounts', 'hr_salary'];
$$;

create or replace function public.role_default_permissions(r text)
returns text[] language sql immutable set search_path = '' as $$
  select case r
    when 'super_admin'         then public.staff_modules()
    when 'admin_staff'         then array['partners', 'students', 'applications', 'assessments', 'documents', 'finance',
                                          'catalogue', 'tasks', 'updates', 'reports', 'work_reports']
    when 'application_manager' then array['partners', 'students', 'applications', 'documents', 'catalogue', 'tasks', 'reports']
    when 'assessment_staff'    then array['partners', 'students', 'assessments', 'documents', 'catalogue', 'tasks']
    when 'finance_staff'       then array['partners', 'finance', 'reports', 'tasks']
    when 'support_staff'       then array['partners', 'students', 'updates', 'tasks']
    else array[]::text[]
  end;
$$;

-- Only a Super Admin may add or remove HR permissions (hr, hr_accounts, hr_salary) on any account.
create or replace function public.hr_part(p text[])
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array(select x from unnest(p) x where x = any (public.hr_modules()) order by 1), '{}');
$$;

create or replace function public.guard_profile_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_end_user_request() and not public.is_super_admin()
     and public.hr_part(coalesce(new.permissions, public.role_default_permissions(new.role)))
         is distinct from public.hr_part(coalesce(old.permissions, public.role_default_permissions(old.role))) then
    raise exception 'Only a Super Admin can grant or remove HR permissions';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_permissions on public.profiles;
create trigger profiles_guard_permissions before update on public.profiles
  for each row execute function public.guard_profile_permissions();

-- =============================================================== settings
create table if not exists public.company_settings (
  key        text primary key,
  value      jsonb not null,
  label      text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.company_settings (key, value, label) values
  ('timezone', '"Asia/Kolkata"', 'Company timezone used for attendance dates'),
  ('location_policy', '"optional"', 'Punch location: optional | required | approval (allowed without location, HR verifies)'),
  ('location_retention_days', '180', 'Days attendance locations are kept before they can be purged'),
  ('leave_year_start_month', '1', 'First month of the leave year (1 = January)'),
  ('leave_approval', '"manager_or_hr"', 'Leave approval: manager_or_hr | manager_then_hr'),
  ('leave_counts_non_working_days', 'false', 'Count holidays and non-working days inside a leave as leave days'),
  ('early_checkout_monthly_limit', '2', 'Approved early checkouts allowed per employee per month'),
  ('saturday_offs_per_month', '1', 'Saturdays off per month (dates chosen by HR in the work calendar)')
on conflict (key) do nothing;

create or replace function public.setting(k text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.company_settings where key = k;
$$;
create or replace function public.company_tz()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(public.setting('timezone') #>> '{}', 'Asia/Kolkata');
$$;
create or replace function public.company_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone public.company_tz())::date;
$$;

-- =============================================================== org structure
create table if not exists public.departments (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists departments_name_key on public.departments (lower(btrim(name)));

create table if not exists public.designations (
  id                  text primary key,            -- slug, e.g. partnership_officer
  name                text not null,
  department_id       text references public.departments (id) on delete set null,
  report_template     text,                        -- daily report template id (0013), null = no daily report
  workspace           text not null default 'employee',
  default_role        text not null default 'support_staff',
  default_permissions text[],
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.shifts (
  id               text primary key default gen_random_uuid()::text,
  name             text not null,
  flexible         boolean not null default false,
  start_time       time,                 -- null for flexible shifts without a start policy
  end_time         time,
  grace_minutes    integer not null default 0 check (grace_minutes between 0 and 240),
  required_minutes integer not null default 480 check (required_minutes between 0 and 1440),
  working_days     integer[] not null default '{1,2,3,4,5,6}',   -- ISO day of week, 1 = Monday
  unpaid_breaks    boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint shifts_days check (working_days <@ '{1,2,3,4,5,6,7}'),
  constraint shifts_window check (flexible or (start_time is not null and end_time is not null))
);

insert into public.departments (id, name) values
  ('partnerships', 'Partnerships'), ('recruitment', 'International Recruitment'),
  ('applications', 'Applications'), ('hr', 'Human Resources'), ('management', 'Management')
on conflict (id) do nothing;

insert into public.shifts (id, name, flexible, start_time, end_time, grace_minutes, required_minutes) values
  ('standard', 'Standard (Mon–Sat, 8 hours)', false, '09:30', '18:30', 15, 480),
  ('flexible', 'Flexible (8 hours, no fixed start)', true, null, null, 0, 480)
on conflict (id) do nothing;

insert into public.designations (id, name, department_id, report_template, workspace, default_role, default_permissions) values
  ('partnership_officer', 'Partnership Officer', 'partnerships', 'partnership_officer', 'partnership_officer', 'support_staff', '{partners,catalogue,tasks}'),
  ('partner_success_officer', 'Partner Success Officer', 'partnerships', 'partner_success_officer', 'partner_success_officer', 'support_staff', '{partners,students,applications,catalogue,tasks}'),
  ('senior_international_recruitment_manager', 'Senior International Recruitment Manager', 'recruitment', 'senior_recruitment_manager', 'senior_recruitment_manager', 'application_manager', '{partners,students,applications,catalogue,tasks,reports}'),
  ('application_team', 'Application Team', 'applications', 'application_team', 'application_team', 'application_manager', '{students,applications,documents,catalogue,tasks}'),
  ('hr_manager', 'HR Manager', 'hr', null, 'hr', 'support_staff', '{tasks}'),
  ('hr_staff', 'HR Staff', 'hr', null, 'hr', 'support_staff', '{tasks}')
on conflict (id) do nothing;

-- =============================================================== employees
create table if not exists public.employees (
  id                      uuid primary key references public.profiles (id) on delete cascade,
  employee_code           text not null,
  designation_id          text not null references public.designations (id),
  additional_designations text[] not null default '{}',
  department_id           text references public.departments (id) on delete set null,
  reporting_manager_id    uuid references public.employees (id) on delete set null,
  joining_date            date,
  employment_status       text not null default 'Active' check (employment_status in ('Active', 'Probation', 'Resigned')),
  probation_end_date      date,
  date_of_birth           date,
  shift_id                text references public.shifts (id) on delete set null default 'standard',
  work_location           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  constraint employees_not_own_manager check (reporting_manager_id is distinct from id)
);
create unique index if not exists employees_code_key on public.employees (lower(btrim(employee_code)));
create index if not exists employees_manager_idx on public.employees (reporting_manager_id);

create table if not exists public.employee_salaries (
  id             text primary key default gen_random_uuid()::text,
  employee_id    uuid not null unique references public.employees (id) on delete cascade,
  amount         numeric not null check (amount >= 0),
  currency       text not null default 'INR',
  pay_frequency  text not null default 'Monthly' check (pay_frequency in ('Monthly', 'Annual')),
  effective_from date,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

create table if not exists public.designation_history (
  id             bigint generated always as identity primary key,
  employee_id    uuid not null references public.employees (id) on delete cascade,
  designation_id text not null,
  additional     text[] not null default '{}',
  changed_at     timestamptz not null default now(),
  changed_by     uuid
);

-- =============================================================== helpers
create or replace function public.my_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.id = auth.uid() and public.is_staff();
$$;

create or replace function public.is_hr()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.staff_can('hr');
$$;

-- Everyone below p_manager in the reporting line.
create or replace function public.team_of(p_manager uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with recursive t(id, depth) as (
    select e.id, 1 from public.employees e where e.reporting_manager_id = p_manager
    union
    select e.id, t.depth + 1 from public.employees e join t on e.reporting_manager_id = t.id where t.depth < 20
  )
  select distinct id from t;
$$;

create or replace function public.in_my_team(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and p_emp in (select public.team_of(auth.uid()));
$$;

-- May the caller see this employee's work records (reports, attendance, leave)?
create or replace function public.can_view_employee(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and (p_emp = auth.uid() or public.is_super_admin() or public.is_hr() or public.in_my_team(p_emp));
$$;

-- May the caller approve this employee's requests? (never their own)
create or replace function public.can_approve_for(p_emp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff() and p_emp <> auth.uid() and (public.is_super_admin() or public.is_hr() or public.in_my_team(p_emp));
$$;

create or replace function public.can_manage_employees()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or public.staff_can('hr_accounts');
$$;

-- Reject reporting-line loops.
create or replace function public.guard_employee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if new.reporting_manager_id is not null and new.reporting_manager_id in (select public.team_of(new.id)) then
    raise exception 'A reporting manager cannot report to this employee';
  end if;
  if not (new.additional_designations <@ array(select id from public.designations)) then
    raise exception 'Unknown designation';
  end if;
  new.additional_designations := array(select distinct x from unnest(new.additional_designations) x where x <> new.designation_id);
  select role into r from public.profiles where id = new.id;
  if r is null or not (r = any (public.staff_roles())) then
    raise exception 'Employee records are only for internal staff accounts';
  end if;
  -- HR account managers cannot edit Super Admin / Admin Staff records or their own.
  if public.is_end_user_request() and not public.is_super_admin() then
    if r in ('super_admin', 'admin_staff') then raise exception 'Only a Super Admin can change this employee'; end if;
    if new.id = auth.uid() and tg_op = 'UPDATE'
       and (new.designation_id, new.additional_designations, new.reporting_manager_id, new.employment_status)
           is distinct from (old.designation_id, old.additional_designations, old.reporting_manager_id, old.employment_status) then
      raise exception 'You cannot change your own designation, manager or status';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists employees_guard on public.employees;
create trigger employees_guard before insert or update on public.employees
  for each row execute function public.guard_employee();

create or replace function public.track_designation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.designation_id, new.additional_designations) is distinct from (old.designation_id, old.additional_designations) then
    insert into public.designation_history (employee_id, designation_id, additional, changed_by)
    values (new.id, new.designation_id, new.additional_designations, auth.uid());
    update public.profiles set designation = (select name from public.designations where id = new.designation_id),
      department = coalesce((select name from public.departments where id = new.department_id), department)
    where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists employees_designation on public.employees;
create trigger employees_designation after insert or update on public.employees
  for each row execute function public.track_designation();

create or replace function public.guard_salary()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists employee_salaries_guard on public.employee_salaries;
create trigger employee_salaries_guard before insert or update on public.employee_salaries
  for each row execute function public.guard_salary();

-- =============================================================== RLS
alter table public.company_settings enable row level security;
alter table public.departments enable row level security;
alter table public.designations enable row level security;
alter table public.shifts enable row level security;
alter table public.employees enable row level security;
alter table public.employee_salaries enable row level security;
alter table public.designation_history enable row level security;
revoke all on public.company_settings, public.departments, public.designations, public.shifts, public.employees,
  public.employee_salaries, public.designation_history from anon;
grant select on public.company_settings, public.departments, public.designations, public.shifts, public.designation_history to authenticated;
grant select, insert, update on public.employees, public.employee_salaries to authenticated;
grant insert, update, delete on public.departments, public.designations, public.shifts to authenticated;
grant update on public.company_settings to authenticated;

do $$
declare t text;
begin
  foreach t in array array['company_settings', 'departments', 'designations', 'shifts', 'employees', 'employee_salaries', 'designation_history'] loop
    execute coalesce((select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
             from pg_policy where polrelid = format('public.%I', t)::regclass), 'select 1');
  end loop;
end $$;

create policy "settings: staff read" on public.company_settings for select to authenticated using (public.is_staff());
create policy "settings: hr update" on public.company_settings for update to authenticated
  using (public.is_super_admin() or public.is_hr()) with check (public.is_super_admin() or public.is_hr());

create policy "departments: staff read" on public.departments for select to authenticated using (public.is_staff());
create policy "departments: manage" on public.departments for all to authenticated
  using (public.can_manage_employees()) with check (public.can_manage_employees());
create policy "designations: staff read" on public.designations for select to authenticated using (public.is_staff());
create policy "designations: super admin" on public.designations for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy "shifts: staff read" on public.shifts for select to authenticated using (public.is_staff());
create policy "shifts: hr manage" on public.shifts for all to authenticated
  using (public.is_super_admin() or public.is_hr()) with check (public.is_super_admin() or public.is_hr());

create policy "employees: read" on public.employees for select to authenticated using (public.can_view_employee(id));
create policy "employees: manage insert" on public.employees for insert to authenticated with check (public.can_manage_employees());
create policy "employees: manage update" on public.employees for update to authenticated
  using (public.can_manage_employees() or public.is_hr()) with check (public.can_manage_employees() or public.is_hr());

create policy "salaries: authorised" on public.employee_salaries for select to authenticated
  using (public.is_super_admin() or public.staff_can('hr_salary'));
create policy "salaries: authorised insert" on public.employee_salaries for insert to authenticated
  with check (public.is_super_admin() or public.staff_can('hr_salary'));
create policy "salaries: authorised update" on public.employee_salaries for update to authenticated
  using (public.is_super_admin() or public.staff_can('hr_salary')) with check (public.is_super_admin() or public.staff_can('hr_salary'));

create policy "designation history: read" on public.designation_history for select to authenticated using (public.can_view_employee(employee_id));

-- =============================================================== audit, touch, realtime
do $$
declare t text;
begin
  foreach t in array array['departments', 'designations', 'shifts', 'employees', 'employee_salaries', 'company_settings'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    if t <> 'company_settings' then
      execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
                      for each row execute function public.audit_row()', t);
    end if;
  end loop;
  foreach t in array array['departments', 'designations', 'shifts'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

create or replace function public.touch_setting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, changes)
  values (auth.uid(), public.my_role(), 'update', 'company_settings', new.key, jsonb_build_object('from', old.value, 'to', new.value));
  return new;
end $$;
drop trigger if exists company_settings_touch on public.company_settings;
create trigger company_settings_touch before update on public.company_settings
  for each row execute function public.touch_setting();

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['company_settings', 'departments', 'designations', 'shifts', 'employees', 'employee_salaries'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =============================================================== my_access
-- Adds the employee record so the app can show the right workspaces after sign-in.
drop function if exists public.my_access();
create function public.my_access()
returns table (role text, status text, permissions text[], partner_id text, partner_name text,
               partner_modules text[], portal_open boolean, must_change_password boolean, department text,
               employee boolean, designations text[], has_team boolean)
language sql stable security definer set search_path = '' as $$
  select p.role, p.status, public.my_permissions(), p.partner_id, o.name,
         case when public.my_partner_id() is not null then o.modules else array[]::text[] end,
         public.my_partner_id() is not null, p.must_change_password, p.department,
         e.id is not null and public.is_staff(),
         case when e.id is not null and public.is_staff() then array[e.designation_id] || e.additional_designations else array[]::text[] end,
         public.is_staff() and exists (select 1 from public.employees r where r.reporting_manager_id = p.id)
  from public.profiles p
  left join public.partners o on o.id = p.partner_id
  left join public.employees e on e.id = p.id
  where p.id = auth.uid();
$$;

-- Names for pickers (no personal data): employees the caller may see, plus every active
-- employee's name/designation for staff with HR or account rights (manager pickers).
create or replace function public.employee_directory()
returns table (id uuid, full_name text, employee_code text, designation_id text, department_id text,
               reporting_manager_id uuid, employment_status text, account_status text, role text)
language sql stable security definer set search_path = '' as $$
  select e.id, p.full_name, e.employee_code, e.designation_id, e.department_id, e.reporting_manager_id,
         e.employment_status, p.status, p.role
  from public.employees e join public.profiles p on p.id = e.id
  where public.is_staff() and (public.can_view_employee(e.id) or public.can_manage_employees() or public.staff_can('work_reports'))
  order by p.full_name;
$$;

do $$
declare f text;
begin
  foreach f in array array['setting(text)', 'company_tz()', 'company_today()', 'my_employee_id()', 'is_hr()', 'team_of(uuid)',
                           'in_my_team(uuid)', 'can_view_employee(uuid)', 'can_approve_for(uuid)', 'can_manage_employees()',
                           'my_access()', 'employee_directory()', 'hr_modules()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
