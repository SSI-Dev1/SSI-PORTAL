-- Normal onboarding end to end: proposal accepted → registration + MOU → signed → approved → countersigned → Clients (0063).
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
\set ag1   '''eeeeeeee-0000-4000-8000-000000000201'''
\set ag2   '''eeeeeeee-0000-4000-8000-000000000202'''
\set ag3   '''eeeeeeee-0000-4000-8000-000000000203'''
\set pp1   '''eeeeeeee-0000-4000-8000-000000000211'''
\set pp2   '''eeeeeeee-0000-4000-8000-000000000212'''

begin;
select pg_temp.trusted();
update public.profiles set permissions = array['agency_outreach', 'partners', 'tasks'] where id = :po;
insert into public.agency_prospects (id, reference, company_name, contact_name, email, phone, country, stage, assigned_officer, created_by, source, agency_type) values
  (:ag1, 'AG-NRM-1', 'Northwind Study Abroad', 'Nina North', 'nina@northwind.test', '+91 98000 11111', 'India', 'proposal_sent', :po, :po, 'manual', 'domestic'),
  (:ag2, 'AG-NRM-2', 'Twinlake Consultants', 'Tom Lake', 'tom@twinlake.test', null, 'India', 'proposal_sent', :po, :po, 'manual', 'domestic'),
  (:ag3, 'AG-NRM-3', 'Untyped Overseas', 'Uma', 'uma@untyped.test', null, 'India', 'new_prospect', :po, :po, 'manual', null);
insert into public.agency_proposals (id, reference, prospect_id, status, company_name, recipient_name, recipient_email, country, arrangement, terms_title, terms_body,
                                     request_key, sent_by, sent_at, confirmed_at, confirmed_name) values
  (:pp1, 'PP-NRM-1', :ag1, 'confirmed', 'Northwind Study Abroad', 'Nina North', 'nina@northwind.test', 'India',
   '{"universities":[{"university":"Example University","country":"United Kingdom","commission_kind":"percent","commission_value":"15"}]}', 'Terms', 'Body',
   gen_random_uuid(), :po, now() - interval '2 days', now() - interval '1 day', 'Nina North'),
  (:pp2, 'PP-NRM-2', :ag2, 'confirmed', 'Twinlake Consultants', 'Tom Lake', 'tom@twinlake.test', 'India',
   '{"universities":[{"university":"Example University","country":"United Kingdom","commission_kind":"percent","commission_value":"15"}]}', 'Terms', 'Body',
   gen_random_uuid(), :po, now() - interval '2 days', now() - interval '1 day', 'Tom Lake');
-- two client records that both match "Twinlake Consultants" by name
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled) values
  ('nr-tw1', 'Twinlake Consultants', 'NRTW1', 'A', 'a@tw1.test', 'Active', false),
  ('nr-tw2', 'Twinlake  consultants', 'NRTW2', 'B', 'b@tw2.test', 'Active', false);
create temp table p0 as select count(*) n from public.partners;
create temp table u0 as select count(*) n from public.profiles;
create temp table w0 as select count(*) n from public.work_activities where activity_type = 'partner_onboarded';
grant select on p0, u0, w0 to authenticated;

\echo '== TEST 5 / 6 / 7: proposal accepted → registration issued for the same agency'
select public.issue_registration_for_proposal(:pp1) as g \gset
select pg_temp.check(:'g'::jsonb ->> 'state' = 'created' and (select registration_id = (:'g'::jsonb ->> 'registration_id')::uuid and stage = 'registration_pending' from public.agency_prospects where id = :ag1),
  'registration created and linked to the agency that accepted (no new agency)');
select pg_temp.check((select count(*) = 1 from public.agency_prospects where company_name = 'Northwind Study Abroad'), 'still one Northwind agency');
select :'g'::jsonb ->> 'token' as tok, :'g'::jsonb ->> 'registration_id' as rid \gset
select public.issue_registration_for_proposal(:pp1) as g2 \gset
select pg_temp.check(:'g2'::jsonb ->> 'state' = 'exists', 'accepting again issues no second registration');

\echo '== TEST 17: the MOU cannot be skipped, and a blocked agreement is reported'
select pg_temp.denied(format($$select public.submit_partner_registration(%L, '{"company_email":"nina@northwind.test"}', 'v1', 'k1')$$, :'tok'),
  'no agreement issued yet: submission refused', '%AGREEMENT_NOT_READY%');
insert into public.registration_agreements (registration_id, status, agency_type) values (:'rid', 'template_missing', 'domestic');
select pg_temp.check((select count(*) = 1 from public.partner_registration_events where registration_id = :'rid' and action = 'agreement_blocked' and detail ->> 'reason' like 'No approved domestic agreement template%'),
  'template missing: the exact reason is recorded');
select pg_temp.check((select count(*) >= 1 from public.notifications where title = 'Partnership Agreement not available' and body like 'Northwind%'), 'and the registration managers are notified');
select pg_temp.denied(format($$select public.submit_partner_registration(%L, '{"company_email":"nina@northwind.test"}', 'v1', 'k2')$$, :'tok'),
  'still refused while the template is missing', '%AGREEMENT_NOT_READY%');

\echo '== TEST 8 / 9 / 10: agreement issued, signed copy uploaded, submitted'
update public.registration_agreements set status = 'ready' where registration_id = :'rid';
select pg_temp.denied(format($$select public.submit_partner_registration(%L, '{"company_email":"nina@northwind.test"}', 'v1', 'k3')$$, :'tok'),
  'agreement available but not signed: refused', '%AGREEMENT_REQUIRED%');
insert into public.registration_agreement_files (registration_id, kind, version, storage_path, sha256, size, pages, file_name, review_status)
values (:'rid', 'partner_signed', 1, :'rid' || '/agreement/partner_signed-v1-test.pdf', 'abc', 1000, 6, 'signed.pdf', 'pending');
select public.submit_partner_registration(:'tok', '{"company_email":"nina@northwind.test","contact_full_name":"Nina North","contact_number":"+91 98000 11111"}', 'v1', 'k4');
select pg_temp.check((select status = 'submitted' and submitted_at is not null from public.partner_registrations where id = :'rid'), 'registration submitted with a timestamp');
select pg_temp.check((select status = 'pending_review' from public.registration_agreements where registration_id = :'rid'), 'agreement waits for SSI review');
select pg_temp.check((select stage = 'registration_submitted' from public.agency_prospects where id = :ag1), 'agency timeline: registration submitted');

\echo '== TEST 19: only authorised employees approve'
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.approve_registration(%L)$$, :'rid'), 'a Partnership Officer without Partner onboarding cannot approve', '%authorised administrators%');
select pg_temp.denied(format($$select public.onboard_registration(%L)$$, :'rid'), 'nor complete onboarding', '%authorised administrators%');

\echo '== TEST 11 / 12: approval waits for the countersignature; countersigning completes onboarding'
select pg_temp.act_as(:super);
select public.approve_registration(:'rid', 'All documents checked');
select pg_temp.check((select status = 'approved' and partner_id is null from public.partner_registrations where id = :'rid'), 'approved, but not onboarded before SSI countersigns');
select pg_temp.check((select (public.onboard_registration(:'rid')) ->> 'state' = 'awaiting_countersignature'), 'retry explains it waits for the countersignature');
select public.approve_agreement_for_countersign(:'rid');
select pg_temp.trusted();
update public.registration_agreements set status = 'countersigned', updated_at = now() where registration_id = :'rid';   -- as the countersign upload does
select pg_temp.check((select status = 'activated' and partner_id is not null and partner_admin_id is null from public.partner_registrations where id = :'rid'),
  'registration complete: client record linked, no Partner Admin login');

\echo '== TEST 13 / 14: in Clients & Partnerships, portal separate'
select pg_temp.check((select o.name = 'Northwind Study Abroad' and o.status = 'Active' and not o.portal_enabled and o.onboarding_source = 'portal'
  and o.contact_name = 'Nina North' and o.email = 'nina@northwind.test' and o.partnership_officer_id = :po::uuid and o.agency_type = 'domestic'
  from public.partners o join public.agency_prospects a on a.partner_id = o.id where a.id = :ag1), 'client record from the registration: contact, officer, type kept; portal off');
select pg_temp.check((select stage = 'onboarded' and partner_id is not null from public.agency_prospects where id = :ag1), 'agency Onboarded and linked');
select pg_temp.check((select count(*) = 1 from public.partners where name ilike '%northwind%'), 'search finds exactly one Northwind client');
select pg_temp.act_as(:super);
select pg_temp.check((select business_status = 'verified' and portal_status = 'no_account' from public.partner_directory_status() s join public.agency_prospects a on a.partner_id = s.partner_id where a.id = :ag1),
  'business onboarded, portal not activated');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.profiles) = (select n from u0), 'no login created');
select pg_temp.check((select count(*) = 1 from public.partner_registration_events where registration_id = :'rid' and action = 'client_record_linked'), 'history: client record linked');

\echo '== TEST 15: repeat — nothing duplicated'
select pg_temp.act_as(:super);
select pg_temp.check((public.onboard_registration(:'rid')) ->> 'state' = 'already', 'onboarding again: already done');
select pg_temp.trusted();
update public.registration_agreements set status = 'sent' where registration_id = :'rid';
select pg_temp.check((select count(*) from public.partners) = (select n from p0) + 1, 'still exactly one new client record');

\echo '== TEST 18: one onboarding credit, to the proposal sender'
select pg_temp.check((select count(*) from public.work_activities where activity_type = 'partner_onboarded') = (select n from w0) + 1
  and exists (select 1 from public.work_activities where activity_type = 'partner_onboarded' and dedupe_key = 'agency-onboarded:' || :ag1),
  'one Partner onboarded activity, credited once');

\echo '== conflicting client records: flagged, never guessed'
select public.issue_registration_for_proposal(:pp2) as h \gset
select :'h'::jsonb ->> 'registration_id' as rid2 \gset
update public.partner_registrations set agreement_required = false, status = 'submitted', answers = '{"company_email":"tom@twinlake.test","contact_full_name":"Tom Lake"}' where id = :'rid2';
select pg_temp.act_as(:super);
select public.approve_registration(:'rid2');
select pg_temp.check((select status = 'approved' and partner_id is null from public.partner_registrations where id = :'rid2'), 'two name matches: not linked');
select pg_temp.check((select count(*) = 1 from public.partner_registration_events where registration_id = :'rid2' and action = 'onboarding_needs_review'), 'flagged for a decision');
select partner_id as nw from public.partner_registrations where id = :'rid' \gset
select pg_temp.denied(format($$select public.onboard_registration(%L, %L)$$, :'rid2', :'nw'), 'Northwind''s record cannot be chosen for another registration', '%another agency%');
select pg_temp.check((public.onboard_registration(:'rid2', 'nr-tw1')) ->> 'state' = 'chosen', 'administrator chooses the right record');
select pg_temp.check((select partner_id = 'nr-tw1' from public.agency_prospects where id = :ag2), 'agency linked to the chosen record');

\echo '== agreement type for an unclassified registration'
select pg_temp.act_as(:super);
select public.create_partner_registration('Standalone Agency') ->> 'id' as srid \gset
select public.set_registration_agreement_type(:'srid', 'International');
select pg_temp.check((select agency_type = 'international' and status = 'not_generated' from public.registration_agreements where registration_id = :'srid'), 'type set: the agreement can now be prepared');
select pg_temp.denied(format($$select public.set_registration_agreement_type(%L, 'domestic')$$, :'rid'), 'a signed agreement keeps its type', '%already been signed%');
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.set_registration_agreement_type(%L, 'domestic')$$, :'srid'), 'a Partnership Officer cannot set it', '%authorised administrators%');

\echo '== TEST 4 / 16: a new agency cannot bypass registration'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.set_agency_stage('eeeeeeee-0000-4000-8000-000000000203', 'onboarded')$$, 'cannot be set Onboarded by hand', '%workflow%');
select pg_temp.denied($$select public.verify_historical_agency('eeeeeeee-0000-4000-8000-000000000203')$$, 'nor through historical verification', '%authorised administrators%');
select pg_temp.act_as(:super);
select pg_temp.denied($$select public.verify_historical_agency('eeeeeeee-0000-4000-8000-000000000203')$$, 'even an administrator cannot verify a new agency as historical', '%normal registration%');
rollback;
