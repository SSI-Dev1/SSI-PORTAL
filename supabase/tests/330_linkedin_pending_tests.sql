-- LinkedIn: contact status vs follow-up, pending counts, next-day reminders (0046). Synthetic rows only.
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
\set mgr     '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''

begin;
select pg_temp.trusted();
update public.employees set designation_id = 'partnership_officer' where id = :po;
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach')
where id in (:po, :mgr) and not ('agency_outreach' = any (coalesce(permissions, public.role_default_permissions(role))));
create temp table b as select k, pg_temp.m(k) v from unnest(array['li_new_connections', 'li_followup_messages', 'li_pending', 'li_pending_followups', 'li_closed']) k;
create or replace function pg_temp.d(key text) returns integer language sql as $$ select pg_temp.m(key) - (select v from b where k = key) $$;
grant select on b to authenticated;

\echo '== TEST 1 / 5: name only'
select pg_temp.act_as(:po);
select (public.create_linkedin_prospect('{"name": "Dan"}'::jsonb, gen_random_uuid()) ->> 'id') as dan \gset
select pg_temp.check((select contact_status = 'unknown' and status = 'not_contacted' from public.linkedin_prospects where id = :'dan'), 'Dan: Not recorded');
select pg_temp.check(pg_temp.d('li_pending') = 1 and pg_temp.d('li_new_connections') = 0, 'Dan is Pending at once; no connection counted');
select pg_temp.check((select (w ->> 'linkedin_pending_contacts')::int >= 1 from public.my_pending_work() w), 'and in the employee''s pending summary');

\echo '== TEST 2: Not connected'
select public.set_linkedin_contact_status(:'dan', 'not_connected', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_pending') = 1 and pg_temp.d('li_new_connections') = 0, 'Not connected: still Pending, no connection');

\echo '== TEST 3: Follow-up Completed never means Connected'
select public.log_linkedin_activity(:'dan', 'follow_up', 'sent message, no reply', null, gen_random_uuid());
select pg_temp.check((select contact_status = 'not_connected' from public.linkedin_prospects where id = :'dan'), 'contact status stays Not connected');
select pg_temp.check(pg_temp.d('li_followup_messages') = 1 and pg_temp.d('li_new_connections') = 0 and pg_temp.d('li_pending') = 1,
  'follow-up message +1; connections unchanged; Dan still a pending contact');
select (public.create_linkedin_prospect('{"name": "Never Contacted"}'::jsonb, gen_random_uuid()) ->> 'id') as nc \gset
select public.log_linkedin_activity(:'nc', 'follow_up', null, null, gen_random_uuid());
select pg_temp.check((select contact_status = 'unknown' from public.linkedin_prospects where id = :'nc') and pg_temp.d('li_new_connections') = 0,
  'a follow-up on a Not recorded prospect keeps it Not recorded and is not a connection (the reported bug)');
select public.set_linkedin_stage(:'nc', 'contacted', null, null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_new_connections') = 0, 'stage Contacted (outreach sent) is not a connection either');

\echo '== follow-up tasks are separate from pending contacts'
select public.log_linkedin_activity(:'dan', 'follow_up_date', null, public.company_today(), gen_random_uuid());
select pg_temp.check(pg_temp.d('li_pending_followups') = 1, 'a follow-up due today is a pending follow-up');
select public.log_linkedin_activity(:'dan', 'follow_up', 'tried again', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_pending_followups') = 0 and pg_temp.d('li_pending') = 2 and (select next_follow_up is null from public.linkedin_prospects where id = :'dan'),
  'completed: the follow-up leaves the queue; Dan (not connected) stays a pending contact');
select public.log_linkedin_activity(:'dan', 'follow_up', 'next try booked', public.company_today() + 2, gen_random_uuid());
select pg_temp.check((select next_follow_up = public.company_today() + 2 from public.linkedin_prospects where id = :'dan') and pg_temp.d('li_pending_followups') = 0,
  'a new next follow-up is one date on the same prospect (no duplicate tasks)');

\echo '== TEST 4: overnight'
select public.log_linkedin_activity(:'dan', 'follow_up', null, null, gen_random_uuid());
select pg_temp.trusted();
select public.rollover_pending_work(public.company_today()) as r1 \gset
select pg_temp.check((select next_follow_up > public.company_today() and next_follow_up_auto from public.linkedin_prospects where id = :'dan')
  and (select next_follow_up > public.company_today() from public.linkedin_prospects where id = :'nc'),
  'day-end: unresolved prospects get one next-working-day follow-up');
select public.rollover_pending_work(public.company_today()) as r2 \gset
select pg_temp.check((:'r2'::jsonb ->> 'linkedin_scheduled')::int = 0
  and (select count(*) from public.linkedin_activities where prospect_id = :'dan' and kind = 'follow_up_date' and detail ->> 'auto' = 'true') = 1,
  'running it again schedules nothing more (no duplicate reminders)');
update public.linkedin_prospects set next_follow_up = public.company_today() where id = :'dan';
select public.send_task_reminders();
select public.send_task_reminders();
select pg_temp.check((select count(*) from public.notifications where user_id = :po::uuid and title = 'LinkedIn follow-ups due') = 1, 'one LinkedIn reminder per employee per day');

\echo '== TEST 6: Connected'
select pg_temp.act_as(:po);
select public.set_linkedin_contact_status(:'dan', 'connected', 'replied on LinkedIn', gen_random_uuid());
select public.set_linkedin_contact_status(:'dan', 'not_connected', null, gen_random_uuid());
select public.set_linkedin_contact_status(:'dan', 'connected', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_new_connections') = 1 and pg_temp.d('li_pending') = 1, 'Connected counted once; pending contacts down by one');
select pg_temp.check((select count(*) from public.linkedin_activities where prospect_id = :'dan' and kind = 'follow_up') = 4, 'follow-up history kept');

\echo '== TEST 7: back to Not recorded'
select public.set_linkedin_contact_status(:'dan', 'unknown', 'marked by mistake', gen_random_uuid());
select pg_temp.check(pg_temp.d('li_pending') = 2 and pg_temp.d('li_new_connections') = 1, 'Not recorded again: Pending at once; the earlier connection event stays in history');

\echo '== closed'
select public.set_linkedin_stage(:'nc', 'not_interested', 'no', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_closed') = 1 and pg_temp.d('li_pending') = 1 and (select next_follow_up is null from public.linkedin_prospects where id = :'nc'),
  'closed: counted, out of pending and out of the follow-up queue');

\echo '== TEST 11: agency Follow-up Completed / Call Done never mean Connected'
select (public.create_agency_prospect('{"company_name": "Pending Agency"}'::jsonb, gen_random_uuid()) ->> 'id') as ag \gset
select public.agency_action(:'ag', 'follow_up', jsonb_build_object('due_date', public.company_today()), gen_random_uuid());
select public.agency_action(:'ag', 'follow_up_done', '{}'::jsonb, gen_random_uuid());
select public.agency_action(:'ag', 'call', '{}'::jsonb, gen_random_uuid());
select pg_temp.check((select contact_status = 'unknown' from public.agency_prospects where id = :'ag'), 'agency stays Not recorded after follow-up completed and call done');
select public.agency_action(:'ag', 'contact_attempt', '{}'::jsonb, gen_random_uuid());
select pg_temp.check((select contact_status = 'not_connected' from public.agency_prospects where id = :'ag'), 'a contact attempt records Not connected, never Connected');

\echo '== TEST 12: Senior IRM report'
select pg_temp.check((select (sections::text like '%li_pending_followups%') from public.report_templates where id = 'senior_recruitment_manager' order by version desc limit 1)
  and (select count(*) from public.report_metric_sources where template_id = 'senior_recruitment_manager' and field_key like 'li_%') = 6,
  'Senior IRM report has the LinkedIn section with the same definitions');
select pg_temp.act_as(:mgr);
select (public.create_linkedin_prospect('{"name": "Anson Lead"}'::jsonb, gen_random_uuid()) ->> 'id') as al \gset
select pg_temp.check((public.report_metrics('senior_recruitment_manager', public.company_today()) -> 'li_pending' ->> 'value')::int >= 1, 'the Senior IRM''s own prospect is in their pending contacts');
select pg_temp.check((select (w ->> 'linkedin_pending_contacts')::int from public.my_pending_work() w) >= 1
  and not exists (select 1 from public.linkedin_prospects where assigned_to = :mgr::uuid and id = :'dan'::uuid), 'each employee sees their own prospects');
rollback;
