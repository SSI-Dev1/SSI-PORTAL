-- LinkedIn reporting corrections (0048): scenarios A–F, follow-up dedupe, stage changes,
-- contact reversals, LinkedIn → Agency List credit and reconciliation.
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
-- Report figure for the officer today, as the officer sees it.
create or replace function pg_temp.m(k text) returns integer language plpgsql as $$
declare cur jsonb;
begin
  if current_user = 'authenticated' then cur := public.report_metrics('partnership_officer', public.company_today());
  else cur := public.compute_report_metrics('00000000-0000-0000-0000-0000000000f3', 'partnership_officer', public.company_today()); end if;
  return coalesce((cur -> k ->> 'value')::int, 0);
end $$;

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set mgr   '''00000000-0000-0000-0000-0000000000f2'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''

begin;
select pg_temp.trusted();
update public.employees set designation_id = 'partnership_officer' where id = :po;
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach')
where id in (:po, :mgr) and not ('agency_outreach' = any (coalesce(permissions, public.role_default_permissions(role))));
create temp table b as select k, pg_temp.m(k) v from unnest(array['li_new_connections', 'li_followup_messages', 'li_positive_responses', 'li_pending', 'li_not_responded', 'li_closed', 'po_new_partners_contacted']) k;
grant select on b to authenticated;
create or replace function pg_temp.d(key text) returns integer language sql as $$ select pg_temp.m(key) - coalesce((select v from b where k = key), 0) $$;

\echo '== report template has Not responded'
select pg_temp.check((select sections::text like '%li_not_responded%' from public.report_templates where id = 'partnership_officer' order by version desc limit 1)
  and (select sections::text like '%li_not_responded%' from public.report_templates where id = 'senior_recruitment_manager' order by version desc limit 1),
  'Partnership Officer and Senior IRM reports gain "Not responded" (older versions kept for submitted reports)');

\echo '== SCENARIO A: name only'
select pg_temp.act_as(:po);
select (public.create_linkedin_prospect('{"name": "Dan Four"}'::jsonb, gen_random_uuid()) ->> 'id') as dan \gset
select pg_temp.check((select pipeline_stage = 'pending' and contact_status = 'unknown' from public.linkedin_prospects where id = :'dan')
  and pg_temp.d('li_pending') = 1 and pg_temp.d('li_not_responded') = 0 and pg_temp.d('li_positive_responses') = 0 and pg_temp.d('li_followup_messages') = 0 and pg_temp.d('li_new_connections') = 0,
  'A: Pending 1, Not responded 0, Positive 0, follow-ups 0, no connection (TEST 1)');

\echo '== SCENARIO B / C: follow-ups'
select public.log_linkedin_activity(:'dan', 'follow_up', 'no reply', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_pending') = 0 and pg_temp.d('li_not_responded') = 1 and pg_temp.d('li_followup_messages') = 1
  and (select contact_status = 'unknown' from public.linkedin_prospects where id = :'dan'), 'B: Pending 0, Not responded 1, follow-ups 1; contact status untouched (TEST 2)');
select public.log_linkedin_activity(:'dan', 'follow_up', 'again', null, gen_random_uuid());
select public.log_linkedin_activity(:'dan', 'follow_up', 'and again', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_not_responded') = 1 and pg_temp.d('li_followup_messages') = 1, 'C: two more follow-ups the same day — still 1 (TEST 3)');
select pg_temp.check((select count(*) from public.linkedin_activities where prospect_id = :'dan' and kind = 'follow_up') = 3, 'all three follow-ups stay in the history (TEST 16)');
commit;
begin;
select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.work_activities w where w.activity_type = 'linkedin_followup' and w.entity_id = :'dan' and w.voided_at is null) = 1,
  'one credited follow-up for the prospect today, across employees (first one)');
-- next reporting day: make today's credit yesterday's, then follow up again
select pg_temp.trusted();
update public.work_activities set report_date = report_date - 1, dedupe_key = replace(dedupe_key, ':' || public.company_today(), ':' || (public.company_today() - 1))
where activity_type = 'linkedin_followup' and entity_id = :'dan';
select pg_temp.act_as(:po);
select public.log_linkedin_activity(:'dan', 'follow_up', 'next day', null, gen_random_uuid());
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'linkedin_followup' and entity_id = :'dan' and voided_at is null) = 2
  and pg_temp.d('li_followup_messages') = 1, 'a new reporting day counts a new follow-up (TEST 4)');
rollback;

\echo '== SCENARIO D / E / F: stage changes keep one current stage'
begin; select pg_temp.act_as(:po);
select public.set_linkedin_stage(:'dan', 'positive', 'wants to partner', null, gen_random_uuid());
select pg_temp.check((select pipeline_stage = 'positive' and conversion_pending from public.linkedin_prospects where id = :'dan')
  and pg_temp.d('li_not_responded') = 0 and pg_temp.d('li_positive_responses') = 1, 'D: Not responded 0, Positive 1; move to Agency List pending (no phone / agency name) (TEST 10)');
select public.set_linkedin_stage(:'dan', 'closed', 'changed mind', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_positive_responses') = 0 and pg_temp.d('li_closed') = 1, 'E: Positive 0, Closed 1 (TEST 5)');
select public.set_linkedin_stage(:'dan', 'positive', 'back on', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_closed') = 0 and pg_temp.d('li_positive_responses') = 1 and (select pipeline_stage = 'positive' from public.linkedin_prospects where id = :'dan'),
  'F: Closed 0, Positive 1 — no double counting (TEST 6)');
select pg_temp.check((select count(*) from public.linkedin_activities where prospect_id = :'dan' and kind = 'stage') >= 4, 'every stage change is in the history');
select pg_temp.check((select (s ->> 'positive')::int >= 1 and (s ->> 'closed')::int >= 0 from public.linkedin_summary() s)
  and not exists (select 1 from public.linkedin_prospects where id = :'dan' and pipeline_stage = 'closed'), 'the summary uses the single current stage (TEST 15)');
select pg_temp.denied(format($$select public.set_linkedin_stage(%L, 'pending', null, null, gen_random_uuid())$$, :'dan'), 'only a Super Admin can move back to Pending', '%Super Admin%');
commit;

\echo '== contact status: forward only (TEST 7 / 8 / 9)'
begin; select pg_temp.act_as(:po);
select (public.create_linkedin_prospect('{"name": "Rev Test"}'::jsonb, gen_random_uuid()) ->> 'id') as rv \gset
select public.set_linkedin_contact_status(:'rv', 'not_connected', null, gen_random_uuid());
select pg_temp.denied(format($$select public.set_linkedin_contact_status(%L, 'unknown', null, gen_random_uuid())$$, :'rv'), 'Not connected cannot go back to Not recorded (TEST 8)', '%Super Admin%');
select public.set_linkedin_contact_status(:'rv', 'connected', null, gen_random_uuid());
select pg_temp.check(pg_temp.d('li_new_connections') = 1, 'forward progress to Connected is allowed and counted');
select pg_temp.denied(format($$select public.set_linkedin_contact_status(%L, 'not_connected', null, gen_random_uuid())$$, :'rv'), 'Connected cannot go back to Not connected (TEST 7)', '%Super Admin%');
select pg_temp.act_as(:super);
select public.set_linkedin_contact_status(:'rv', 'not_connected', 'wrong contact', gen_random_uuid());
select pg_temp.check((select contact_status = 'not_connected' from public.linkedin_prospects where id = :'rv')
  and (select count(*) from public.linkedin_activities where prospect_id = :'rv' and kind = 'contact_correction' and note = 'wrong contact') = 1,
  'Super Admin correction with reason, audited (TEST 9)');
select pg_temp.act_as(:po);
select pg_temp.check(pg_temp.d('li_new_connections') = 0, 'and the reversed connection is no longer counted');
rollback;

\echo '== agency contact status: forward only'
begin; select pg_temp.act_as(:po);
select (public.create_agency_prospect('{"company_name": "Fwd Agency"}'::jsonb, gen_random_uuid()) ->> 'id') as fa \gset
select public.set_agency_contact_status(:'fa', 'connected', null);
select pg_temp.denied(format($$select public.set_agency_contact_status(%L, 'not_connected', null)$$, :'fa'), 'an officer cannot reverse an agency''s Connected', '%Super Admin%');
rollback;

\echo '== LinkedIn → Agency List: New partner contacted once (TEST 11 / 12 / 13)'
begin; select pg_temp.act_as(:po);
select (public.create_linkedin_prospect('{"name": "Jo Agent", "company_name": "Jo Overseas 350", "phone": "+91 97000 35001"}'::jsonb, gen_random_uuid()) ->> 'id') as jo \gset
select public.log_linkedin_activity(:'jo', 'follow_up', null, null, gen_random_uuid());
select public.set_linkedin_stage(:'jo', 'positive', 'yes', null, gen_random_uuid()) as conv \gset
select (:'conv'::jsonb ->> 'agency_id') as joag \gset
select pg_temp.check((:'conv'::jsonb ->> 'status') = 'converted' and (select source = 'linkedin' and contact_status = 'connected' from public.agency_prospects where id = :'joag'),
  'Positive response with agency name and phone moves the contact to the Agency List (TEST 11)');
select pg_temp.check(pg_temp.d('po_new_partners_contacted') = 1, 'New partners contacted +1 (TEST 12)');
select public.set_agency_contact_status(:'joag', 'connected', null);
select public.update_agency_prospect(:'joag', '{"notes": "edited"}'::jsonb);
select (public.create_linkedin_prospect('{"name": "Jo Again", "phone": "9700035001"}'::jsonb, gen_random_uuid()) ->> 'id') as jo2 \gset
select pg_temp.check((public.set_linkedin_stage(:'jo2', 'positive', null, null, gen_random_uuid()) ->> 'conversion_pending')::boolean, 'no agency name yet: kept as a pending conversion (nothing invented)');
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{}'::jsonb)$$, :'jo2'), 'Move to Agency List still asks for the agency name', 'MISSING:%agency / company name%');
select public.convert_linkedin_prospect(:'jo2', '{"company_name": "Jo Overseas 350"}'::jsonb);
select pg_temp.check((select agency_id = :'joag'::uuid from public.linkedin_prospects where id = :'jo2'), 'a second LinkedIn record for the same agency links to it — no duplicate agency');
select pg_temp.check(pg_temp.d('po_new_partners_contacted') = 1 and (select count(*) from public.work_activities where dedupe_key = 'agency-contact:' || :'joag') = 1,
  'edits, Connected and a second conversion add nothing (TEST 13)');
select pg_temp.check((select count(*) from public.linkedin_activities where prospect_id = :'jo') >= 3, 'LinkedIn history kept');
rollback;

\echo '== reconciliation (TEST 17)'
begin; select pg_temp.trusted();
select (select id::text from public.linkedin_prospects where name = 'Dan Four') as dan2 \gset
insert into public.work_activities (employee_id, designation_id, activity_type, source, entity_type, entity_id, quantity, report_date, dedupe_key)
values (:po, 'partnership_officer', 'linkedin_followup', 'logged', 'linkedin', :'dan2', 1, public.company_today() - 3, 'old-a'),
       (:po, 'partnership_officer', 'linkedin_followup', 'logged', 'linkedin', :'dan2', 1, public.company_today() - 3, 'old-b'),
       (:po, 'partnership_officer', 'linkedin_closed', 'logged', 'linkedin', :'dan2', 1, public.company_today() - 3, 'old-c'),
       (:po, 'partnership_officer', 'linkedin_positive', 'logged', 'linkedin', :'dan2', 1, public.company_today() - 3, 'old-d');
create temp table before as select count(*) n from public.work_activities;
select public.reconcile_linkedin_reporting() as rec \gset
select pg_temp.check((select count(*) from public.work_activities) = (select n from before), 'no activity row deleted');
select pg_temp.check((select voided_at is null from public.work_activities where dedupe_key = 'old-a') and (select voided_at is not null from public.work_activities where dedupe_key = 'old-b'),
  'a duplicate follow-up on one day: the later one is voided, the first kept');
select pg_temp.check((select voided_at is not null from public.work_activities where dedupe_key = 'old-c') and (select voided_at is null from public.work_activities where dedupe_key = 'old-d'),
  'Positive and Closed the same day: the one matching the current stage (Positive) is kept');
select pg_temp.check(((public.reconcile_linkedin_reporting()) ->> 'duplicate_followups_voided')::int = 0, 'running it again changes nothing');
rollback;

\echo '== permissions'
begin; select pg_temp.act_as(:po);
select pg_temp.denied($$select public.reconcile_linkedin_reporting()$$, 'only a Super Admin runs the reconciliation', '%Not allowed%');
rollback;
