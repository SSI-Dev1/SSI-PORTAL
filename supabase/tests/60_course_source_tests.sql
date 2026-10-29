-- Course spreadsheet fields (0010/0011): all columns kept, re-import safe, edits kept, permissions.
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
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set staff   '''00000000-0000-0000-0000-0000000000a2'''
\set uea     '''CourseFinder — University of East Anglia'''

\echo '== CourseFinder import (0011)'
select pg_temp.check((select count(*) from public.universities where name = 'University of East Anglia') = 1, 'one University of East Anglia');
select pg_temp.check((select count(*) from public.courses c join public.universities u on u.id = c.university_id where u.name = 'University of East Anglia') = 19, '19 UEA courses');
select pg_temp.check((select count(*) from public.course_intakes i join public.courses c on c.id = i.course_id where c.source = :uea) = 32, '32 UEA intakes');
select pg_temp.check((select count(*) from public.courses where source = :uea and jsonb_typeof(source_data) = 'object' and (select count(*) from jsonb_object_keys(source_data)) = 29) = 19, 'every course keeps all 29 source columns');
select pg_temp.check((select count(*) from public.courses where source = :uea and website_url ~ '^https://www\.uea\.ac\.uk/') = 19, '19 course website URLs');
select pg_temp.check((select count(*) from public.courses where source = :uea and scholarship_url ~ '^https://www\.uea\.ac\.uk/') = 19, '19 scholarship URLs');
select pg_temp.check((select count(*) from public.courses where source = :uea and cardinality(source_notes) = 2) = 19, 'both sheet notes kept with every course');
select pg_temp.check((select count(*) from public.courses where source = :uea and det_score is null) = 1, 'the one blank DET score stays blank');
select pg_temp.check((select count(*) from public.courses where source = :uea and remarks is null) = 7, 'blank remarks stay blank (7)');
select pg_temp.check((select count(*) from public.courses where source = :uea and name in ('MSc Project Management with placement', 'MSc Purchasing and Supply Chain Management with Placement Year',
  'MSc Purchasing and Supply Chain Management', 'MSc Sustainable Business Management with Placement Year', 'MSc Sustainable Business Management')) = 5, 'placement-year courses stay separate');
select pg_temp.check((select application_deadline_text = 'ASAP' and tuition_text = 'GBP 28300.00 (Approx INR 3590906)' and tuition = 28300
  from public.courses where source = :uea and name = 'MBA Master of Business Administration'), 'MBA fee text and amount');
select pg_temp.check((select count(*) from public.course_intakes i join public.courses c on c.id = i.course_id where c.source = :uea and i.application_deadline is not null) = 0, 'ASAP never becomes a date');
select pg_temp.check((select ranking_details like 'Webometrics World Ranking - 329%QS Ranking - 381' from public.universities where name = 'University of East Anglia'), 'ranking text kept');
select pg_temp.check((select count(*) from public.catalogue_imports where source = :uea and cardinality(notes) = 2 and rows_read = 19) = 1, 'import history recorded');

\echo '== re-import is safe and keeps manual edits'
begin;
update public.courses set remarks = 'Edited by admin', website_url = 'https://www.uea.ac.uk/edited' where source = :uea and name = 'MSc Cyber Security';
\i migrations/0011_import_course_finder_uea.sql
select pg_temp.check((select count(*) from public.courses where source = :uea) = 19, 're-import creates no duplicates');
select pg_temp.check((select count(*) from public.course_intakes i join public.courses c on c.id = i.course_id where c.source = :uea) = 32, 're-import creates no duplicate intakes');
select pg_temp.check((select remarks = 'Edited by admin' and website_url = 'https://www.uea.ac.uk/edited' from public.courses where source = :uea and name = 'MSc Cyber Security'), 'manual edits survive a re-import');
select pg_temp.check((select source_data ->> 'Website URL' = 'https://www.uea.ac.uk/course/postgraduate/msc-cyber-security' from public.courses where source = :uea and name = 'MSc Cyber Security'), 'source record still holds the original URL');
rollback;

\echo '== earlier draft import is cleaned up'
begin;
update public.courses set source = 'CourseFinder export (University of East Anglia)', course_requirement = E'Remarks\nCourse page: https://x', scholarship = 'Available · average GBP 5,000',
  academic_requirement = academic_requirement || E'\nBacklogs accepted: 0 - 30', english_requirement = 'IELTS 6 (no band less than 5.5) · PTE 60'
where source = :uea and name = 'LLM Master of Laws';
\i migrations/0011_import_course_finder_uea.sql
select pg_temp.check((select course_requirement is null and english_requirement is null and scholarship = 'GBP 5000.00 (Approx INR 634436)'
  and academic_requirement = 'UK Bachelors degree - 2.2 or equivalent,Law Degree.' from public.courses where name = 'LLM Master of Laws'), 'draft values replaced by the column values');
rollback;

\echo '== permissions'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.courses where website_url is not null and source_data is not null) >= 19, 'partners can read the full course record');
select pg_temp.check((select count(*) from public.catalogue_imports) = 0, 'partners cannot read import history');
select pg_temp.denied($$insert into public.catalogue_imports (source) values ('x')$$, 'nobody writes import history directly');
select pg_temp.denied($$select public.import_catalogue_base('{}'::jsonb, false)$$, 'the base import is not callable from the app');
rollback;
begin; select pg_temp.act_as(:staff);
select pg_temp.denied($$update public.courses set website_url = 'javascript:alert(1)' where source = 'CourseFinder — University of East Anglia'$$, 'links must be http(s)');
rollback;

\echo 'ALL SECURITY TESTS PASSED'
