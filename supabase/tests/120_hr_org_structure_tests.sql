-- Departments and designations managed from the HR Portal (0025).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = notice;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg using errcode = 'TF001'; end if;
  raise notice 'pass: %', msg;
end $$;
create or replace function pg_temp.denied(stmt text, msg text, pattern text default '') returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if pattern <> '' and sqlerrm not like pattern then raise exception 'FAIL: % — wrong error: %', msg, sqlerrm using errcode = 'TF001'; end if;
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Fixtures from 70_hr_tests.sql: Hana HR (hr + hr_accounts), Manu Manager, Priya Partnerships (employee).
\set super '''00000000-0000-0000-0000-0000000000a1'''
\set hr    '''00000000-0000-0000-0000-0000000000f1'''
\set mgr   '''00000000-0000-0000-0000-0000000000f2'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''

\echo '== departments'
begin; select pg_temp.act_as(:hr);
insert into public.departments (id, name, description, manager_id) values ('admissions', '  Admissions  ', 'UK admissions desk', :mgr);
select pg_temp.check((select name = 'Admissions' and manager_id = :mgr from public.departments where id = 'admissions'), 'HR adds a department with a manager (name trimmed)');
update public.departments set description = 'Updated', manager_id = null where id = 'admissions';
select pg_temp.check((select description = 'Updated' and manager_id is null from public.departments where id = 'admissions'), 'HR edits a department');
select pg_temp.denied($$insert into public.departments (id, name) values ('x', 'X')$$, 'department name needs 2+ characters', '%departments_name_len%');
delete from public.departments where id = 'admissions';
select pg_temp.check(exists (select 1 from public.departments where id = 'admissions'), 'HR cannot delete a department (deactivate instead)');
rollback;

begin; select pg_temp.trusted();
update public.employees set employment_status = 'Resigned' where id = :mgr;
select pg_temp.act_as(:hr);
select pg_temp.denied(format($$update public.departments set manager_id = %L where id = 'recruitment'$$, :mgr), 'a resigned employee cannot manage a department', '%current employee%');
rollback;

begin; select pg_temp.act_as(:po);
select pg_temp.denied($$insert into public.departments (id, name) values ('rogue', 'Rogue')$$, 'an employee cannot add departments', '%row-level security%');
rollback;

begin; select pg_temp.act_as(:super);
insert into public.departments (id, name) values ('temp_dept', 'Temporary');
delete from public.departments where id = 'temp_dept';
select pg_temp.check(not exists (select 1 from public.departments where id = 'temp_dept'), 'Super Admin can delete an unused department');
rollback;

\echo '== designations'
begin; select pg_temp.act_as(:hr);
insert into public.designations (id, name, department_id, description, default_role, default_permissions, workspace)
  values ('admissions_officer', 'Admissions Officer', 'applications', 'Handles offers', 'super_admin', '{finance,hr}', 'hr');
select pg_temp.check((select default_role = 'support_staff' and default_permissions = '{tasks}' and workspace = 'employee' and report_template is null
  from public.designations where id = 'admissions_officer'), 'HR creates a designation; access fields fall back to the safe defaults');
update public.designations set name = 'Senior Admissions Officer', description = 'Leads offers', department_id = 'recruitment', active = false where id = 'admissions_officer';
select pg_temp.check((select name = 'Senior Admissions Officer' and department_id = 'recruitment' and not active from public.designations where id = 'admissions_officer'),
  'HR edits name, description, department and status');
select pg_temp.denied($$update public.designations set default_permissions = '{finance}' where id = 'partnership_officer'$$, 'HR cannot change what a designation grants', '%Only a Super Admin%');
select pg_temp.denied($$update public.designations set default_role = 'admin_staff' where id = 'partnership_officer'$$, 'HR cannot change a designation role', '%Only a Super Admin%');
select pg_temp.denied($$update public.designations set workspace = 'hr' where id = 'partnership_officer'$$, 'HR cannot change a designation workspace', '%Only a Super Admin%');
select pg_temp.denied($$update public.designations set report_template = null where id = 'partnership_officer'$$, 'HR cannot change a designation report template', '%Only a Super Admin%');
select pg_temp.denied($$insert into public.designations (id, name) values ('Bad Id!', 'Bad')$$, 'designation ID format is checked', '%lowercase%');
delete from public.designations where id = 'admissions_officer';
select pg_temp.check(exists (select 1 from public.designations where id = 'admissions_officer'), 'HR cannot delete a designation');
rollback;

begin; select pg_temp.act_as(:po);
select pg_temp.denied($$insert into public.designations (id, name) values ('rogue_title', 'Rogue')$$, 'an employee cannot add designations', '%row-level security%');
update public.designations set name = 'Hacked' where id = 'partnership_officer';
select pg_temp.check((select name = 'Partnership Officer' from public.designations where id = 'partnership_officer'), 'an employee cannot rename designations');
rollback;

begin; select pg_temp.act_as(:super);
update public.designations set default_permissions = '{partners,catalogue,tasks,reports}' where id = 'partnership_officer';
select pg_temp.check((select 'reports' = any (default_permissions) from public.designations where id = 'partnership_officer'), 'Super Admin can change designation access');
rollback;

\echo '== changing an employee designation keeps history'
begin; select pg_temp.act_as(:hr);
update public.employees set designation_id = 'partner_success_officer' where id = :po;
select pg_temp.check((select designation_id = 'partner_success_officer' from public.employees where id = :po), 'HR moves the officer to a new designation');
select pg_temp.check((select count(*) from public.designation_history where employee_id = :po) >= 1, 'designation history recorded');
select pg_temp.check(exists (select 1 from public.designations where id = 'partnership_officer'), 'the old designation still exists for past reports');
rollback;

\echo '== existing SSI GLOBAL designations kept'
select pg_temp.check((select count(*) from public.designations where id in
  ('partnership_officer', 'partner_success_officer', 'senior_international_recruitment_manager', 'application_team')) = 4, 'core designations present');
