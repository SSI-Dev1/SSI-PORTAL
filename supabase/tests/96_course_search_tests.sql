-- Advanced Course Search (0019): filter logic, no inferred matches, validation, access, live data.
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
-- Result names (sorted) for a filter, limited to the fixture universities.
create or replace function pg_temp.hits(f jsonb) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'name' order by x ->> 'name'), '{}')
  from jsonb_array_elements(public.search_courses(f || '{"universities":["su1","su2","su3"]}', 'name', 50, 0) -> 'rows') x;
$$;
create or replace function pg_temp.count_of(f jsonb) returns bigint language sql as $$
  select (public.search_courses(f, 'name', 1, 0) ->> 'total')::bigint;
$$;

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set super   '''00000000-0000-0000-0000-0000000000a1'''

begin;
insert into public.universities (id, name, country, city, state, ranking) values
  ('su1', 'Alpha University', 'Canada', 'Toronto', 'Ontario', 50),
  ('su2', 'Beta College', 'Canada', 'Vancouver', 'British Columbia', 300),
  ('su3', 'Gamma Institute', 'Germany', 'Berlin', null, 0);
insert into public.courses (id, university_id, name, level, program_level, field, discipline_area, duration, tuition, currency, ielts_min, ielts_band, toefl_score, pte_score, det_score,
    sat_min, gre_min, campus, study_mode, stem, english_required, gre_required, maths_required, accepts_fifteen_years, application_fee_waiver, esl_available, scholarship_available,
    average_scholarship, scholarship, english_waiver, application_fee, backlog_range, academic_requirement, website_url, active) values
  ('sc1', 'su1', 'MSc Data Science', 'Postgraduate', null, 'Computer Science', 'Data', '12 Months', 20000, 'CAD', 6.5, 6.0, 90, 60, 110, null, 300, 'Downtown', 'On Campus', true, true, false, null, true, true, null, 'Yes',
     'CAD 5000.00 (Approx INR 300000)', null, 'MOI accepted', 'No Application Fee', '0 - 30', '2.1 Bachelor degree', 'https://a.test/ds', true),
  ('sc2', 'su1', 'BSc Nursing', 'Undergraduate', null, 'Healthcare', 'Nursing', '36 Months', 15000, 'CAD', 7.0, null, null, null, null, 1200, null, 'Downtown', 'Hybrid', null, null, null, false, null, null, true, 'No',
     null, 'No', 'No', 'CAD 100', null, 'High school 70%', null, true),
  ('sc3', 'su2', 'MBA Global', 'Postgraduate', 'Pathway Programs (PG)', 'Business', 'Management', '24 Months', 30000, 'CAD', 0, null, null, null, null, null, null, 'Harbour', 'Online', false, false, null, null, null, null, null, null,
     null, 'VC Scholarship: 2,500', null, null, null, null, null, true),
  ('sc4', 'su3', 'MA Design 100%_x', 'Postgraduate', null, null, null, '12 Months', 9000, 'EUR', 6.0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
     null, null, null, null, null, null, null, true),
  ('sc5', 'su1', 'Hidden Course', 'Postgraduate', null, 'Computer Science', null, '12 Months', 1000, 'CAD', 5.0, null, null, null, null, null, null, 'Downtown', null, null, null, null, null, null, null, null, null,
     null, null, null, null, null, null, null, false);
insert into public.course_intakes (id, course_id, intake_month, intake_year, status, application_deadline, active) values
  ('si1', 'sc1', 9, 2027, 'Available', '2027-06-30', true),
  ('si2', 'sc1', 1, 2028, 'Upcoming', '2027-10-31', true),
  ('si3', 'sc2', 9, 2027, 'Closed', '2027-06-30', true),
  ('si4', 'sc3', 1, 2028, 'Available', null, true),
  ('si5', 'sc4', 9, 2028, 'Available', null, false);
select pg_temp.act_as(:p1admin);

\echo '== text search'
select pg_temp.check(pg_temp.hits('{"q":"data science"}') = '{"MSc Data Science"}', 'search by course name');
select pg_temp.check(pg_temp.hits('{"q":"beta"}') = '{"MBA Global"}', 'search by university name');
select pg_temp.check(pg_temp.hits('{"q":"alpha nursing"}') = '{"BSc Nursing"}', 'words match across university and course');
select pg_temp.check(pg_temp.hits('{"q":"zzz"}') = '{}', 'no matches returns nothing');
select pg_temp.check(pg_temp.hits('{"q":"%"}') = '{"MA Design 100%_x"}', 'percent sign is text, not a wildcard');
select pg_temp.check(pg_temp.hits('{"q":"_"}') = '{"MA Design 100%_x"}', 'underscore is text, not a wildcard');

\echo '== categories'
select pg_temp.check(pg_temp.hits('{"countries":["Germany"]}') = '{"MA Design 100%_x"}', 'filter by country');
select pg_temp.check(pg_temp.hits('{"countries":["Germany","Canada"]}') = '{"BSc Nursing","MA Design 100%_x","MBA Global","MSc Data Science"}', 'options inside a category use OR');
select pg_temp.check(pg_temp.hits('{"levels":["Undergraduate"]}') = '{"BSc Nursing"}', 'program level uses the existing study level');
select pg_temp.check(pg_temp.hits('{"levels":["Pathway Programs (PG)"]}') = '{"MBA Global"}', 'verified program level matches');
select pg_temp.check(not 'MBA Global' = any (pg_temp.hits('{"levels":["Postgraduate"]}')), 'a course with a specific program level is not also listed under the general one');
select pg_temp.check(pg_temp.hits('{"states":["Ontario"]}') = '{"BSc Nursing","MSc Data Science"}', 'filter by province / state');
select pg_temp.check(pg_temp.hits('{"campuses":["Harbour"]}') = '{"MBA Global"}', 'filter by campus');
select pg_temp.check(pg_temp.hits('{"study_areas":["Business"]}') = '{"MBA Global"}', 'filter by study area');
select pg_temp.check(pg_temp.hits('{"disciplines":["Nursing"]}') = '{"BSc Nursing"}', 'filter by discipline');
select pg_temp.check(pg_temp.hits('{"durations":["36 Months"]}') = '{"BSc Nursing"}', 'filter by duration');
select pg_temp.check(pg_temp.hits('{"durations":["36 months"]}') = '{"BSc Nursing"}', 'duration ignores letter case');
select pg_temp.check(pg_temp.hits('{"modes":["Online","Hybrid"]}') = '{"BSc Nursing","MBA Global"}', 'filter by study mode');
select pg_temp.check(pg_temp.hits('{"app_fees":["No Application Fee"]}') = '{"MSc Data Science"}', 'filter by application fee text');
select pg_temp.check(pg_temp.hits('{"backlogs":["0 - 30"]}') = '{"MSc Data Science"}', 'filter by backlog range');
select pg_temp.check(pg_temp.hits('{"academic":"2.1"}') = '{"MSc Data Science"}', 'academic requirement contains');
select pg_temp.check(pg_temp.hits('{"countries":["Canada"],"levels":["Undergraduate"],"modes":["Online"]}') = '{}', 'different categories combine with AND');
select pg_temp.check(pg_temp.hits('{"q":"msc","countries":["Canada"],"flags":["scholarship"]}') = '{"MSc Data Science"}', 'search terms work together with filters');

\echo '== exams: only what the record states'
select pg_temp.check(pg_temp.hits('{"exams":{"TOEFL":{}}}') = '{"MSc Data Science"}', 'TOEFL matches only courses with a recorded score');
select pg_temp.check(pg_temp.hits('{"exams":{"GRE":{}}}') = '{"MSc Data Science"}', 'GRE matches only recorded');
select pg_temp.check(pg_temp.hits('{"exams":{"SAT":{}}}') = '{"BSc Nursing"}', 'SAT matches only recorded');
select pg_temp.check(pg_temp.hits('{"exams":{"GMAT":{}}}') = '{}', 'an exam nobody records matches nothing');
select pg_temp.check(pg_temp.hits('{"exams":{"TOEFL":{},"SAT":{}}}') = '{"BSc Nursing","MSc Data Science"}', 'exams combine with OR');
select pg_temp.check(not 'MBA Global' = any (pg_temp.hits('{"exams":{"IELTS":{}}}')), 'IELTS 0 means not recorded');
select pg_temp.check(pg_temp.hits('{"exams":{"IELTS":{"score":"6.5"}}}') = '{"MA Design 100%_x","MSc Data Science"}', 'student IELTS 6.5 matches requirements up to 6.5');
select pg_temp.check(pg_temp.hits('{"exams":{"IELTS":{"score":"6"}}}') = '{"MA Design 100%_x"}', 'student IELTS 6 excludes a 6.5 requirement');
select pg_temp.check(pg_temp.hits('{"exams":{"IELTS":{"score":"7","band":"6"}}}') = '{"MSc Data Science"}', 'band filter needs a recorded band');
select pg_temp.check(pg_temp.hits('{"exams":{"IELTS":{"score":"7","band":"5.5"}}}') = '{}', 'band below the requirement excludes');
select pg_temp.check(pg_temp.hits('{"exams":{"PTE":{"score":"59"}}}') = '{}', 'PTE below the requirement excludes');
select pg_temp.check(pg_temp.hits('{"exams":{"DET":{"score":"110"}}}') = '{"MSc Data Science"}', 'DET at the requirement matches');

\echo '== yes/no facts: an empty column never matches'
select pg_temp.check(pg_temp.hits('{"flags":["without_english"]}') = '{"MBA Global"}', 'without English only when recorded false');
select pg_temp.check(pg_temp.hits('{"flags":["without_gre"]}') = '{"MSc Data Science"}', 'without GRE only when recorded false');
select pg_temp.check(pg_temp.hits('{"flags":["without_gmat"]}') = '{}', 'without GMAT is not assumed from a missing GMAT score');
select pg_temp.check(pg_temp.hits('{"flags":["without_maths"]}') = '{"BSc Nursing"}', 'without maths only when recorded false');
select pg_temp.check(pg_temp.hits('{"flags":["stem"]}') = '{"MSc Data Science"}', 'STEM only when recorded true');
select pg_temp.check(pg_temp.hits('{"flags":["fifteen_years"]}') = '{"MSc Data Science"}', '15 years of education only when recorded');
select pg_temp.check(pg_temp.hits('{"flags":["fee_waiver"]}') = '{"MSc Data Science"}', 'application fee waiver only when recorded');
select pg_temp.check(pg_temp.hits('{"flags":["esl"]}') = '{"BSc Nursing"}', 'ESL / ELP only when recorded');
select pg_temp.check(pg_temp.hits('{"flags":["english_waiver"]}') = '{"MSc Data Science"}', 'waiver text counts; "No" does not');
select pg_temp.check(pg_temp.hits('{"flags":["scholarship"]}') = '{"MBA Global","MSc Data Science"}', 'scholarship from the column or the summary text; "No" excluded');

\echo '== money stays in its own currency'
select pg_temp.check(pg_temp.hits('{"currencies":["EUR"]}') = '{"MA Design 100%_x"}', 'filter by currency');
select pg_temp.check(pg_temp.hits('{"currencies":["CAD"],"tuition_min":"16000","tuition_max":"25000"}') = '{"MSc Data Science"}', 'tuition range');
select pg_temp.check(pg_temp.hits('{"scholarship_min":"5000"}') = '{"MSc Data Science"}', 'scholarship amount from the original amount in the course currency');
select pg_temp.check(pg_temp.hits('{"scholarship_min":"5001"}') = '{}', 'approximate INR amount is not used');
select pg_temp.check((select average_scholarship from public.courses where id = 'sc1') = 'CAD 5000.00 (Approx INR 300000)', 'source text is unchanged');

\echo '== intakes come from the live table'
select pg_temp.check(pg_temp.hits('{"intake_months":["9"]}') = '{"MSc Data Science"}', 'closed and disabled intakes do not match');
select pg_temp.check(pg_temp.hits('{"intake_years":["2028"]}') = '{"MBA Global","MSc Data Science"}', 'filter by intake year');
select pg_temp.check(pg_temp.hits('{"intake_labels":["Jan 2028"]}') = '{"MBA Global","MSc Data Science"}', 'filter by available intake');
select pg_temp.check(pg_temp.hits('{"intake_months":["9"],"intake_years":["2028"]}') = '{}', 'month and year must be the same intake');
select pg_temp.check(pg_temp.hits('{"availability":["open"]}') = '{"MBA Global","MSc Data Science"}', 'open programs');
select pg_temp.check(pg_temp.hits('{"availability":["upcoming"]}') = '{"MSc Data Science"}', 'upcoming intakes');
select pg_temp.check(pg_temp.hits('{"deadline_from":"2027-07-01"}') = '{"MSc Data Science"}', 'application deadline from a date');
select pg_temp.check(pg_temp.hits('{"deadline_to":"2027-05-01"}') = '{}', 'application deadline to a date');
select pg_temp.trusted();
update public.course_intakes set status = 'Available', intake_month = 3 where id = 'si3';
select pg_temp.act_as(:p1admin);
select pg_temp.check(pg_temp.hits('{"intake_months":["3"]}') = '{"BSc Nursing"}', 'an intake changed by Admin changes the results at once');
select pg_temp.trusted();
update public.course_intakes set status = 'Closed' where id = 'si3';
select pg_temp.act_as(:p1admin);

\echo '== results'
select pg_temp.check((select r -> 'university' ->> 'name' = 'Alpha University' and r ->> 'websiteUrl' = 'https://a.test/ds' and r ->> 'campus' = 'Downtown' and (r -> 'ielts')::numeric = 6.5
                             and (r ->> 'hasScholarship')::boolean and jsonb_array_length(r -> 'intakes') = 2
                      from (select public.search_courses('{"q":"data science","universities":["su1"]}') -> 'rows' -> 0 as r) x), 'a result carries the university, website, campus, English, scholarship and intakes');
select pg_temp.check((public.search_courses('{"universities":["su1","su2","su3"]}', 'tuition_asc', 1, 0) -> 'rows' -> 0 ->> 'name') = 'MA Design 100%_x', 'sort by tuition');
select pg_temp.check((public.search_courses('{"universities":["su1","su2","su3"]}', 'name', 2, 2) -> 'rows' -> 0 ->> 'name') = 'MBA Global', 'pagination');
select pg_temp.check((public.search_courses('{"universities":["su1","su2","su3"]}', 'name', 2, 2) ->> 'total')::int = 4, 'total counts every match, not the page');
select pg_temp.check(jsonb_array_length(public.search_courses('{}', 'name', 100000, 0) -> 'rows') <= 50, 'page size is capped');
select pg_temp.check(not ('Hidden Course' = any (pg_temp.hits('{}'))), 'inactive courses are hidden');
select pg_temp.check(not ('Hidden Course' = any (pg_temp.hits('{"include_inactive":true}'))), 'a partner cannot ask for inactive courses');
select pg_temp.act_as(:super);
select pg_temp.check('Hidden Course' = any (pg_temp.hits('{"include_inactive":true}')), 'catalogue staff can include inactive courses');
select pg_temp.act_as(:p1admin);

\echo '== options come from the data'
select pg_temp.check((public.course_search_facets() -> 'levels') ? 'Pathway Programs (PG)', 'program level options include what exists');
select pg_temp.check(not (public.course_search_facets() -> 'levels') ? 'Twinning Programs (UG)', 'program levels nobody has are not offered');
select pg_temp.check((public.course_search_facets('{"countries":["Germany"]}') -> 'universities') @> '[{"id":"su3"}]'
                     and not (public.course_search_facets('{"countries":["Germany"]}') -> 'universities') @> '[{"id":"su1"}]', 'country narrows universities');
select pg_temp.check((public.course_search_facets('{"countries":["Germany"]}') -> 'states') = '[]', 'country narrows states');
select pg_temp.check((public.course_search_facets('{"universities":["su2"]}') -> 'campuses') = '["Harbour"]', 'university narrows campuses');
select pg_temp.check((public.course_search_facets('{"study_areas":["Business"]}') -> 'disciplines') = '["Management"]', 'study area narrows disciplines');
select pg_temp.check((public.course_search_facets() -> 'intakeLabels') ? 'Jan 2028' and not (public.course_search_facets() -> 'intakeLabels') ? 'Sep 2028', 'intake options are live; disabled ones are absent');
select pg_temp.check(((public.course_search_facets() #>> '{exams,GMAT,count}')::int) = 0, 'GMAT has no recorded data');
select pg_temp.check((public.course_search_facets() -> 'currencies') @> '[{"currency":"EUR","max":9000}]', 'tuition range is per currency');
rollback;

\echo '== real imported data keeps its fields and is not over-matched'
begin;
select pg_temp.act_as(:p1admin);
select pg_temp.check(pg_temp.count_of('{"q":"university of east anglia"}') = 19, 'all 19 UEA courses are found');
select pg_temp.check(pg_temp.count_of('{"q":"east anglia","flags":["scholarship"]}') = 19, 'UEA scholarship column is used');
select pg_temp.check(pg_temp.count_of('{"q":"east anglia","exams":{"GRE":{}}}') = 0, 'no exam is inferred for imported courses');
select pg_temp.check(pg_temp.count_of('{"q":"east anglia","modes":["Online"]}') = 0, '"Application mode: Online" is not treated as an online course');
select pg_temp.check(pg_temp.count_of('{"q":"east anglia","flags":["stem"]}') = 0, 'STEM is not inferred');
select pg_temp.check(pg_temp.count_of('{"q":"east anglia","exams":{"TOEFL":{"score":"70"}}}') = 1, 'imported TOEFL scores are used exactly');
select pg_temp.check((public.course_search_facets() -> 'flags' ->> 'stem')::boolean = false, 'STEM filter is not offered until data exists');
select pg_temp.check((public.course_search_facets() -> 'flags' ->> 'english_waiver')::boolean, 'English waiver filter is offered from imported data');
select pg_temp.check((select count(*) = 19 from public.courses c join public.universities u on u.id = c.university_id
                      where u.name = 'University of East Anglia' and c.source_data is not null and c.website_url is not null and c.tuition_text is not null), 'imported source rows and links are intact');
rollback;

\echo '== access and validation'
begin;
select pg_temp.act_as(:p1admin);
select pg_temp.denied($$select public.search_courses('[]')$$, 'request must be an object', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses('{"nope":1}')$$, 'unknown filter rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses('{"tuition_min":"1; drop table x"}')$$, 'bad number rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses('{"deadline_from":"2027-13-40"}')$$, 'bad date rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses('{"exams":{"XYZ":{}}}')$$, 'unknown exam rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses('{"intake_months":["x"]}')$$, 'bad month rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses(jsonb_build_object('q', repeat('x', 201)))$$, 'over-long search rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.search_courses('{}', 'evil')$$, 'unknown sort rejected', '%SEARCH_INVALID%');
select pg_temp.denied($$select public.course_search_ids('{}')$$, 'internal function is not callable directly');
select pg_temp.trusted();
update public.partners set modules = array_remove(modules, 'course_finder') where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.denied($$select public.search_courses('{}')$$, 'partner without the Course Finder module is denied', '%SEARCH_DENIED%');
select pg_temp.denied($$select public.course_search_facets('{}')$$, 'facets denied too', '%SEARCH_DENIED%');
select pg_temp.trusted();
update public.partners set modules = modules || '{course_finder}' where id = 'p1';
update public.profiles set status = 'suspended' where id = :p1admin;
select pg_temp.act_as(:p1admin);
select pg_temp.denied($$select public.search_courses('{}')$$, 'suspended user is denied', '%SEARCH_DENIED%');
rollback;

\echo '== import fills the new fields only from the file'
begin;
select pg_temp.act_as(:super);
select public.import_catalogue('{"source":"t","universities":[{"name":"Import U","country":"Canada","state":"Ontario"}],
  "courses":[{"university":"Import U","name":"MSc Imported","level":"Postgraduate","tuition":100,"currency":"CAD","intakes":[],
    "details":{"study_mode":"Online","stem":true,"gre_required":false,"gmat_min":600,"program_level":"Hybrid Programs"}}],"blacklist":[]}'::jsonb, true);
select pg_temp.check((select study_mode = 'Online' and stem and gre_required = false and gmat_min = 600 and program_level = 'Hybrid Programs' and sat_min is null and maths_required is null from public.courses where name = 'MSc Imported'), 'import applies verified fields and leaves others empty');
select pg_temp.check((select state = 'Ontario' from public.universities where name = 'Import U'), 'import applies the state');
rollback;
