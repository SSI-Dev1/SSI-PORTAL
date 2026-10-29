-- Application creation: duplicate protection, idempotent retries, multiple legitimate applications.
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
    if pattern <> '' and sqlerrm not like pattern then
      raise exception 'FAIL: % — wrong error: %', msg, sqlerrm using errcode = 'TF001';
    end if;
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''

\echo '== duplicates and legitimate multiple applications'
-- fixture a1: student s1, university u1, course c1, intake 'Jul 2026', status Submitted
begin; select pg_temp.act_as(:p1admin);
select pg_temp.denied($$insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('dup1', 's1', 'u1', 'c1', 'Jul 2026', 'Draft')$$,
  'exact duplicate of an open application is rejected', 'DUPLICATE_APPLICATION:a1:%');
select pg_temp.denied($$insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('dup2', 's1', 'u1', 'c1', '  jul 2026 ', 'Draft')$$,
  'duplicate check ignores case and spaces in the intake', 'DUPLICATE_APPLICATION:%');
insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('new1', 's1', 'u1', 'c1', 'Jan 2027', 'Draft');
select pg_temp.check(exists (select 1 from public.applications where id = 'new1'), 'same course, different intake is allowed');
insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('new2', 's1', 'u2', 'c2', 'Sep 2026', 'Pending Assessment');
select pg_temp.check(exists (select 1 from public.applications where id = 'new2'), 'another university is allowed');
select pg_temp.denied($$insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('new1', 's1', 'u2', 'c2', 'Jan 2028', 'Draft')$$,
  'retrying with the same id cannot create a second application', '%duplicate key%');
select pg_temp.denied($$update public.applications set intake = 'Jul 2026' where id = 'new1'$$,
  'editing an application into a duplicate is rejected', 'DUPLICATE_APPLICATION:%');
rollback;

begin;
update public.applications set status = 'Visa Refused' where id = 'a1';
select pg_temp.act_as(:p1admin);
insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('re1', 's1', 'u1', 'c1', 'Jul 2026', 'Draft');
select pg_temp.check(exists (select 1 from public.applications where id = 're1'), 'reapplying after a refusal is allowed');
rollback;

begin; select pg_temp.act_as(:p1admin);
insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('ok1', 's1', 'u1', 'c1', 'Jan 2027', 'Draft');
select pg_temp.check(exists (select 1 from public.activities where ref_id = 'ok1' and title = 'New application created'), 'new application appears in activity');
rollback;

\echo 'ALL SECURITY TESTS PASSED'
