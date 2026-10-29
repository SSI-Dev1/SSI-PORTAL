-- Course catalogue: initial import (0008), idempotency, intakes, permissions, conflict policy.
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
create or replace function pg_temp.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
create or replace function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set staff   '''00000000-0000-0000-0000-0000000000a2'''
\set fin     '''00000000-0000-0000-0000-0000000000e1'''

\echo '== initial import (0008 already applied by run.sh)'
select pg_temp.check((select count(*) from public.universities where source like 'Oxford Direct%') = 3, '3 universities imported');
select pg_temp.check((select count(*) from public.courses where source like 'Oxford Direct%') = 15, '15 courses imported');
select pg_temp.check((select count(*) from public.course_intakes where source like 'Oxford Direct%') = 15, '15 intakes imported');
select pg_temp.check((select count(*) from public.blacklisted_institutions) = 78, '78 blacklisted institutions imported');
select pg_temp.check((select tuition = 17450 and currency = 'GBP' and scholarship = '£5,000' from public.courses where name = 'MSc Cyber Security'), 'UoW postgraduate fee and scholarship');
select pg_temp.check((select tuition = 15500 and tuition_after_scholarship = 13000 from public.courses where name = 'MBA Management with Health Economics and Finance'), 'HSU MBA fee after scholarship');
select pg_temp.check((select tuition = 16000 from public.courses where name = 'Master of Business Administration – MBA'), 'LBU MBA uses the MBA fee row');
select pg_temp.check((select tuition = 16925 from public.courses where name = 'MSc International Business'), 'LBU MSc uses the MSc fee row');
select pg_temp.check((select cardinality(moi_accepted) = 44 from public.universities where name = 'University of Winchester'), 'UoW MOI list (44)');
select pg_temp.check((select city = 'Winchester' from public.universities where name = 'University of Winchester'), 'spelling corrected and city kept');
select pg_temp.check((select i.application_deadline = '2026-11-28' and i.start_date = '2027-01-18' and i.enrolment_deadline = '2027-01-28'
  from public.course_intakes i join public.courses c on c.id = i.course_id where c.name = 'MSc Project Management'), 'UoW intake dates');
select pg_temp.check((select i.end_date = '2028-04-28' from public.course_intakes i join public.courses c on c.id = i.course_id
  where c.name = 'MBA Management with Health Data Analytics and AI'), 'HSU MBA end date picked from the (MBA) entry');
select pg_temp.check((select intakes = '{Jan 2027}' from public.courses where name = 'MSc Cyber Security'), 'courses.intakes kept in sync with intake rows');

\echo '== idempotent re-run'
begin;
-- re-applying the same payload changes nothing
create temp table again on commit drop as select public.import_catalogue(jsonb_build_object(
  'source', 'Oxford Direct Toolkit FY27 (20 Oct 2026)',
  'universities', (select jsonb_agg(jsonb_build_object('name', name, 'country', country, 'city', city, 'cas_deposit', cas_deposit, 'payment_plan', payment_plan, 'moi_accepted', to_jsonb(moi_accepted))) from public.universities where source like 'Oxford%'),
  'courses', '[]'::jsonb), true) as s;
select pg_temp.check((select (s -> 'universities' ->> 'unchanged')::int = 3 and (s -> 'universities' ->> 'new')::int = 0 from again), 're-import of identical universities reports unchanged');
rollback;

\echo '== intake management'
begin; select pg_temp.act_as(:staff);
update public.course_intakes set intake_month = 9, intake_year = 2027 from public.courses c
  where c.id = course_intakes.course_id and c.name = 'MSc Cyber Security';
select pg_temp.check((select intakes = '{Sep 2027}' from public.courses where name = 'MSc Cyber Security'), 'changing the intake month/year updates the course immediately');
insert into public.course_intakes (course_id, intake_month, intake_year, status) select id, 1, 2028, 'Upcoming' from public.courses where name = 'MSc Cyber Security';
select pg_temp.check((select intakes = '{Sep 2027,Jan 2028}' from public.courses where name = 'MSc Cyber Security'), 'adding a future intake lists it in order');
update public.course_intakes set status = 'Closed' from public.courses c where c.id = course_intakes.course_id and c.name = 'MSc Cyber Security' and intake_year = 2027;
select pg_temp.check((select intakes = '{Jan 2028}' from public.courses where name = 'MSc Cyber Security'), 'closed intakes drop out of the course list');
update public.course_intakes set active = false from public.courses c where c.id = course_intakes.course_id and c.name = 'MSc Cyber Security' and intake_year = 2028;
select pg_temp.check((select intakes = '{}' from public.courses where name = 'MSc Cyber Security'), 'disabled intakes drop out too');
select pg_temp.denied($$insert into public.course_intakes (course_id, intake_month, intake_year) select id, 13, 2028 from public.courses where name = 'MSc Cyber Security'$$, 'invalid month rejected');
select pg_temp.denied($$insert into public.course_intakes (course_id, intake_month, intake_year) select id, 1, 2027 from public.courses where name = 'MSc Project Management'$$, 'duplicate intake for the same course rejected');
rollback;

\echo '== permissions'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.course_intakes) >= 15, 'partners can read intakes');
select pg_temp.check((select count(*) from public.blacklisted_institutions) = 78, 'partners can read the blacklist');
select pg_temp.check(pg_temp.affected($q$update public.course_intakes set intake_year = 2030$q$) = 0, 'partners cannot change intakes');
select pg_temp.check(pg_temp.affected($q$update public.courses set tuition = 1$q$) = 0, 'partners cannot change courses');
select pg_temp.denied($$select public.import_catalogue('{"universities":[{"name":"X Uni","country":"UK"}]}'::jsonb)$$, 'partners cannot import');
rollback;

begin; select pg_temp.act_as(:fin);
select pg_temp.check(pg_temp.affected($q$update public.courses set tuition = 1$q$) = 0, 'finance staff (no catalogue permission) cannot change courses');
select pg_temp.denied($$select public.import_catalogue('{"universities":[{"name":"X Uni","country":"UK"}]}'::jsonb)$$, 'finance staff cannot import');
rollback;

begin; select pg_temp.act_as(:staff);
create temp table imp on commit drop as select public.import_catalogue(jsonb_build_object('source', 'test',
  'universities', jsonb_build_array(jsonb_build_object('name', 'Test Uni', 'country', 'United Kingdom')),
  'courses', jsonb_build_array(
    jsonb_build_object('university', 'Test Uni', 'name', 'MSc Import Check', 'level', 'Postgraduate', 'tuition', 10000, 'currency', 'GBP',
      'intakes', jsonb_build_array(jsonb_build_object('month', 9, 'year', 2027, 'application_deadline', '2027-07-01'))),
    jsonb_build_object('university', 'Test Uni', 'name', 'No Fee', 'level', 'Postgraduate', 'intakes', '[]'::jsonb),
    jsonb_build_object('university', 'Ghost Uni', 'name', 'Orphan', 'level', 'Postgraduate', 'tuition', 1),
    jsonb_build_object('university', 'Test Uni', 'name', 'Odd Level', 'level', 'Kindergarten', 'tuition', 1))), true) as s;
select pg_temp.check((select (s -> 'courses' ->> 'new')::int = 1 and jsonb_array_length(s -> 'invalid') = 3 from imp), 'admin staff import: 1 new course, 3 invalid with reasons');
select pg_temp.check((select intakes = '{Sep 2027}' from public.courses where name = 'MSc Import Check'), 'imported intake listed');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.audit_log where action = 'catalogue_import'), 'import is audit-logged');
select pg_temp.act_as(:staff);
-- manual edit, then re-import with "keep manual edits"
update public.courses set duration = '1 year (manual)' where name = 'MSc Import Check';
create temp table imp2 on commit drop as select public.import_catalogue(jsonb_build_object('source', 'test',
  'courses', jsonb_build_array(jsonb_build_object('university', 'test uni', 'name', '  msc  IMPORT check ', 'level', 'Postgraduate', 'tuition', 12000, 'duration', '12 months', 'currency', 'GBP'))), false) as s;
select pg_temp.check((select duration = '1 year (manual)' and tuition = 10000 from public.courses where name = 'MSc Import Check'), 'keep-manual-edits import does not overwrite edited values');
select pg_temp.check((select count(*) = 1 from public.courses where lower(name) = 'msc import check'), 'name matching ignores case and spacing (no duplicate)');
create temp table imp3 on commit drop as select public.import_catalogue(jsonb_build_object('source', 'test',
  'courses', jsonb_build_array(jsonb_build_object('university', 'Test Uni', 'name', 'MSc Import Check', 'level', 'Postgraduate', 'tuition', 12000, 'currency', 'GBP'))), true) as s;
select pg_temp.check((select tuition = 12000 from public.courses where name = 'MSc Import Check') and (select (s -> 'courses' ->> 'updated')::int = 1 from imp3), 'overwrite import updates the fee and reports it');
select pg_temp.check((select count(*) from public.courses where source like 'Oxford%') = 15, 'imports never delete other courses');
rollback;

\echo '== realtime'
select pg_temp.check((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('course_intakes', 'blacklisted_institutions')) = 2,
  'intakes and blacklist are streamed');

\echo 'ALL SECURITY TESTS PASSED'
