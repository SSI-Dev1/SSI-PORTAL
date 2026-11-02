-- Work activities recorded from CRM actions, quick logs and corrections (0017).
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
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set app '''00000000-0000-0000-0000-0000000000f4'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''

\echo '== CRM actions become work activities'
begin;
select pg_temp.act_as(:super);
update public.applications set assigned_to = :app, status = 'Draft' where id = 'a1';
select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'application_received' and application_id = 'a1') = 1, 'assignment counts as an application received by the assignee');
select pg_temp.check((select count(*) from public.work_activities where employee_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'Super Admin without an employee record is not tracked');
update public.applications set status = 'Submitted' where id = 'a1';
update public.applications set status = 'Draft' where id = 'a1';
update public.applications set status = 'Submitted' where id = 'a1';
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'application_submitted') = 1, 'submitting the same application again the same day counts once');
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'application_returned') = 1, 'returned to draft recorded');
select pg_temp.check((select from_status = 'Draft' and to_status = 'Submitted' and report_date = public.company_today() and designation_id = 'application_team'
  from public.work_activities where activity_type = 'application_submitted'), 'activity keeps previous / new status, reporting date and designation');
update public.applications set status = 'Conditional Offer' where id = 'a1';
update public.applications set status = 'Unconditional Offer' where id = 'a1';
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'offer_received') = 1, 'conditional then unconditional offer is one offer received');
update public.applications set status = 'Visa Lodged' where id = 'a1';
update public.applications set status = 'Visa Granted' where id = 'a1';
select pg_temp.check((select count(*) from public.work_activities where activity_type in ('visa_lodged', 'visa_approved', 'application_completed')) = 3, 'visa lodged, approved and completed recorded');
update public.applications set intake = intake where id = 'a1';
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'application_status') = 6, 'a save without a status change records nothing (6 distinct transitions)');
select pg_temp.check((select (m -> 'pr_new_received' ->> 'value')::int = 1 and (m -> 'pr_processed_submitted' ->> 'value')::int = 1 and (m -> 'of_received' ->> 'value')::int = 1
  and (m -> 'tk_visa_approvals' ->> 'value')::int = 1 and (m -> 'tk_visa_followups' ->> 'value')::int = 1 and (m -> 'pr_completed' ->> 'value')::int = 1
  and (m -> 'of_followups' ->> 'value')::int = 0 from (select public.report_metrics('application_team', public.company_today()) m) x), 'Application Team figures come from these activities');
select pg_temp.check((select (public.report_metrics('application_team', public.company_today()) -> 'pr_new_received' -> 'activity_ids') = jsonb_build_array((select id from public.work_activities where activity_type = 'application_received'))), 'each figure lists the activities behind it');

\echo '== tasks and documents'
insert into public.tasks (id, title, due, assigned_to) values ('t-work', 'Chase CAS', now(), :app);
update public.tasks set done = true where id = 't-work';
update public.tasks set done = false where id = 't-work';
update public.tasks set done = true where id = 't-work';
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'task_completed') = 1, 'completing a task twice the same day counts once');
rollback;

\echo '== workload is the current state, not today''s work'
begin;
select pg_temp.act_as(:super);
update public.applications set assigned_to = :app, status = 'Pending Assessment' where id = 'a1';
select pg_temp.act_as(:app);
select pg_temp.check((select (public.report_metrics('application_team', public.company_today()) -> 'pr_pending' ->> 'value')::int = 1), 'pending = applications assigned to me still pending');
select pg_temp.check((select (public.report_metrics('application_team', public.company_today()) -> 'pr_pending' ->> 'kind') = 'workload'), 'pending is marked as workload');
rollback;

\echo '== corrections and access'
begin;
select pg_temp.act_as(:super);
update public.applications set assigned_to = :app where id = 'a1';
select pg_temp.act_as(:app);
select public.log_work_activity('deposit_confirmed', 2, 'Two deposits', gen_random_uuid());
select pg_temp.denied($$select public.void_work_activity((select id from public.work_activities where activity_type = 'application_received'), 'not mine')$$, 'employees cannot void CRM activities', '%manager or HR%');
select public.void_work_activity((select id from public.work_activities where activity_type = 'deposit_confirmed'), 'Logged by mistake');
select pg_temp.check((select (public.report_metrics('application_team', public.company_today()) -> 'tk_deposits_confirmed' ->> 'value')::int = 0), 'voided activity no longer counts');
select pg_temp.check((select voided_at is not null and void_reason = 'Logged by mistake' from public.work_activities where activity_type = 'deposit_confirmed'), 'voided activity is kept with its reason');
select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.work_activities) = 0, 'colleagues outside the team cannot see the activities');
select pg_temp.denied($$select public.void_work_activity((select min(id) from public.work_activities), 'x')$$, 'colleagues cannot void others'' work');
select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.work_activities where employee_id = '00000000-0000-0000-0000-0000000000f4') >= 2, 'manager sees the team''s activities');
select public.void_work_activity((select id from public.work_activities where activity_type = 'application_received'), 'Assigned by mistake');
select pg_temp.check((select voided_by = '00000000-0000-0000-0000-0000000000f2' from public.work_activities where activity_type = 'application_received'), 'manager corrected a CRM activity');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.work_activities) = 0, 'external partners see no work activities');
select pg_temp.denied($$select public.log_work_activity('partner_call', 1, null, gen_random_uuid())$$, 'external partners cannot log work');
rollback;

\echo 'ALL SECURITY TESTS PASSED'
