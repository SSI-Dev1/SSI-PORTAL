-- Agency Excel import, whole-pipeline visibility and report attribution (0035). Synthetic rows only.
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

\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''

create temp table work_before as select count(*) as n from public.work_activities;
grant select on work_before to authenticated;
insert into public.partners (id, name, code, contact_name, email, phone, city, status) values
  ('p_iota', 'Iota Education', 'IOTA', 'Ira', 'hello@iota.test', '+91 9000000001', 'Kochi', 'Active') on conflict do nothing;

-- 10 rows: 3 onboarded (one matches a partner by email, one by nothing, one twice in file), proposal/mou variants,
-- closed, unknown status, an existing agency (same email as one added in 210), a row with only a phone.
\set rows '''[{"row":2,"name":"Kappa Overseas","poc":"Kiran","phone":"9876543210","email":null,"status":"Proposal send"}, {"row":3,"name":"Lambda Study","poc":null,"phone":null,"email":"l@lambda.test","status":"MOU Send"}, {"row":4,"name":"Iota Education","poc":"Ira","phone":"9000000001","email":"hello@iota.test","status":"Onboarded"}, {"row":5,"name":"Mu Abroad","poc":"Meena","phone":"+44 20 7946 0001","email":null,"status":"Onboarded"}, {"row":6,"name":"Nu Careers","poc":null,"phone":"0471 2345678","email":null,"status":"Closed"}, {"row":7,"name":"Xi Visas","poc":"Xavier","phone":null,"email":"x@xi.test","status":"Hot lead"}, {"row":8,"name":"Ravi Overseas Pvt","poc":"Ravi","phone":null,"email":"ravi@example.com","status":"Onboarded"}, {"row":9,"name":"Omicron","poc":null,"phone":null,"email":null,"status":"Proposal Send"}, {"row":10,"name":"Kappa  overseas","poc":"Other","phone":null,"email":null,"status":"Closed"}, {"row":11,"name":null,"poc":null,"phone":"98950 11111","email":null,"status":"MOU send"}]'''

\echo '== only administrators import'
begin; select pg_temp.act_as(:po);
select pg_temp.denied(format('select public.preview_agency_import(%L)', :rows), 'a Partnership Officer cannot import', '%administrators%');
rollback;

\echo '== preview'
begin; select pg_temp.act_as(:admin);
select public.preview_agency_import(:rows) as pv \gset
select pg_temp.check((:'pv'::jsonb -> 'counts' ->> 'existing')::int = 1, 'an agency already in the list (same email) is detected, not duplicated');
select pg_temp.check((:'pv'::jsonb -> 'counts' ->> 'duplicate_in_file')::int = 1, 'a repeated name in the file (case and spaces ignored) is detected');
select pg_temp.check((:'pv'::jsonb -> 'counts' ->> 'new_linked')::int = 1, 'onboarded row linked to the partner with the same email');
select pg_temp.check((:'pv'::jsonb -> 'counts' ->> 'new_reconcile')::int = 1, 'onboarded row without a partner account is flagged for reconciliation');
select pg_temp.check((select count(*) from jsonb_array_elements(:'pv'::jsonb -> 'items') e where e ->> 'reason' like '%not recognised%') = 1, 'unknown status text is reported, not guessed');
select pg_temp.check((select count(*) from public.agency_prospects where source = 'import') = 0, 'preview changes nothing');
rollback;

\echo '== import (TEST 1, 2, 5, 8)'
begin; select pg_temp.act_as(:admin);
select public.import_agencies('agencies.xlsx', 'Sheet1', :rows, '44444444-0000-0000-0000-000000000001') as res \gset
select pg_temp.check((:'res'::jsonb ->> 'created')::int = 8 and (:'res'::jsonb ->> 'skipped')::int = 2, '8 created, 2 skipped (existing + repeated row)');
select pg_temp.check((public.import_agencies('agencies.xlsx', 'Sheet1', :rows, '44444444-0000-0000-0000-000000000001') ->> 'duplicate')::boolean, 'the same import request twice does nothing');
commit;
select pg_temp.check((select count(*) from public.agency_prospects where source = 'import') = 8, 'imported rows saved once');
select pg_temp.check((select string_agg(stage || ':' || n, ',' order by stage) from (select stage, count(*) n from public.agency_prospects where source = 'import' group by 1) x)
  = 'closed:1,mou_sent:2,new_prospect:1,onboarded:2,proposal_sent:2', 'stages normalised from the original status text (TEST 2)');
select pg_temp.check((select source_status = 'MOU Send' and source_row = 3 and source_values ->> 'email' = 'l@lambda.test' and import_id is not null
  from public.agency_prospects where company_name = 'Lambda Study'), 'original status, row, values and import kept');
select pg_temp.check((select contact_name is null and phone is null and email = 'l@lambda.test' from public.agency_prospects where company_name = 'Lambda Study'), 'missing POC and phone stay empty (nothing invented, TEST 5)');
select pg_temp.check((select phone = '+44 20 7946 0001' from public.agency_prospects where company_name = 'Mu Abroad') and (select phone = '0471 2345678' from public.agency_prospects where company_name = 'Nu Careers'),
  'phone numbers kept as written (leading zero and international code)');
select pg_temp.check((select bool_and(contact_status = 'unknown' and assigned_officer is null) from public.agency_prospects where source = 'import'), 'imports: contact status not recorded, no officer');
select pg_temp.check((select partner_id = 'p_iota' and not needs_reconciliation from public.agency_prospects where company_name = 'Iota Education'), 'matched onboarded agency linked to its partner');
select pg_temp.check((select partner_id is null and needs_reconciliation and historical_onboarded from public.agency_prospects where company_name = 'Mu Abroad'), 'unmatched onboarded agency: historical, flagged for an administrator');
select pg_temp.check((select company_name is null and phone = '98950 11111' from public.agency_prospects where source_row = 11), 'phone-only row imported');
select pg_temp.check((select count(*) from public.work_activities) = (select n from work_before), 'an import records no work for anyone (TEST 8)');
select pg_temp.check((select count(*) from public.profiles where email in ('hello@iota.test', 'x@xi.test', 'l@lambda.test')) = 0, 'no logins created');

\echo '== the whole pipeline is visible to the team (TEST 3)'
begin; select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.agency_prospects where source = 'import') = 8, 'the officer sees imported agencies');
select public.claim_agency((select id from public.agency_prospects where company_name = 'Kappa Overseas'));
select pg_temp.check((select assigned_officer = :po from public.agency_prospects where company_name = 'Kappa Overseas'), 'the officer can take an unassigned agency');
select pg_temp.denied(format('select public.claim_agency(%L)', (select id from public.agency_prospects where company_name = 'Kappa Overseas')), 'but not one that has an officer', '%already%');
select pg_temp.denied(format('select public.reconcile_agency(%L, null)', (select id from public.agency_prospects where company_name = 'Mu Abroad')), 'officers cannot reconcile', '%administrators%');
commit;
begin; select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.agency_prospects) = 0, 'staff without the permission still see none');
rollback;

\echo '== report attribution (TEST 7)'
create temp table w2 as select count(*) filter (where activity_type = 'partner_contact') c, count(*) filter (where activity_type = 'partner_call') k from public.work_activities where employee_id = :po;
begin; select pg_temp.act_as(:po);
-- an imported agency already at Proposal sent: first call is a follow-up, not a new contact
select public.log_agency_activity((select id from public.agency_prospects where company_name = 'Kappa Overseas'), 'call', 'Followed up', null, gen_random_uuid());
-- a new agency: first attempt is the contact; the next call is a follow-up call
select public.create_agency_prospect('{"company_name":"Pi Partners"}', gen_random_uuid()) ->> 'id' as pi \gset
select pg_temp.check((select contact_status = 'unknown' from public.agency_prospects where id = :'pi'), 'a new agency starts with no contact status');
select public.log_agency_activity(:'pi', 'contact_attempt', 'No answer', null, gen_random_uuid());
select pg_temp.check((select contact_status = 'not_connected' and first_contact_at is not null from public.agency_prospects where id = :'pi'), 'an attempt records Not connected');
select public.log_agency_activity(:'pi', 'call', 'Spoke', null, gen_random_uuid());
commit;
select pg_temp.check((select count(*) filter (where activity_type = 'partner_contact') - (select c from w2) = 1
  and count(*) filter (where activity_type = 'partner_call') - (select k from w2) = 2 from public.work_activities where employee_id = :po),
  'one new contact, two follow-up calls — each counted once');

\echo '== closing and reopening (TEST 11)'
begin; select pg_temp.act_as(:po);
select public.set_agency_stage(:'pi', 'closed', 'Not interested');
select public.set_agency_stage(:'pi', 'discussion', 'Called back');
select pg_temp.check((select count(*) from public.agency_activities where prospect_id = :'pi' and kind = 'reactivated') = 1, 'reopening a closed agency is recorded');
select pg_temp.check((select count(*) from public.agency_prospects where id = :'pi') = 1, 'closed agencies stay in the list');
commit;

\echo '== reconciliation'
begin; select pg_temp.act_as(:admin);
select public.reconcile_agency((select id from public.agency_prospects where company_name = 'Mu Abroad'), null, 'No portal account; kept historical');
select pg_temp.check((select not needs_reconciliation and partner_id is null and historical_onboarded from public.agency_prospects where company_name = 'Mu Abroad'), 'kept historical after review');
select pg_temp.denied(format('select public.reconcile_agency(%L, %L)', (select id from public.agency_prospects where company_name = 'Lambda Study'), 'p_iota'),
  'a partner already linked to another agency cannot be linked again', '%already linked%');
rollback;

\echo '== re-import'
begin; select pg_temp.act_as(:admin);
select pg_temp.check((select (public.preview_agency_import(:rows) -> 'counts' ->> 'existing')::int) = 9, 'importing the same sheet again finds every agency (no duplicates)');
rollback;
