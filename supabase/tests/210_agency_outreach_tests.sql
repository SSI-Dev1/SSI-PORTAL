-- Agency outreach: prospects, contact status, proposals, confirmation, registration, onboarding,
-- MOU and daily-report activities (0034). Runs after 180 (uses its Bulkland commission records).
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
-- Report figures for the officer today, minus what earlier test files already recorded.
create temp table metric_base as select key, (value ->> 'value')::int as v
  from jsonb_each(public.compute_report_metrics('00000000-0000-0000-0000-0000000000f3', 'partnership_officer', public.company_today()));
grant select on metric_base to authenticated;
create or replace function pg_temp.metric(emp uuid, k text) returns integer language plpgsql as $$
declare cur jsonb;
begin
  if current_user = 'authenticated' then cur := public.report_metrics('partnership_officer', public.company_today());
  else cur := public.compute_report_metrics(emp, 'partnership_officer', public.company_today()); end if;
  return (cur -> k ->> 'value')::int - coalesce((select v from metric_base where key = k), 0);
end $$;

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set mgr     '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''

\echo '== permission by designation, not by name'
begin;
update public.employees set designation_id = 'partnership_officer' where id = :po;   -- an earlier test moved it
update public.profiles set permissions = coalesce(permissions, '{tasks}') where id in (:po, :mgr, :app);
update public.profiles set permissions = array_remove(permissions, 'agency_outreach') where id in (:po, :mgr, :app);
-- the same statement the migration runs
update public.profiles p set permissions = array_append(p.permissions, 'agency_outreach')
from public.employees e where e.id = p.id and e.designation_id = 'partnership_officer' and p.permissions is not null and not ('agency_outreach' = any (p.permissions));
update public.profiles set permissions = '{partners,partner_onboarding}' where id = :admin;
update public.profiles set permissions = array_remove(array_remove(permissions, 'commission_manage'), 'commission_internal') where id = :po;
commit;
select pg_temp.check((select 'agency_outreach' = any (permissions) from public.profiles where id = :po), 'Partnership Officer received agency_outreach');
select pg_temp.check((select not ('agency_outreach' = any (permissions)) from public.profiles where id = :app), 'Application Team did not');
select pg_temp.check((select 'agency_outreach' = any (default_permissions) from public.designations where id = 'partnership_officer'), 'designation default includes it');

\echo '== add agency with little information (TEST 1, 2)'
begin; select pg_temp.act_as(:po);
select public.create_agency_prospect('{"contact_name":"Ravi Kumar"}', '11111111-0000-0000-0000-000000000001') ->> 'id' as ag_name \gset
select public.create_agency_prospect('{"phone":"+91 98470 00000"}', '11111111-0000-0000-0000-000000000002') ->> 'id' as ag_phone \gset
select pg_temp.check((select email is null and company_name is null and reference ~ '^AG-\d{2}-[0-9A-F]{6}$' from public.agency_prospects where id = :'ag_name'), 'contact name only: saved with a reference, no email needed (TEST 1)');
select pg_temp.check((select phone = '+91 98470 00000' and reference like 'AG-%' and contact_status = 'unknown' and stage = 'new_prospect' from public.agency_prospects where id = :'ag_phone'), 'phone only: saved with a reference, contact status not yet recorded (TEST 2)');
select pg_temp.check((public.create_agency_prospect('{"contact_name":"Ravi Kumar"}', '11111111-0000-0000-0000-000000000001') ->> 'duplicate')::boolean, 'double click does not create a second agency');
select pg_temp.denied($$select public.create_agency_prospect('{"email":"x@y.com","notes":"hi"}', gen_random_uuid())$$, 'email or notes alone are not enough', '%at least%');
select pg_temp.denied($$select public.create_agency_prospect('{"contact_name":"A","email":"not-an-email"}', gen_random_uuid())$$, 'a typed email must be valid', '%valid email%');
select pg_temp.check((select count(*) from public.partners where name = 'Ravi Kumar') = 0 and (select count(*) from public.profiles where full_name = 'Ravi Kumar') = 0, 'no partner or login is created');
select pg_temp.check(pg_temp.metric(:po, 'po_new_partners_contacted') = 0, 'adding an agency is not counted as a contact');
commit;

\echo '== contact status and activity (TEST 3)'
begin; select pg_temp.act_as(:po);
select public.set_agency_contact_status(:'ag_name', 'connected', 'Spoke on WhatsApp');
select pg_temp.check((select contact_status = 'connected' and contact_changed_by = :po and contact_changed_at is not null and first_connected_at is not null
  from public.agency_prospects where id = :'ag_name'), 'Connected, with who and when (TEST 3)');
select pg_temp.check((select count(*) from public.agency_activities where prospect_id = :'ag_name' and kind = 'contact_status' and detail ->> 'to' = 'connected') = 1, 'status change is in the history');
select public.set_agency_contact_status(:'ag_name', 'not_connected');
select public.set_agency_contact_status(:'ag_name', 'connected');
select pg_temp.check(pg_temp.metric(:po, 'po_new_partners_contacted') = 1, 'first contact counted once, even when toggled again');
select public.log_agency_activity(:'ag_name', 'call', 'Discussed UK intake', null, '22222222-0000-0000-0000-000000000001');
select public.log_agency_activity(:'ag_name', 'call', 'Discussed UK intake', null, '22222222-0000-0000-0000-000000000001');
select public.log_agency_activity(:'ag_name', 'meeting', 'Office visit', null, '22222222-0000-0000-0000-000000000002');
select public.log_agency_activity(:'ag_name', 'follow_up', 'Send rates', public.company_today() + 3, '22222222-0000-0000-0000-000000000003');
select pg_temp.check(pg_temp.metric(:po, 'po_followup_calls') = 1 and pg_temp.metric(:po, 'po_meetings_fixed') = 1, 'call and meeting counted once each (retry ignored)');
select pg_temp.check((select next_follow_up = public.company_today() + 3 and stage = 'follow_up_required' and last_contact_at is not null from public.agency_prospects where id = :'ag_name'), 'follow-up date and stage set');
select pg_temp.denied(format($$select public.log_agency_activity(%L, 'follow_up', null, public.company_today() - 1, gen_random_uuid())$$, :'ag_name'), 'follow-up date cannot be in the past', '%past%');
select pg_temp.denied(format($$select public.set_agency_stage(%L, 'onboarded')$$, :'ag_name'), 'onboarded cannot be set by hand', '%workflow%');
commit;

\echo '== other employees'
begin; select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.agency_prospects) = 0, 'an employee without the permission sees no agencies');
select pg_temp.denied($$select public.create_agency_prospect('{"contact_name":"X"}', gen_random_uuid())$$, 'and cannot add one', '%Not allowed%');
rollback;
begin; select pg_temp.act_as(:admin);
select pg_temp.check((select count(*) from public.agency_prospects where id = :'ag_name') = 1, 'registration managers see every agency');
rollback;
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.agency_prospects) + (select count(*) from public.agency_proposals) = 0, 'partners see nothing');
rollback;

\echo '== terms'
begin; select pg_temp.act_as(:po);
select pg_temp.denied($$select public.publish_proposal_terms('Terms', 'These are the approved partnership terms for agencies.')$$, 'officers cannot publish terms', '%administrators%');
rollback;
begin; select pg_temp.act_as(:admin);
select public.publish_proposal_terms('SSI GLOBAL partner terms v1', 'These are the approved partnership terms for agencies (test).') as terms_id \gset
commit;

\echo '== proposal (TEST 4, 5)'
begin; select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.create_agency_proposal(%L, jsonb_build_object('arrangement','tier','tier_id','tier_1','terms_id',%s,
  'record_ids', (select jsonb_agg(id) from public.commission_records where university_name = 'Bulk University 1')), gen_random_uuid())$$, :'ag_name', :terms_id),
  'no email, no company, no country: the missing details are listed (TEST 4)', 'MISSING:%email%');
select public.update_agency_prospect(:'ag_name', '{"company_name":"Ravi Overseas","email":"ravi@example.com","country":"India"}');
select pg_temp.denied(format($$select public.create_agency_proposal(%L, jsonb_build_object('arrangement','tier','tier_id','tier_2','terms_id',%s,
  'record_ids', (select jsonb_agg(id) from public.commission_records where university_name = 'Unclear University')), gen_random_uuid())$$, :'ag_name', :terms_id),
  'a tier without a valid rate for a university cannot be offered', '%no valid%');
select public.create_agency_proposal(:'ag_name', jsonb_build_object('arrangement', 'tier', 'tier_id', 'tier_1', 'terms_id', :terms_id,
  'record_ids', (select jsonb_agg(id) from public.commission_records where university_name in ('Bulk University 1', 'Bulk University 2'))),
  '33333333-0000-0000-0000-000000000001') ->> 'id' as prop \gset
select pg_temp.check((select status = 'draft' and arrangement ->> 'tier_label' = 'Tier 1' and jsonb_array_length(arrangement -> 'universities') = 2
  and (select bool_and((u ->> 'commission_value')::numeric = 20) from jsonb_array_elements(arrangement -> 'universities') u)
  from public.agency_proposals where id = :'prop'), 'Tier 1 snapshot uses the Tier 1 partner rate from the commission master (TEST 5)');
select pg_temp.check((select arrangement::text !~* '(SECRET PORTAL|route|provider|received|margin|internal|"25")' from public.agency_proposals where id = :'prop'),
  'no portal, route, SSI GLOBAL commission or margin in the proposal (TEST 5)');
select pg_temp.check((select count(*) from public.proposal_commission_options(null) o where o.university = 'Unclear University' and o.tier_id = 'tier_2') = 0, 'unclear rates are never offered');
select pg_temp.check(pg_get_function_result('public.proposal_commission_options(text)'::regprocedure) !~ '(route|provider|raw|received|margin|internal)', 'options have no internal columns');
-- custom commission needs approval
select public.create_agency_proposal(:'ag_phone', jsonb_build_object('company_name', 'Phone Agency', 'recipient_name', 'Anu', 'recipient_email', 'anu@example.com', 'country', 'India',
  'arrangement', 'custom', 'custom_kind', 'percent', 'custom_value', 22, 'terms_id', :terms_id,
  'record_ids', (select jsonb_agg(id) from public.commission_records where university_name = 'Bulk University 3')), gen_random_uuid()) ->> 'id' as custom_prop \gset
select pg_temp.check((select status = 'pending_approval' from public.agency_proposals where id = :'custom_prop'), 'a custom commission waits for approval');
select pg_temp.denied(format($$select public.decide_agency_proposal(%L, true)$$, :'custom_prop'), 'the officer cannot approve her own custom commission', '%commission managers%');
commit;
begin; select pg_temp.act_as(:super);
select public.decide_agency_proposal(:'custom_prop', true, 'ok');
select pg_temp.check((select status = 'draft' and approved_by is not null from public.agency_proposals where id = :'custom_prop'), 'commission manager approves it');
rollback;
begin; select pg_temp.act_as(:po);
select pg_temp.denied(format($$select * from public.begin_agency_proposal_send(%L, %L, 'x')$$, :'prop', :po), 'the browser cannot issue the link token itself', '%permission denied%');
select pg_temp.check((select public.can_send_agency_proposal(:'prop')), 'the officer may send her own proposal');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.check(not public.can_send_agency_proposal(:'prop'), 'another employee may not');
rollback;

\echo '== sending (TEST 6) — as the Edge Function (service role)'
select pg_temp.trusted();
\set tok '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
select public.begin_agency_proposal_send(:'prop', :po, :tok) is not null;
select pg_temp.denied(format($$select public.begin_agency_proposal_send(%L, %L, 'bbbb')$$, :'prop', :po), 'a second click while sending is refused (no duplicate email)', 'STATE: sending%');
select public.finish_agency_proposal_send(:'prop', :po, true, '<msg-1@brevo>', null);
select pg_temp.check((select status = 'awaiting_confirmation' and email_status = 'accepted' and sent_at is not null and sent_by = :po and expires_at > now()
  from public.agency_proposals where id = :'prop'), 'sent: awaiting confirmation, provider accepted (not yet "delivered") (TEST 6)');
select pg_temp.check((select stage = 'proposal_sent' from public.agency_prospects where id = :'ag_name'), 'agency moves to Proposal sent');
select pg_temp.check(pg_temp.metric(:po, 'po_proposals_sent') = 1, 'Proposals sent counted in the daily report');
select public.apply_email_event('<msg-1@brevo>', 'delivered', null);
select pg_temp.check((select email_status = 'delivered' from public.agency_proposals where id = :'prop'), 'Brevo delivered event marks it delivered');
select pg_temp.denied(format($$select public.begin_agency_proposal_send(%L, %L, 'cccc')$$, :'prop', :po), 'a sent proposal is not sent again', 'STATE: awaiting_confirmation%');

\echo '== recipient (TEST 7, 8)'
select pg_temp.check((select public.agency_proposal_for_token(:tok) ->> 'state' = 'open'), 'the page opens');
select pg_temp.check((select status = 'awaiting_confirmation' and first_viewed_at is not null from public.agency_proposals where id = :'prop'), 'opening (or a mail scanner) does not accept it (TEST 7)');
select pg_temp.check((select public.agency_proposal_for_token(:tok)::text !~* '(SECRET PORTAL|margin|received)'), 'public view has no internal values');
select pg_temp.check((select public.agency_proposal_for_token('0000000000000000000000000000000000000000000000000000000000000000') ->> 'state' = 'invalid'), 'unknown link is invalid');
select pg_temp.denied(format($$select public.confirm_agency_proposal(%L, '')$$, :tok), 'confirming needs the typed name', '%full name%');
select public.confirm_agency_proposal(:tok, 'Ravi Kumar');
select pg_temp.check((select status = 'confirmed' and confirmed_name = 'Ravi Kumar' from public.agency_proposals where id = :'prop'), 'explicit confirmation accepted (TEST 8)');
select pg_temp.check((public.confirm_agency_proposal(:tok, 'Ravi Kumar') ->> 'duplicate')::boolean, 'confirming twice changes nothing');
select public.issue_registration_for_proposal(:'prop') as reg \gset
select pg_temp.check((:'reg'::jsonb ->> 'state') = 'created' and (:'reg'::jsonb ->> 'email') = 'ravi@example.com', 'company-specific registration created for the confirmed address (TEST 8)');
select pg_temp.check((select registration_id is not null and stage = 'registration_pending' from public.agency_prospects where id = :'ag_name'), 'agency linked to its registration');
select pg_temp.check((public.issue_registration_for_proposal(:'prop') ->> 'state') = 'exists', 'no second registration for the same agency');
select (:'reg'::jsonb ->> 'token') as regtok, (:'reg'::jsonb ->> 'registration_id') as regid \gset

\echo '== registration and admin approval (TEST 9, 10)'
select public.submit_partner_registration(:'regtok', '{"company_name":"Ravi Overseas"}', 'v1-2026-11', 'idem-1') is not null;
select pg_temp.check((select stage = 'registration_submitted' from public.agency_prospects where id = :'ag_name'), 'submission updates the agency (TEST 9)');
select pg_temp.check((select count(*) from public.notifications where link = 'partners/registrations' and body like 'Ravi Overseas%') >= 1, 'administrators are notified (TEST 9)');
begin; select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.approve_registration(%L)$$, :'regid'), 'the officer cannot approve the registration (TEST 12)', '%');
rollback;
begin; select pg_temp.act_as(:admin);
select public.start_registration_review(:'regid');
select public.approve_registration(:'regid', 'ok');
commit;
select pg_temp.check((select stage = 'approved' from public.agency_prospects where id = :'ag_name'), 'approval reaches the agency');
select pg_temp.trusted();
insert into public.partners (id, name, code, contact_name, email, phone, city, status) values ('p_ravi', 'Ravi Overseas', 'RAVI', 'Ravi Kumar', 'ravi@example.com', '+91 9847000000', 'Kochi', 'Active');
select public.begin_registration_provisioning(:'regid', :admin) is not null;
select public.finish_registration_provisioning(:'regid', 'p_ravi', gen_random_uuid(), :admin);
select pg_temp.check((select stage = 'onboarded' and partner_id = 'p_ravi' from public.agency_prospects where id = :'ag_name'), 'activated: agency onboarded and linked to the partner (TEST 10)');
select pg_temp.check((select partnership_officer_id = :po from public.partners where id = 'p_ravi'), 'the officer becomes the partner''s Partnership Officer');
select pg_temp.check((select count(*) from public.agency_prospects where partner_id = 'p_ravi') = 1, 'one agency per partner');
select pg_temp.denied(format($$select public.begin_registration_provisioning(%L, %L)$$, :'regid', :admin), 'a second activation is refused (no duplicate partner)', '%ALREADY_ACTIVATED%');

\echo '== MOU, closing and the daily report (TEST 11)'
begin; select pg_temp.act_as(:po);
select public.record_agency_mou(:'ag_phone', 'MOU-001', public.company_today(), null) as mou \gset
select pg_temp.check(pg_temp.metric(:po, 'po_mous_signed') = 0, 'MOU sent is not counted as MOU signed');
select public.set_agency_mou_status(:'mou', 'signed', public.company_today());
select pg_temp.check(pg_temp.metric(:po, 'po_mous_signed') = 1, 'MOU signed counted once');
select pg_temp.denied(format($$select public.record_agency_mou(%L, 'X', public.company_today() + 1)$$, :'ag_phone'), 'an MOU cannot be recorded as sent in the future', '%future%');
select public.set_agency_stage(:'ag_phone', 'closed', 'Not interested');
select pg_temp.check(pg_temp.metric(:po, 'po_closed') = 1, 'closed counted');
select pg_temp.check(pg_temp.metric(:po, 'po_partners_onboarded') = 1, 'onboarded partner counted for the officer (TEST 11)');
select pg_temp.check(pg_temp.metric(:po, 'po_new_partners_contacted') = 1 and pg_temp.metric(:po, 'po_proposals_sent') = 1, 'contacted and proposals still counted once');
select pg_temp.denied(format($$select public.create_agency_proposal(%L, '{}', gen_random_uuid())$$, :'ag_phone'), 'no proposal for a closed agency', '%closed%');
commit;

\echo '== permissions (TEST 12)'
begin; select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.commission_internal) = 0, 'the officer cannot read SSI GLOBAL commission');
select pg_temp.denied($$select public.update_partnership_settings(false, 10)$$, 'the officer cannot change partnership settings', '%administrators%');
select pg_temp.denied(format($$select public.issue_agency_registration(%L)$$, :'ag_phone'), 'the officer cannot issue registration links herself', '%administrators%');
select pg_temp.check(not exists (select 1 from information_schema.column_privileges where table_name = 'agency_proposals' and column_name = 'token_hash' and grantee = 'authenticated'),
  'the proposal link hash is not readable');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.denied($$select * from public.proposal_commission_options(null)$$, 'employees without the permission get no commission options', '%Not allowed%');
rollback;

\echo '== manual registration link when automatic links are off'
begin;
select pg_temp.act_as(:po);
select public.create_agency_prospect('{"company_name":"Manual Co","contact_name":"Mo","email":"mo@example.com","country":"India"}', gen_random_uuid()) ->> 'id' as ag3 \gset
select public.create_agency_proposal(:'ag3', jsonb_build_object('arrangement', 'tier', 'tier_id', 'tier_1', 'terms_id', :terms_id,
  'record_ids', (select jsonb_agg(id) from public.commission_records where university_name = 'Bulk University 4')), gen_random_uuid()) ->> 'id' as p3 \gset
select pg_temp.act_as(:admin);
select public.update_partnership_settings(false, null);
select pg_temp.trusted();
select public.begin_agency_proposal_send(:'p3', :po, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd') is not null;
select public.finish_agency_proposal_send(:'p3', :po, true, '<m3>', null);
select public.confirm_agency_proposal('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'Mo');
select pg_temp.check((public.issue_registration_for_proposal(:'p3') ->> 'state') = 'manual', 'with automatic links off, nothing is issued');
select pg_temp.check((select registration_id is null and stage = 'registration_pending' from public.agency_prospects where id = :'ag3'), 'the agency waits for an administrator');
select pg_temp.act_as(:admin);
select pg_temp.check((public.issue_agency_registration(:'ag3') ->> 'token') is not null, 'an administrator issues it');
rollback;
