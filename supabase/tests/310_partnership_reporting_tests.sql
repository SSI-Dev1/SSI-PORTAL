-- Partnership reporting: report heads, nine agency actions, LinkedIn stages, rollover, university partnerships (0044). Synthetic rows only.
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

create or replace function pg_temp.m(k text) returns integer language plpgsql as $$
declare cur jsonb;
begin
  if current_user = 'authenticated' then cur := public.report_metrics('partnership_officer', public.company_today());
  else cur := public.compute_report_metrics('00000000-0000-0000-0000-0000000000f3', 'partnership_officer', public.company_today()); end if;
  return (cur -> k ->> 'value')::int;
end $$;

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''

begin;
select pg_temp.trusted();
update public.employees set designation_id = 'partnership_officer' where id = :po;
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach')
where id = :po and not ('agency_outreach' = any (coalesce(permissions, public.role_default_permissions(role))));
create temp table b as select k, pg_temp.m(k) v from unnest(array['po_new_partners_contacted', 'po_followups_attempted', 'po_followup_calls', 'po_meetings_fixed',
  'po_visits_done', 'po_proposals_sent', 'po_pending', 'po_pending_followups', 'li_new_connections', 'li_followup_messages', 'li_positive_responses', 'li_closed',
  'up_new_universities_contacted', 'up_partnerships_onboarded', 'up_followups']) k;
create or replace function pg_temp.d(key text) returns integer language sql as $$ select pg_temp.m(key) - (select v from b where k = key) $$;
grant select on b to authenticated;

\echo '== template'
select pg_temp.check((select version = 2 from public.report_templates where id = 'partnership_officer' order by version desc limit 1)
  and (select count(*) from public.report_metric_sources where template_id = 'partnership_officer' and field_key in ('po_followups_attempted', 'po_visits_done', 'po_pending_followups')) = 3,
  'report v2 has Follow-ups attempted, Visits done and Pending follow-ups');

\echo '== TEST 1 / 2: New Partner Contacted only on Connected'
select pg_temp.act_as(:po);
select (public.create_agency_prospect('{"company_name": "Report One", "phone": "9200000001", "contact_status": "connected"}'::jsonb, gen_random_uuid()) ->> 'id') as a1 \gset
select (public.create_agency_prospect('{"company_name": "Report Two", "phone": "9200000002"}'::jsonb, gen_random_uuid()) ->> 'id') as a2 \gset
select pg_temp.check(pg_temp.d('po_new_partners_contacted') = 1, 'added and Connected: +1; added without connecting: not counted');
select pg_temp.check(pg_temp.d('po_pending') = 1, 'the unconnected agency is Pending');

\echo '== TEST 3 / 4: contact attempts and Call Done'
select public.agency_action(:'a2', 'contact_attempt', '{"note": "no answer"}'::jsonb, gen_random_uuid());
select gen_random_uuid() as rq \gset
select public.agency_action(:'a2', 'contact_attempt', '{"note": "busy"}'::jsonb, :'rq');
select public.agency_action(:'a2', 'contact_attempt', '{"note": "busy"}'::jsonb, :'rq');
select pg_temp.check(pg_temp.d('po_followups_attempted') = 2, 'two attempts open (a repeated click is ignored)');
select pg_temp.check(pg_temp.d('po_new_partners_contacted') = 1, 'attempts are not New Partner Contacted');
select (public.agency_action(:'a2', 'call', '{"note": "spoke"}'::jsonb, gen_random_uuid()) ->> 'attempt_resolved')::boolean as res1 \gset
select pg_temp.check(:'res1'::boolean and pg_temp.d('po_followups_attempted') = 1 and pg_temp.d('po_followup_calls') = 1, 'Call Done: calls +1, open attempts -1');
select public.agency_action(:'a2', 'call', '{}'::jsonb, gen_random_uuid());
select public.agency_action(:'a2', 'call', '{}'::jsonb, gen_random_uuid());
select pg_temp.check(pg_temp.d('po_followups_attempted') = 0 and pg_temp.d('po_followup_calls') = 3, 'open attempts never go below zero; calls still count');
select pg_temp.check((select count(*) from public.agency_activities where prospect_id = :'a2' and kind = 'contact_attempt') = 2, 'attempt history is kept');

\echo '== TEST 5 / 12: follow-ups, completion and day-end rollover'
select (public.agency_action(:'a1', 'follow_up', jsonb_build_object('due_date', public.company_today(), 'due_time', '15:30', 'note', 'send rates'), gen_random_uuid()) ->> 'task_id') as f1 \gset
select (public.agency_action(:'a2', 'follow_up', jsonb_build_object('due_date', public.company_today() + 2), gen_random_uuid()) ->> 'task_id') as f2 \gset
select pg_temp.check(pg_temp.d('po_pending_followups') = 1, 'a follow-up due today is pending; a later one is not yet');
select pg_temp.check((select next_follow_up = public.company_today() from public.agency_prospects where id = :'a1'), 'agency shows the next follow-up');
select pg_temp.denied(format($$select public.agency_action(%L, 'follow_up', '{}'::jsonb, gen_random_uuid())$$, :'a1'), 'a follow-up needs a date', '%date%');
select pg_temp.trusted();
select public.rollover_pending_work(public.company_today()) as ro \gset
select pg_temp.check((:'ro'::jsonb ->> 'carried')::int >= 1 and (select carried_over_to > public.company_today() and carry_count = 1 and due_date = public.company_today() and status = 'open'
  from public.agency_tasks where id = :'f1'), 'day-end: the open follow-up moves to the next working day, same row, original due date');
select public.rollover_pending_work(public.company_today());
select pg_temp.check((select carry_count = 1 from public.agency_tasks where id = :'f1') and (select count(*) from public.agency_tasks where prospect_id = :'a1') = 1,
  'running it again the same day changes nothing, no duplicate task');
select pg_temp.act_as(:po);
select pg_temp.check((select (w -> 'tasks') @> jsonb_build_array(jsonb_build_object('id', :'f1')) from public.my_pending_work() w), 'the carried follow-up is in the employee''s task queue');
select public.agency_action(:'a1', 'follow_up_done', jsonb_build_object('task_id', :'f1', 'note', 'done'), gen_random_uuid());
select pg_temp.check((select status = 'done' and completed_activity is not null from public.agency_tasks where id = :'f1') and pg_temp.d('po_pending_followups') = 0
  and pg_temp.d('po_followup_calls') = 4, 'Follow-up Completed: task cleared, calls +1');
select pg_temp.check((select next_follow_up = public.company_today() + 2 from public.agency_prospects where id = :'a2'), 'other agency keeps its own follow-up');

\echo '== TEST 6 / 7 / 8: meetings and visits'
select pg_temp.denied(format($$select public.agency_action(%L, 'schedule_meeting', jsonb_build_object('due_date', public.company_today()), gen_random_uuid())$$, :'a1'),
  'Schedule Meeting needs attendee and time', '%attendee%');
select (public.agency_action(:'a1', 'schedule_meeting', jsonb_build_object('attendee', 'Mr Rao', 'due_date', public.company_today(), 'due_time', '16:00'), gen_random_uuid()) ->> 'task_id') as mt \gset
select pg_temp.check(pg_temp.d('po_meetings_fixed') = 1, 'Meeting Fixed +1');
select pg_temp.check((select reminded_on = public.company_today() from public.agency_tasks where id = :'mt'), 'a meeting today gets its day-of reminder at once');
select public.agency_action(:'a1', 'meeting', jsonb_build_object('outcome', 'Agreed to proposal', 'attendees', 'Mr Rao'), gen_random_uuid());
select pg_temp.check(pg_temp.d('po_meetings_fixed') = 1 and (select status = 'done' from public.agency_tasks where id = :'mt'), 'Record Meeting saves the outcome, closes the scheduled meeting, no extra Meeting Fixed');
select (public.agency_action(:'a2', 'schedule_meeting', jsonb_build_object('attendee', 'Ms Iyer', 'due_date', public.company_today(), 'due_time', '10:00', 'mode', 'visit'), gen_random_uuid()) ->> 'task_id') as vt \gset
select public.agency_action(:'a2', 'visit', '{"note": "visited office"}'::jsonb, gen_random_uuid());
select pg_temp.check(pg_temp.d('po_visits_done') = 1 and (select status = 'done' from public.agency_tasks where id = :'vt'), 'Visited Partner: Visits Done +1 and the visit reminder clears');
select pg_temp.denied(format($$select public.agency_action(%L, 'visit', jsonb_build_object('visit_date', public.company_today() + 1), gen_random_uuid())$$, :'a2'), 'a visit cannot be recorded in advance', '%happened%');

\echo '== TEST 11: notes'
create temp table w0 as select count(*) n from public.work_activities;
select public.agency_action(:'a1', 'note', '{"note": "Prefers WhatsApp"}'::jsonb, gen_random_uuid());
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'a note changes no metric');
select pg_temp.denied(format($$select public.agency_action(%L, 'note', '{}'::jsonb, gen_random_uuid())$$, :'a1'), 'an empty note is refused', '%note%');

\echo '== older clients still work'
select public.log_agency_activity(:'a2', 'call', 'via old entry point', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('po_followup_calls') = 5, 'log_agency_activity still records a call');

\echo '== TEST 9: Proposal Sent counts the first dispatch per agency'
select pg_temp.trusted();
insert into public.agency_proposals (id, reference, prospect_id, status, company_name, recipient_name, recipient_email, country, arrangement, terms_title, terms_body, created_by, request_key)
values ('d0000000-0000-4000-8000-000000000001', 'PP-T-1', :'a1', 'sending', 'Report One', 'R', 'r@one.test', 'India', '{"kind":"tier","tier_label":"T1","universities":[]}', 't', 'b', :po, gen_random_uuid()),
       ('d0000000-0000-4000-8000-000000000002', 'PP-T-2', :'a1', 'sending', 'Report One', 'R', 'r@one.test', 'India', '{"kind":"tier","tier_label":"T1","universities":[]}', 't', 'b', :po, gen_random_uuid()),
       ('d0000000-0000-4000-8000-000000000003', 'PP-T-3', :'a2', 'sending', 'Report Two', 'R', 'r@two.test', 'India', '{"kind":"tier","tier_label":"T1","universities":[]}', 't', 'b', :po, gen_random_uuid());
select public.finish_agency_proposal_send('d0000000-0000-4000-8000-000000000003', :po, false, null, 'bounced');
select pg_temp.check(pg_temp.d('po_proposals_sent') = 0, 'a failed dispatch is not counted');
select public.finish_agency_proposal_send('d0000000-0000-4000-8000-000000000001', :po, true, 'm1', null);
select public.finish_agency_proposal_send('d0000000-0000-4000-8000-000000000001', :po, true, 'm1', null);
select public.finish_agency_proposal_send('d0000000-0000-4000-8000-000000000002', :po, true, 'm2', null);
select pg_temp.check(pg_temp.d('po_proposals_sent') = 1, 'first successful proposal counted once; a retry and a later version are not');

\echo '== TEST 13-16: LinkedIn'
select pg_temp.act_as(:po);
select (public.create_linkedin_prospect('{"name": "Name Only"}'::jsonb, gen_random_uuid()) ->> 'id') as l1 \gset
select pg_temp.check(pg_temp.d('li_new_connections') = 0, 'a name-only prospect saves and is not a connection');
select public.set_linkedin_contact_status(:'l1', 'connected', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_new_connections') = 1, 'marked Connected: +1');
select public.log_linkedin_activity(:'l1', 'follow_up', 'sent message', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_followup_messages') = 1, 'Follow-up Completed: follow-up message +1');
select public.set_linkedin_stage(:'l1', 'interested', 'keen', null, gen_random_uuid()) as pr \gset
select pg_temp.check((:'pr'::jsonb ->> 'conversion_pending')::boolean and :'pr'::jsonb -> 'missing' ? 'agency / company name'
  and (select conversion_pending and status = 'interested' and agency_id is null from public.linkedin_prospects where id = :'l1'),
  'positive response without company / phone: conversion is pending, details are asked for, nothing invented');
select pg_temp.check(pg_temp.d('li_positive_responses') = 1, 'positive response counted');
select (public.create_linkedin_prospect('{"name": "Full Lead", "company_name": "Full Lead Overseas", "phone": "+91 92000 00099"}'::jsonb, gen_random_uuid()) ->> 'id') as l2 \gset
select public.set_linkedin_stage(:'l2', 'interested', null, null, gen_random_uuid()) as pr2 \gset
select pg_temp.check(:'pr2'::jsonb ->> 'status' = 'converted' and (select status = 'converted' and agency_id is not null and not conversion_pending from public.linkedin_prospects where id = :'l2')
  and (select a.source = 'linkedin' and a.company_name = 'Full Lead Overseas' and a.contact_name = 'Full Lead' from public.agency_prospects a join public.linkedin_prospects l on l.agency_id = a.id where l.id = :'l2'),
  'positive response with the details: moved to the Agency List automatically, details kept');
select (public.create_linkedin_prospect('{"name": "Closing Lead"}'::jsonb, gen_random_uuid()) ->> 'id') as l3 \gset
select public.set_linkedin_stage(:'l3', 'not_interested', 'no', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_closed') = 1 and (select status = 'not_interested' from public.linkedin_prospects where id = :'l3'), 'Closed: lead closed and counted');
select pg_temp.denied(format($$select public.set_linkedin_stage(%L, 'converted', null, null, gen_random_uuid())$$, :'l3'), 'only the defined stages', '%Unknown stage%');

\echo '== TEST 19: University Partnerships'
select pg_temp.denied($$select public.save_university_partnership(null, '{"country": "UK"}'::jsonb, gen_random_uuid())$$, 'institution name required', '%institution name%');
select gen_random_uuid() as ur \gset
select (public.save_university_partnership(null, '{"institution_name": "Northbridge University", "country": "UK", "contact_person": "Dr Lee", "designation": "Intl Director", "email": "lee@nb.test", "status": "contacted", "notes": "Met at fair. Wants Kerala agents."}'::jsonb, :'ur') ->> 'id') as up \gset
select pg_temp.check((select (r ->> 'duplicate')::boolean from public.save_university_partnership(null, '{"institution_name": "Northbridge University"}'::jsonb, :'ur') r), 'a repeated save creates no duplicate');
select public.add_university_partnership_note(:'up', 'Sent partnership deck', true);
select public.save_university_partnership(:'up', '{"status": "onboarded", "note": "Agreement signed"}'::jsonb, null);
select public.save_university_partnership(:'up', '{"status": "onboarded"}'::jsonb, null);
select pg_temp.check(pg_temp.d('up_new_universities_contacted') = 1 and pg_temp.d('up_followups') = 1 and pg_temp.d('up_partnerships_onboarded') = 1, 'contact, follow-up and onboarding each counted once');
select pg_temp.check((select notes like 'Met at fair%' from public.university_partnerships where id = :'up') and (select count(*) from public.university_partnership_notes where partnership_id = :'up') = 4,
  'free-text notes and the update history are kept');

\echo '== permissions'
select pg_temp.check(not ('partner_accounts' = any (coalesce((select permissions from public.profiles where id = :po), '{}'))), 'no one gets "partner accounts" automatically');
select pg_temp.trusted();
update public.profiles set permissions = array_append(permissions, 'partner_accounts') where id = :po;
select pg_temp.check((select 'partner_accounts' = any (permissions) from public.profiles where id = :po), 'a Super Admin can grant "partner accounts" to one employee');
select pg_temp.act_as(:app);
select pg_temp.denied(format($$select public.agency_action(%L, 'call', '{}'::jsonb, gen_random_uuid())$$, :'a1'), 'staff without Agencies access cannot log', '%Not allowed%');
select pg_temp.check(public.my_pending_work() is null and (select count(*) from public.agency_tasks) = 0 and (select count(*) from public.university_partnerships) = 0, 'and see no tasks or university partnerships');
select pg_temp.denied($$select public.rollover_pending_work()$$, 'employees cannot run the rollover', '%Not allowed%');
select pg_temp.act_as(:partner);
select pg_temp.denied($$select public.save_university_partnership(null, '{"institution_name": "X Uni"}'::jsonb, gen_random_uuid())$$, 'partners cannot add university partnerships', '%Not allowed%');
rollback;
