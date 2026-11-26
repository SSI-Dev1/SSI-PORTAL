-- Student import with university preferences (0061). Synthetic data only.
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

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''

begin;
select pg_temp.trusted();
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled) values
  ('si-north', 'North Star Overseas', 'SINS', 'N', 'n@si.test', 'Active', true),
  ('si-blue', 'Blue Bridge Education', 'SIBB', 'B', 'b@si.test', 'Active', true);
-- an existing production student (the import must match it by passport and never overwrite it)
insert into public.students (id, partner_id, first_name, last_name, email, phone, passport_no, status)
values ('si-existing', 'si-north', 'Esha', 'Existing', 'esha@prod.test', '+91 90000 77777', 'Z1234567', 'Enrolled');
create temp table w0 as select count(*) n from public.work_activities;
create temp table n0 as select count(*) n from public.notifications;
grant select on w0, n0 to authenticated;

-- What the browser parser sends (studentImport.ts): one group per student, every row a preference.
create temp table g as select $j$[
 {"key":"p:A1111111|asha one","name":"Asha One","passport":"A1111111","agent":"north star overseas","priority_intake":"Sep 2026","priority_intake_month":"2026-09-01","country":"UK","source_rows":[2],"flags":[],"review":null,
  "prefs":[{"key":"p:A1111111|asha one|uni a|msc x|sep 2026#1","source_row":2,"priority":"1","university":"Uni A","course":"MSc X","program_intake":"Sep 2026","program_intake_month":"2026-09-01","country":"UK","portal":"Infinity","submitted":"Yes","submission_date":"2026-06-13","application_status":"Application Submitted","pending_documents":null,"offer_status":"COL","offer_status_date":"2026-07-01","current_status":"Offer Received &will proceed","current_status_date":null,"payment":"Initital fee paid","payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":"Good","date_issues":[],"source":{"row":"2","Student Name":"Asha One","Offer Status":"COL"}}]},
 {"key":"p:B2222222|bala four","name":"Bala Four","passport":"B2222222","agent":"Blue Bridge Education","priority_intake":"Jan 2027","priority_intake_month":"2027-01-01","country":"UK","source_rows":[3,4,5,6],"flags":[],"review":null,
  "prefs":[
   {"key":"k-b2","source_row":4,"priority":null,"university":"Uni B","course":"MSc Y","program_intake":"Jan 2027","program_intake_month":null,"country":"UK","portal":null,"submitted":"No","submission_date":null,"application_status":"Plan Dropped","pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":"Dropped without offer","current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":["Offer Status date"],"source":{"row":"4","Offer Status date":"OIP 8/10/2026"}},
   {"key":"k-b1","source_row":3,"priority":"1","university":"Uni A","course":"MBA","program_intake":"Jan 2027","program_intake_month":"2027-01-01","country":"UK","portal":"Hoque","submitted":"Yes","submission_date":null,"application_status":"Application Submitted","pending_documents":null,"offer_status":"UCOL","offer_status_date":null,"current_status":null,"current_status_date":null,"payment":"Full fee paid","payment_status_date":null,"deferral":null,"visa_status":"Visa Received","visa_status_date":"2026-11-01","remarks":null,"date_issues":[],"source":{"row":"3"}},
   {"key":"k-b3","source_row":5,"priority":null,"university":"Uni C","course":"MSc Z","program_intake":null,"program_intake_month":null,"country":"UK","portal":null,"submitted":"Yes","submission_date":null,"application_status":"On Hold","pending_documents":"English qualification","offer_status":"offer not received yet","offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":[],"source":{"row":"5"}},
   {"key":"k-b4","source_row":6,"priority":null,"university":"Uni D","course":null,"program_intake":null,"program_intake_month":null,"country":"UK","portal":null,"submitted":"No","submission_date":null,"application_status":null,"pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":"Deferred to May","visa_status":null,"visa_status_date":null,"remarks":"Call later","date_issues":[],"source":{"row":"6"}}]},
 {"key":"p:C3333333|cara conflict","name":"Cara Conflict","passport":"C3333333","agent":"North Star Overseas","priority_intake":null,"priority_intake_month":null,"country":"UK","source_rows":[228,229],"flags":["Priority conflict"],"review":null,
  "prefs":[{"key":"k-c1","source_row":228,"priority":"1","university":"Uni E","course":"MSc","program_intake":null,"program_intake_month":null,"country":"UK","portal":null,"submitted":"Yes","submission_date":null,"application_status":null,"pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":[],"source":{"row":"228"}},
           {"key":"k-c2","source_row":229,"priority":"1","university":"Uni F","course":"MSc","program_intake":null,"program_intake_month":null,"country":"UK","portal":null,"submitted":"Yes","submission_date":null,"application_status":null,"pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":[],"source":{"row":"229"}}]},
 {"key":"p:Z1234567|esha existing","name":"Esha Existing","passport":"z1234567","agent":"North Star Overseas","priority_intake":"Sep 2026","priority_intake_month":"2026-09-01","country":"Georgia","source_rows":[7],"flags":[],"review":null,
  "prefs":[{"key":"k-e1","source_row":7,"priority":"1","university":"Uni G","course":"MD","program_intake":null,"program_intake_month":null,"country":"Georgia","portal":null,"submitted":"Yes","submission_date":null,"application_status":null,"pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":[],"source":{"row":"7"}}]},
 {"key":"n:dev unknown|mystery agency","name":"Dev Unknown","passport":null,"agent":"Mystery Agency","priority_intake":null,"priority_intake_month":null,"country":"UK","source_rows":[8],"flags":[],"review":null,
  "prefs":[{"key":"k-d1","source_row":8,"priority":"1","university":"Uni H","course":null,"program_intake":null,"program_intake_month":null,"country":"UK","portal":null,"submitted":"No","submission_date":null,"application_status":null,"pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":[],"source":{"row":"8"}}]},
 {"key":"p:Q9999999|first twin","name":"First Twin","passport":"Q9999999","agent":"North Star Overseas","priority_intake":null,"priority_intake_month":null,"country":"UK","source_rows":[188],"flags":[],"review":"The same passport number is given for another student with a different name — check which is correct",
  "prefs":[{"key":"k-t1","source_row":188,"priority":"1","university":"Uni I","course":null,"program_intake":null,"program_intake_month":null,"country":"UK","portal":null,"submitted":"No","submission_date":null,"application_status":null,"pending_documents":null,"offer_status":null,"offer_status_date":null,"current_status":null,"current_status_date":null,"payment":null,"payment_status_date":null,"deferral":null,"visa_status":null,"visa_status_date":null,"remarks":null,"date_issues":[],"source":{"row":"188"}}]}
]$j$::jsonb as j;
grant select on g to authenticated;

\echo '== permissions'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.preview_student_import((select j from g), '{}')$$, 'a Partnership Officer cannot import students', '%Super Admin%');
select pg_temp.act_as(:app);
select pg_temp.denied($$select public.apply_student_import((select j from g), '{}', 'x.xlsx', null)$$, 'an application team member cannot import students', '%Super Admin%');

\echo '== TEST 13 / 9: preview — agent matching and student matching'
select pg_temp.act_as(:super);
select public.preview_student_import((select j from g), '{}') as pv \gset
create temp table pv as select x from jsonb_array_elements(:'pv'::jsonb -> 'groups') x;
grant select on pv to authenticated;
select pg_temp.check((select x ->> 'agent_status' = 'matched' and x ->> 'partner_id' = 'si-north' and x ->> 'match' = 'new' from pv where x ->> 'name' = 'Asha One'),
  'agent "north star overseas" matched to the existing partner (case and spaces ignored); new student');
select pg_temp.check((select x ->> 'match' = 'existing' and x ->> 'student_id' = 'si-existing' from pv where x ->> 'name' = 'Esha Existing'), 'existing student matched by passport (case ignored)');
select pg_temp.check((select x ->> 'agent_status' = 'unmapped' and not (x ->> 'importable')::boolean from pv where x ->> 'name' = 'Dev Unknown'), 'unknown agent: not guessed, held for mapping');
select pg_temp.check((select x ->> 'match' = 'review' and not (x ->> 'importable')::boolean from pv where x ->> 'name' = 'First Twin'), 'shared passport under another name: held for review');
select pg_temp.check((select x ->> 'primary' = 'conflict' from pv where x ->> 'name' = 'Cara Conflict'), 'two Priority 1 rows: conflict');
select pg_temp.check((select count(*) from public.students where import_key is not null) = 0, 'preview changes nothing');

\echo '== TEST 3 / 4 / 5 / 6 / 7: apply'
select public.apply_student_import((select j from g), '{"Mystery Agency": "si-blue"}', 'students.xlsx', 'abc') as r \gset
select pg_temp.check((:'r'::jsonb ->> 'students_created')::int = 4 and (:'r'::jsonb ->> 'students_matched')::int = 1 and (:'r'::jsonb ->> 'preferences_created')::int = 9
  and jsonb_array_length(:'r'::jsonb -> 'skipped') = 1 and (:'r'::jsonb ->> 'priority_conflicts')::int = 1,
  '4 new students, 1 matched, 9 university choices, 1 held for review, 1 conflict');
select pg_temp.check((select count(*) = 1 and bool_and(p.is_primary) from public.students s join public.student_university_preferences p on p.student_id = s.id where s.first_name = 'Asha'),
  'one university: one student, one choice, primary');
select pg_temp.check((select count(*) = 4 and count(*) filter (where p.is_primary) = 1 and bool_and(p.is_primary = (p.university_name = 'Uni A'))
  from public.students s join public.student_university_preferences p on p.student_id = s.id where s.first_name = 'Bala'),
  'four universities: one student, all four choices, Priority 1 is the primary, blanks are other options');
select pg_temp.check((select count(*) from public.students where first_name = 'Bala') = 1, 'not four students');
select pg_temp.check((select s.priority_conflict and count(p.*) = 2 and count(*) filter (where p.is_primary) = 0
  from public.students s join public.student_university_preferences p on p.student_id = s.id where s.first_name = 'Cara' group by s.priority_conflict),
  'conflict: both choices kept, no primary, flagged for review');
select pg_temp.check((select partner_id = 'si-blue' and agent_name_source = 'Mystery Agency' from public.students where first_name = 'Dev'), 'the administrator''s agent choice is used and the original agent text kept');
select pg_temp.check((select partner_id = 'si-blue' from public.student_agent_mappings where agent_key = 'mystery agency'), 'and remembered for the next import');
select pg_temp.check(not exists (select 1 from public.students where first_name = 'First'), 'the review case was not imported');

\echo '== TEST 10: every source value kept on its own university'
select pg_temp.check((select application_portal = 'Hoque' and offer_status = 'UCOL' and payment = 'Full fee paid' and visa_status = 'Visa Received' and visa_status_date = '2026-11-01'
  from public.student_university_preferences where import_key = 'k-b1'), 'portal, offer, payment, visa and dates on choice 1');
select pg_temp.check((select application_status = 'Plan Dropped' and current_status = 'Dropped without offer' and offer_status_date is null and date_issues = '{Offer Status date}'
  and source ->> 'Offer Status date' = 'OIP 8/10/2026' from public.student_university_preferences where import_key = 'k-b2'),
  'a value that is not a date is kept as written and listed, never invented');
select pg_temp.check((select deferral_details = 'Deferred to May' and remarks = 'Call later' from public.student_university_preferences where import_key = 'k-b4'), 'deferral and remarks kept');
select pg_temp.check((select priority_intake = 'Jan 2027' and priority_intake_month = '2027-01-01' and passport_no = 'B2222222' and email = '' from public.students where first_name = 'Bala'),
  'priority intake kept separately from program intakes; no email invented');
select pg_temp.check(not exists (select 1 from public.student_university_preferences where source ? 'passport number'), 'passport not copied into the source cells');

\echo '== TEST 12: production data never overwritten'
select pg_temp.check((select first_name = 'Esha' and email = 'esha@prod.test' and phone = '+91 90000 77777' and status = 'Enrolled' and passport_no = 'Z1234567'
  and priority_intake = 'Sep 2026' and preferred_countries = '{Georgia}' from public.students where id = 'si-existing'),
  'existing student: only blank fields filled (priority intake, country); email, phone, status untouched');

\echo '== TEST 11: re-import'
select public.apply_student_import((select j from g), '{"Mystery Agency": "si-blue"}', 'students.xlsx', 'abc') as r2 \gset
select pg_temp.check((:'r2'::jsonb ->> 'students_created')::int = 0 and (:'r2'::jsonb ->> 'preferences_created')::int = 0 and (:'r2'::jsonb ->> 'preferences_already_imported')::int = 9,
  'same file again: no new students, no new choices');
select pg_temp.check((select count(*) from public.students where import_key is not null) = 5, 'still 5 imported students');
select pg_temp.check((select count(*) from public.student_import_batches) >= 2, 'each import recorded');

\echo '== TEST 8: Set as Primary Choice'
select pg_temp.act_as(:app);
select public.set_primary_university((select id from public.student_university_preferences where import_key = 'k-b3'));
select pg_temp.check((select count(*) filter (where is_primary) = 1 and bool_and(is_primary = (import_key = 'k-b3')) and count(*) = 4
  from public.student_university_preferences where student_id = (select id from public.students where first_name = 'Bala')),
  'new primary saved; previous primary is now another option; nothing deleted');
select pg_temp.check((select primary_set_by = :app::uuid and primary_set_at is not null from public.student_university_preferences where import_key = 'k-b3'), 'who and when recorded');
select public.set_primary_university((select id from public.student_university_preferences where import_key = 'k-c2'));
select pg_temp.check((select not priority_conflict from public.students where first_name = 'Cara'), 'choosing a primary resolves the conflict');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.set_primary_university((select id from public.student_university_preferences where import_key = 'k-b1'))$$, 'staff without Students cannot change it', '%Not allowed%');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select count(*) from public.student_university_preferences) = 0, 'TEST 15: partner users read no university choices (internal working data)');
select pg_temp.check((select count(*) from public.student_import_batches) = 0, 'or import history');

\echo '== TEST 14: no work, no notifications'
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'no Daily Work Report activity from the import');
select pg_temp.check((select count(*) from public.notifications) = (select n from n0), 'no notifications sent');
rollback;
