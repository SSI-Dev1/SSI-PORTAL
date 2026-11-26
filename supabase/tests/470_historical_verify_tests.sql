-- One-click historical verification: Verify → Done adds the agency to Clients & Partnerships (0062).
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
\set alg   '''eeeeeeee-0000-4000-8000-000000000101'''
\set lnk   '''eeeeeeee-0000-4000-8000-000000000102'''
\set dup   '''eeeeeeee-0000-4000-8000-000000000103'''
\set new   '''eeeeeeee-0000-4000-8000-000000000104'''

begin;
select pg_temp.trusted();
update public.profiles set permissions = array['agency_outreach', 'partners', 'tasks'] where id = :po;
insert into public.agency_prospects (id, reference, company_name, contact_name, email, phone, country, stage, assigned_officer, created_by, source,
                                     historical_onboarded, onboarding_type, agency_type) values
  (:alg, 'AG-26-B1ADC6', 'Algate', 'Saurabh', 'saurabh@algate.test', '+44 20 7000 2222', 'United Kingdom', 'onboarded', :po, :super, 'import', true, 'historical', 'international'),
  (:lnk, 'AG-VLK-1', 'Verify Link Ltd', 'Vee', 'vee@vlink.test', null, 'India', 'onboarded', :po, :super, 'import', true, 'historical', null),
  (:dup, 'AG-VDP-1', 'Double Study', 'Dee', 'dee@double.test', null, 'India', 'onboarded', :po, :super, 'import', true, 'historical', null),
  (:new, 'AG-VNW-1', 'Brand New Agency', 'Nia', 'nia@new.test', null, 'India', 'new_prospect', :po, :super, 'manual', false, null, null);
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled) values
  ('vf-link', 'Verify Link Limited', 'VFLNK', 'Vee', 'vee@vlink.test', 'Active', false),
  ('vf-d1', 'Double Study', 'VFD1', 'D One', 'one@double.test', 'Active', false),
  ('vf-d2', 'Double  study', 'VFD2', 'D Two', 'two@double.test', 'Active', false);
create temp table w0 as select count(*) n from public.work_activities;
create temp table p0 as select count(*) n from public.partners;
create temp table u0 as select count(*) n from public.profiles;
grant select on w0, p0, u0 to authenticated;

\echo '== permissions: only authorised administrators verify'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.verify_historical_agency('eeeeeeee-0000-4000-8000-000000000101')$$, 'a Partnership Officer cannot verify', '%authorised administrators%');

\echo '== Algate: Verify (no partner search, no reason)'
select pg_temp.act_as(:super);
select public.verify_historical_agency(:alg) as r \gset
select pg_temp.check(:'r'::jsonb ->> 'status' = 'created' and :'r'::jsonb ->> 'partner_name' = 'Algate', 'Verify creates the Algate client record from the agency itself');
select pg_temp.check((select o.name = 'Algate' and o.contact_name = 'Saurabh' and o.email = 'saurabh@algate.test' and o.agency_type = 'international'
  and o.partnership_officer_id = :po::uuid and o.onboarding_source = 'historical' and not o.portal_enabled
  from public.partners o join public.agency_prospects a on a.partner_id = o.id where a.id = :alg), 'contact, officer, type kept; business onboarded; portal off');
select pg_temp.check((select historical_status = 'approved' and historical_reviewed_by = :super::uuid and reference = 'AG-26-B1ADC6' and company_name = 'Algate' and stage = 'onboarded'
  from public.agency_prospects where id = :alg), 'same agency (ID and name) marked historically verified');
select pg_temp.check((select count(*) = 1 from public.partners where name ilike '%algate%' and archived_at is null), 'search "Algate" in Clients & Partnerships finds exactly one record');
select pg_temp.check((select verification = 'verified' from public.onboarded_agency_directory() where agency_id = :alg), 'moved out of "needs review"');
select pg_temp.check(not exists (select 1 from public.profiles p join public.agency_prospects a on a.partner_id = p.partner_id where a.id = :alg)
  and (select count(*) from public.profiles) = (select n from u0), 'no login or password created');
select pg_temp.check((select business_status = 'historical' and portal_status = 'no_account' from public.partner_directory_status() s join public.agency_prospects a on a.partner_id = s.partner_id where a.id = :alg),
  'directory: onboarded, portal not activated');

\echo '== Verify again: nothing duplicated'
select public.verify_historical_agency(:alg) as r2 \gset
select pg_temp.check(:'r2'::jsonb ->> 'status' = 'already', 'second Verify reports already in Clients & Partnerships');
select pg_temp.check((select count(*) from public.partners) = (select n from p0) + 1, 'still exactly one new client record');

\echo '== exact match is reused automatically'
select public.verify_historical_agency(:lnk) as r3 \gset
select pg_temp.check(:'r3'::jsonb ->> 'status' = 'linked' and (select partner_id = 'vf-link' from public.agency_prospects where id = :lnk), 'exact email match linked, no new record');
select pg_temp.check((select count(*) from public.partners) = (select n from p0) + 1, 'no client record created for the match');

\echo '== conflicting matches are flagged, never guessed'
select public.verify_historical_agency(:dup) as r4 \gset
select pg_temp.check(:'r4'::jsonb ->> 'status' = 'review' and jsonb_array_length(:'r4'::jsonb -> 'candidates') = 2, 'two matches: review with both candidates');
select pg_temp.check((select partner_id is null and needs_reconciliation and reconciliation_note like 'Several%' from public.agency_prospects where id = :dup), 'nothing linked; only this agency flagged for review');

\echo '== new agencies keep the normal onboarding'
select pg_temp.denied($$select public.verify_historical_agency('eeeeeeee-0000-4000-8000-000000000104')$$, 'a new prospect cannot be verified here', '%normal registration%');
select pg_temp.check((select partner_id is null and stage = 'new_prospect' from public.agency_prospects where id = :new), 'the new agency is untouched');

\echo '== no employee work, history kept'
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'verification adds nothing to any Daily Work Report');
select pg_temp.check((select count(*) = 2 from public.audit_log where action = 'client_reconciled' and entity_id in (:alg::text, :lnk::text)), 'audit log records both verifications');
rollback;
