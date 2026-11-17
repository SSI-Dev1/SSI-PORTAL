-- 0055: historical onboarding approval and Daily Work Report snapshots. Synthetic rows; rolls back.
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
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set pso   '''00000000-0000-0000-0000-0000000000f5'''

begin;
select pg_temp.trusted();
update public.employees set designation_id = 'partnership_officer' where id = :po;
update public.profiles set permissions = array['agency_outreach', 'partners', 'tasks'] where id = :po;
insert into public.agency_prospects (id, reference, company_name, contact_name, email, phone, stage, assigned_officer, created_by, source) values
  ('cccccccc-0000-4000-8000-000000000001', 'AG-HIST-1', 'Old Partner Overseas', 'Ravi', 'ravi@oldpartner.test', '+91 90000 11111', 'proposal_sent', :po, :super, 'import'),
  ('cccccccc-0000-4000-8000-000000000002', 'AG-HIST-2', 'Second Old Partner', 'Meera', 'meera@second.test', '+91 90000 22222', 'discussion', :po, :super, 'manual'),
  ('cccccccc-0000-4000-8000-000000000003', 'AG-NEW-1', 'Brand New Agency', 'Anu', 'anu@new.test', '+91 90000 33333', 'new_prospect', :po, :super, 'manual');
create temp table w0 as select count(*) n from public.work_activities;
grant select on w0 to authenticated;

\echo '== TEST 13: new agencies still cannot be set Onboarded directly'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.set_agency_stage('cccccccc-0000-4000-8000-000000000003', 'onboarded')$$, 'changing the stage to Onboarded is refused', '%set by the workflow%');

\echo '== TEST 9: a Partnership Officer requests a review'
select pg_temp.denied($$select public.request_historical_onboarding('cccccccc-0000-4000-8000-000000000001', 'short')$$, 'a reason is required', '%at least 10%');
select public.request_historical_onboarding('cccccccc-0000-4000-8000-000000000001', 'Onboarded in 2024 under the old MOU process', 'MOU scan in shared drive');
select pg_temp.check((select historical_status = 'requested' and stage = 'proposal_sent' from public.agency_prospects where id = 'cccccccc-0000-4000-8000-000000000001'),
  'the request records the review, the stage does not change');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where user_id = :super and title = 'Historical onboarding review requested') >= 1, 'administrators are notified');
select pg_temp.act_as(:po);

\echo '== TEST 14: only administrators approve'
select pg_temp.denied($$select public.review_historical_onboarding(array['cccccccc-0000-4000-8000-000000000001']::uuid[], 'approve', 'Approved under old process')$$,
  'the officer cannot approve', '%authorised administrators%');
select pg_temp.act_as(:pso);
select pg_temp.denied($$select public.review_historical_onboarding(array['cccccccc-0000-4000-8000-000000000001']::uuid[], 'approve', 'Approved under old process')$$,
  'a Partner Success Officer cannot approve', '%authorised administrators%');

\echo '== TEST 10/15/16: Super Admin approves; no login, no fake work'
select pg_temp.act_as(:super);
select public.review_historical_onboarding(array['cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003']::uuid[], 'approve',
  'Verified against the 2024 MOU register', 'MOU-2024-017', null) as res \gset
select pg_temp.trusted();
select pg_temp.check((select stage = 'onboarded' and onboarding_type = 'historical' and historical_status = 'approved' and historical_onboarded
                             and historical_reviewed_by = :super and historical_original_date is null and historical_evidence = 'MOU-2024-017'
                      from public.agency_prospects where id = 'cccccccc-0000-4000-8000-000000000001'), 'approved: Onboarded (historical), reviewer recorded, unknown original date kept unknown');
select pg_temp.check((select partner_id is not null from public.agency_prospects where id = 'cccccccc-0000-4000-8000-000000000001')
                     and (select onboarding_source = 'historical' and portal_enabled = false from public.partners o
                          join public.agency_prospects a on a.partner_id = o.id where a.id = 'cccccccc-0000-4000-8000-000000000001'),
  'TEST 11: appears in Clients & Branches as a historical client with the portal off');
select pg_temp.check(not exists (select 1 from public.profiles p join public.agency_prospects a on a.partner_id = p.partner_id where a.id = 'cccccccc-0000-4000-8000-000000000001'),
  'TEST 15: no login is created');
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'TEST 16: no employee work is recorded by the reconciliation');
select pg_temp.check(not exists (select 1 from public.agency_proposals where prospect_id = 'cccccccc-0000-4000-8000-000000000001')
                     and (select registration_id is null from public.agency_prospects where id = 'cccccccc-0000-4000-8000-000000000001'),
  'no proposal, registration or agreement is invented');
select pg_temp.check((select count(*) from public.audit_log where action = 'historical_onboarding_approve' and entity_id = 'cccccccc-0000-4000-8000-000000000001') = 1, 'audit history kept');
select pg_temp.check((:'res'::jsonb -> 'done') @> '[{"id":"cccccccc-0000-4000-8000-000000000003"}]' or (:'res'::jsonb -> 'done') @> '[{"id":"cccccccc-0000-4000-8000-000000000001"}]',
  'bulk review reports what it did');

\echo '== flag for verification; already onboarded / in registration are refused'
select pg_temp.act_as(:super);
select public.review_historical_onboarding(array['cccccccc-0000-4000-8000-000000000002']::uuid[], 'flag', 'No proposal or MOU evidence found yet');
select pg_temp.trusted();
select pg_temp.check((select historical_status = 'flagged' and stage = 'discussion' and needs_reconciliation from public.agency_prospects where id = 'cccccccc-0000-4000-8000-000000000002'),
  'flagged for verification: no approval invented, stage unchanged');
select pg_temp.check(public.historical_onboarding_block('cccccccc-0000-4000-8000-000000000001') = 'This agency is already onboarded', 'an onboarded agency cannot be requested again');

\echo '== TEST 8: a submitted Daily Work Report freezes its timeline'
insert into public.work_activities (employee_id, activity_type, source, entity_type, entity_id, report_date, dedupe_key)
values (:po, 'partner_call', 'logged', 'agency', 'cccccccc-0000-4000-8000-000000000002', (public.company_today() - 3), 'snap-test-1');
insert into public.daily_reports (id, employee_id, template_id, template_version, designation_id, report_date, status, metrics, notes)
values ('rep-snap-1', :po, 'partnership_officer', 1, 'partnership_officer', (public.company_today() - 3), 'Submitted', '{}', '{}');
select pg_temp.check((select jsonb_array_length(timeline_snapshot) >= 1 and timeline_snapshot @> '[{"activity_type":"partner_call","entity_name":"Second Old Partner"}]'
                      from public.daily_reports where id = 'rep-snap-1'), 'the timeline is stored with the submitted report');
insert into public.work_activities (employee_id, activity_type, source, report_date, dedupe_key) values (:po, 'partner_call', 'logged', (public.company_today() - 3), 'snap-test-2');
update public.daily_reports set review_comment = 'seen' where id = 'rep-snap-1';
select pg_temp.check((select jsonb_array_length(timeline_snapshot) from public.daily_reports where id = 'rep-snap-1')
                     < (select count(*) from public.work_activities where employee_id = :po and report_date = (public.company_today() - 3)),
  'later activity does not rewrite the submitted snapshot');
rollback;
