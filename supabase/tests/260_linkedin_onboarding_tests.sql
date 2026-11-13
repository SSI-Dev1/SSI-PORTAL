-- LinkedIn outreach, conversion, Senior IRM access and onboarding emails (0039).
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
create or replace function pg_temp.n(emp uuid, t text) returns bigint language sql as $$
  select count(*) from public.work_activities where employee_id = emp and activity_type = t and voided_at is null;
$$;
\set admin '''00000000-0000-0000-0000-0000000000a2'''
\set mgr   '''00000000-0000-0000-0000-0000000000f2'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''

\echo '== Senior IRM gets the workflow by designation'
-- the same statement the migration runs (fixtures are created after migrations)
update public.profiles p set permissions = array_append(p.permissions, 'agency_outreach')
from public.employees e where e.id = p.id and e.designation_id = 'senior_international_recruitment_manager' and p.permissions is not null and not ('agency_outreach' = any (p.permissions));
select pg_temp.check((select 'agency_outreach' = any (permissions) from public.profiles where id = :mgr), 'Senior IRM has Agencies & proposals');
select pg_temp.check((select 'agency_outreach' = any (default_permissions) from public.designations where id = 'senior_international_recruitment_manager'), 'and the designation default includes it');
create temp table w0 as select (select pg_temp.n(:po, 'linkedin_connection')) c, (select pg_temp.n(:po, 'linkedin_followup')) f, (select pg_temp.n(:po, 'linkedin_positive')) p,
  (select pg_temp.n(:po, 'partner_contact')) pc;

\echo '== LinkedIn prospects (tests 1-3)'
begin; select pg_temp.act_as(:po);
select public.create_linkedin_prospect('{"name":"Lina Recruits"}', '55555555-0000-0000-0000-000000000001') ->> 'id' as l1 \gset
select pg_temp.check((select reference like 'LI-%' and phone is null and email is null and status = 'not_contacted' and assigned_to = :po from public.linkedin_prospects where id = :'l1'),
  'Partnership Officer adds a prospect with only a name (test 1, 3)');
select pg_temp.check((public.create_linkedin_prospect('{"name":"Lina Recruits"}', '55555555-0000-0000-0000-000000000001') ->> 'duplicate')::boolean, 'double click adds it once');
select pg_temp.denied($$select public.create_linkedin_prospect('{"company_name":"X"}', gen_random_uuid())$$, 'a name is required', '%name%');
select pg_temp.denied($$select public.create_linkedin_prospect('{"name":"X","linkedin_url":"https://evil.example/x"}', gen_random_uuid())$$, 'profile link must be linkedin.com', '%linkedin.com%');
select public.log_linkedin_activity(:'l1', 'contacted', 'Sent a connection request', null, gen_random_uuid());
select public.log_linkedin_activity(:'l1', 'follow_up', 'Follow-up message', public.company_today() + 2, gen_random_uuid());
select public.log_linkedin_activity(:'l1', 'follow_up', 'Second follow-up', null, gen_random_uuid());
select public.log_linkedin_activity(:'l1', 'interested', 'Wants rates', null, gen_random_uuid());
select public.log_linkedin_activity(:'l1', 'interested', 'Still keen', null, gen_random_uuid());
commit;
select pg_temp.check(pg_temp.n(:po, 'linkedin_connection') - (select c from w0) = 1 and pg_temp.n(:po, 'linkedin_followup') - (select f from w0) = 2
  and pg_temp.n(:po, 'linkedin_positive') - (select p from w0) = 1, 'report: 1 contacted, 2 follow-up messages, 1 positive response (counted once) — for the officer only');
begin; select pg_temp.act_as(:mgr);
select public.create_linkedin_prospect('{"name":"Manager Lead"}', gen_random_uuid()) ->> 'id' as l2 \gset
select pg_temp.check((select count(*) from public.linkedin_prospects where id in (:'l1', :'l2')) = 2, 'Senior IRM adds prospects too and sees the team member''s (test 2)');
commit;
begin; select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.linkedin_prospects where id = :'l2') = 0, 'the officer does not see the manager''s own prospects');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.linkedin_prospects) = 0, 'employees without the permission see none');
select pg_temp.denied($$select public.create_linkedin_prospect('{"name":"X"}', gen_random_uuid())$$, 'and cannot add', '%Not allowed%');
rollback;

\echo '== Convert to Agency (tests 4-7)'
begin; select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{}')$$, :'l1'), 'conversion needs a phone number (test 4)', 'MISSING:%phone%');
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{"phone":"12"}')$$, :'l1'), 'a too-short phone is rejected', 'MISSING:%phone%');
select public.convert_linkedin_prospect(:'l1', '{"phone":"+91 98765 43299","email":"lina@recruits.test","company_name":"Lina Recruits Pvt"}') ->> 'agency_id' as ag \gset
select pg_temp.check((select company_name = 'Lina Recruits Pvt' and contact_name = 'Lina Recruits' and phone = '+91 98765 43299' and email = 'lina@recruits.test'
  and source = 'linkedin' and contact_status = 'connected' and assigned_officer = :po from public.agency_prospects where id = :'ag'), 'details transferred to the new agency (test 5)');
select pg_temp.check((select status = 'converted' and agency_id = :'ag' from public.linkedin_prospects where id = :'l1')
  and (select count(*) from public.linkedin_activities where prospect_id = :'l1') >= 6, 'prospect marked Converted, LinkedIn history kept');
select pg_temp.check((select count(*) from public.agency_prospects where id = :'ag') = 1, 'the agency is in the Agency List (test 7)');
select public.create_linkedin_prospect('{"name":"Lina again","phone":"98765 43299"}', gen_random_uuid()) ->> 'id' as l3 \gset
select pg_temp.check((public.convert_linkedin_prospect(:'l3', '{}') ->> 'agency_id') = :'ag', 'same phone: linked to the existing agency, no duplicate (test 6)');
select pg_temp.check((select count(*) from public.agency_prospects where regexp_replace(phone, '\D', '', 'g') like '%9876543299') = 1, 'still exactly one agency');
commit;
select pg_temp.check(pg_temp.n(:po, 'partner_contact') = (select pc from w0), 'conversion is not counted again as a new partner contact');

\echo '== onboarding emails (service role, as the agency-proposal function)'
select public.record_agency_email(:'ag', null, 'mou', 'accepted', '<mou-1>', null, null);
select public.record_agency_email(:'ag', null, 'registration', 'failed', null, 'Rejected by the email provider (HTTP 400)', null);
select pg_temp.check((select count(*) from public.agency_mous where prospect_id = :'ag' and status = 'sent') = 1, 'an emailed MOU is recorded as sent');
select pg_temp.check((select count(*) from public.agency_mous where prospect_id = :'ag' and status = 'signed') = 0, 'and never as signed');
select public.record_agency_email(:'ag', null, 'mou', 'accepted', '<mou-2>', null, null);
select pg_temp.check((select count(*) from public.agency_mous where prospect_id = :'ag') = 1 and (select attempts = 2 from public.agency_emails where prospect_id = :'ag' and kind = 'mou'),
  'resending the MOU does not create a second MOU');
select pg_temp.check((select status = 'failed' from public.agency_emails where prospect_id = :'ag' and kind = 'registration')
  and (select status = 'accepted' from public.agency_emails where prospect_id = :'ag' and kind = 'mou'), 'each email tracked on its own: one failed, the other kept');
select public.apply_email_event('<mou-2>', 'delivered', null);
select pg_temp.check((select status = 'delivered' from public.agency_emails where prospect_id = :'ag' and kind = 'mou'), 'Brevo delivery updates the MOU email');
select pg_temp.check((public.reissue_agency_registration_link(:'ag') ->> 'state') = 'none', 'no registration yet: nothing to re-issue');
begin; select pg_temp.act_as(:po);
select pg_temp.denied($$select public.publish_mou_document('MOU', 'This is the approved memorandum text for partners.')$$, 'officers cannot publish the MOU', '%administrators%');
select pg_temp.denied(format($$select public.record_agency_email(%L, null, 'mou', 'accepted', 'x', null, null)$$, :'ag'), 'the browser cannot record email outcomes', '%permission denied%');
select pg_temp.check((select count(*) from public.agency_emails where prospect_id = :'ag') = 2, 'the officer sees the email status of the agency');
rollback;
begin; select pg_temp.act_as(:admin);
select public.publish_mou_document('SSI GLOBAL MOU', 'This is the approved memorandum text for partners (test).') is not null;
select pg_temp.check((select count(*) from public.mou_documents where active) = 1, 'administrators publish the MOU document');
rollback;
