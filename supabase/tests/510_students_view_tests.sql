-- Students for Senior IRM, Partnerships, Partner Success and Applications (0066): read-only students_view.
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
create or replace function pg_temp.affected(stmt text) returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set pso   '''00000000-0000-0000-0000-0000000000f5'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''
\set ofc   '''d0000000-0000-4000-8000-0000000005a1'''
\set none  '''d0000000-0000-4000-8000-0000000005a2'''
\set partner '''d0000000-0000-4000-8000-0000000003e1'''

\echo '== fixtures: a Partnership Officer (agencies only) and an employee without student access'
insert into auth.users (id, email) values (:ofc, 'ofc@ssi.test'), (:none, 'none@ssi.test');
insert into public.profiles (id, role, full_name, status, permissions) values
  (:ofc, 'admin_staff', 'Pat Partnerships', 'active', '{agency_outreach,tasks,work_reports}'),
  (:none, 'support_staff', 'Nora NoStudents', 'active', '{tasks,updates}');
insert into public.employees (id, employee_code, designation_id, department_id, joining_date, employment_status, shift_id) values
  (:ofc, 'SSI-T51', 'partnership_officer', 'partnerships', '2025-01-01', 'Active', 'standard'),
  (:none, 'SSI-T52', 'hr_manager', 'hr', '2025-01-01', 'Active', 'standard');

\echo '== permission catalogue and designation'
select pg_temp.check('students_view' = any (public.staff_modules()), 'students_view is a valid permission (no Unknown permission)');
select pg_temp.check((select 'students_view' = any (default_permissions) from public.designations where id = 'partnership_officer'), 'new Partnership Officers get it by designation');
-- the statement 0066 runs for existing accounts
update public.profiles p set permissions = array_append(p.permissions, 'students_view') from public.employees e
where e.id = p.id and e.designation_id = 'partnership_officer' and p.permissions is not null and not ('students_view' = any (p.permissions)) and not ('students' = any (p.permissions));
select pg_temp.check((select 'students_view' = any (permissions) and not ('students' = any (permissions)) from public.profiles where id = :ofc), 'existing Partnership Officer: view only, not edit');

\echo '== Partnerships: read students and their applications, nothing more'
begin; select pg_temp.act_as(:ofc);
select pg_temp.check((select count(*) from public.students) > 0, 'reads students');
select pg_temp.check((select count(*) from public.applications) > 0, 'reads applications (status, university, course, intake)');
select pg_temp.check(pg_temp.affected($q$update public.students set first_name = first_name$q$) = 0, 'cannot edit students');
select pg_temp.check(pg_temp.affected($q$update public.applications set intake = intake$q$) = 0, 'cannot change applications');
select pg_temp.denied($$insert into public.students (id, partner_id, first_name, last_name, email) select 'sv-x', partner_id, 'X', 'Y', 'x@y.test' from public.students limit 1$$, 'cannot add students', '%');
select pg_temp.check((select count(*) from public.documents) = 0, 'no student documents (needs Documents)');
select pg_temp.check(pg_temp.affected($q$delete from public.students$q$) = 0, 'cannot delete');
select pg_temp.check((select public.student_officers((select id from public.students limit 1)) ? 'main_officer'), 'sees agency and officers of a student');
rollback;

\echo '== the other three departments keep their access'
begin; select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.students) > 0 and (select count(*) from public.applications) > 0, 'Partner Success reads students and applications');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.students) > 0 and (select count(*) from public.applications) > 0, 'Applications reads students and applications');
rollback;

\echo '== unauthorised'
begin; select pg_temp.act_as(:none);
select pg_temp.check((select count(*) from public.students) = 0 and (select count(*) from public.applications) = 0, 'employee without student access sees nothing');
select pg_temp.check(public.student_officers((select id from public.students limit 1)) is null, 'and no officers');
rollback;
begin; select pg_temp.act_as(:partner);
select pg_temp.check((select bool_and(partner_id = 'ps-st') from public.students), 'partner login: only its own students');
rollback;
