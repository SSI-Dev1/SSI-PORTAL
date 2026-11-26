-- Onboarded agencies always reach Clients & Branches (0064): historical approval, registration, internal-link guard, idempotency.
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
\set h1    '''eeeeeeee-0000-4000-8000-000000000201'''
\set h2    '''eeeeeeee-0000-4000-8000-000000000202'''
\set h3    '''eeeeeeee-0000-4000-8000-000000000203'''
\set nw    '''eeeeeeee-0000-4000-8000-000000000204'''

begin;
select pg_temp.trusted();
insert into public.agency_prospects (id, reference, company_name, contact_name, email, phone, country, stage, assigned_officer, created_by, source,
                                     historical_onboarded, onboarding_type, agency_type, historical_status) values
  (:h1, 'AG-SY-1', 'Sync Abroad', 'Sam', 'sam@syncabroad.test', null, 'India', 'mou_sent', :po, :super, 'import', true, 'historical', 'domestic', 'requested'),
  (:h2, 'AG-SY-2', 'Twin Study', 'Tia', 'tia@twin.test', null, 'India', 'mou_sent', :po, :super, 'import', true, 'historical', null, 'requested'),
  (:h3, 'AG-SY-3', 'Direct Mix', 'Dan', 'dan@mix.test', null, 'India', 'onboarded', :po, :super, 'import', true, 'historical', null, 'requested'),
  (:nw, 'AG-SY-4', 'Fresh Agency', 'Fay', 'fay@fresh.test', null, 'India', 'new_prospect', :po, :super, 'manual', false, null, null, null);
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled) values
  ('sy-t1', 'Twin Study', 'SYT1', 'One', 'one@twin.test', 'Active', false),
  ('sy-t2', 'Twin  study', 'SYT2', 'Two', 'two@twin.test', 'Active', false);
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, internal) values ('direct', 'Direct', 'DIRECT', 'SSI GLOBAL', 'direct@ssiglobal.invalid', 'Onboarding', false, true)
  on conflict (id) do update set internal = true;
create temp table w0 as select count(*) n from public.work_activities;
grant select on w0 to authenticated;

\echo '== TEST 6: approving historical onboarding puts the agency in Clients & Branches automatically'
select pg_temp.act_as(:super);
select public.review_historical_onboarding(array[:h1::uuid], 'approve', 'Onboarded in 2024 per the old sheet', null, null);
select pg_temp.trusted();
select pg_temp.check((select o.name = 'Sync Abroad' and o.contact_name = 'Sam' and o.agency_type = 'domestic' and o.partnership_officer_id = :po::uuid
  and o.onboarding_source = 'historical' and not o.portal_enabled and not o.internal and o.archived_at is null
  from public.agency_prospects a join public.partners o on o.id = a.partner_id where a.id = :h1), 'client record created from the agency itself (contact, type, officer kept; no login)');
select pg_temp.check((select reference = 'AG-SY-1' and stage = 'onboarded' and not needs_reconciliation from public.agency_prospects where id = :h1), 'same agency ID and reference');

\echo '== ambiguous match: flagged for an administrator, nothing guessed'
select pg_temp.act_as(:super);
select public.review_historical_onboarding(array[:h2::uuid], 'approve', 'Onboarded in 2024 per the old sheet', null, null);
select pg_temp.trusted();
select pg_temp.check((select partner_id is null and needs_reconciliation from public.agency_prospects where id = :h2), 'two possible client records: left for review');
select pg_temp.check((select count(*) from public.partners where name ilike 'twin%study') = 2, 'no third record created');

\echo '== TEST 5: idempotent'
select pg_temp.trusted();
create temp table p1 as select count(*) n from public.partners;
select public.sync_onboarded_agency_client(:h1, 'again');
select public.sync_onboarded_agency_client(:h1, 'again');
select pg_temp.check((select count(*) from public.partners) = (select n from p1), 'running again creates nothing');
select pg_temp.check((select count(*) from public.agency_prospects where partner_id = (select partner_id from public.agency_prospects where id = :h1)) = 1, 'one agency per client record');

\echo '== internal records are never a client record for an agency'
select pg_temp.denied($$update public.agency_prospects set partner_id = 'direct' where id = 'eeeeeeee-0000-4000-8000-000000000203'$$, 'linking to Direct is refused', '%internal record%');
select pg_temp.act_as(:super);
select pg_temp.denied($$select public.reconcile_agencies_to_clients(array['eeeeeeee-0000-4000-8000-000000000203'::uuid], 'Choose Direct for this agency', 'direct')$$, 'and through the administrator tools', '%');

\echo '== unlinking a wrong link re-synchronises to the agency''s own record'
select pg_temp.trusted();
alter table public.agency_prospects disable trigger agency_prospects_partner_guard;
update public.agency_prospects set partner_id = 'direct', historical_status = 'approved' where id = :h3;   -- the live Algate situation
alter table public.agency_prospects enable trigger agency_prospects_partner_guard;
update public.agency_prospects set partner_id = null where id = :h3;
select pg_temp.check((select o.name = 'Direct Mix' and not o.internal from public.agency_prospects a join public.partners o on o.id = a.partner_id where a.id = :h3),
  'agency gets its own client record once the internal link is removed');

\echo '== TEST 14: a new agency cannot jump to Onboarded'
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.set_agency_stage('eeeeeeee-0000-4000-8000-000000000204', 'onboarded', null)$$, 'stage change to Onboarded without registration is refused', '%');
select pg_temp.trusted();
select pg_temp.check((select partner_id is null from public.agency_prospects where id = :nw), 'no client record for an unapproved agency');

\echo '== TEST 15: no Daily Work Report activity from synchronisation'
select pg_temp.check((select count(*) from public.work_activities) = (select n from w0), 'no work activities recorded');

\echo '== TEST 10 / 12: visible in the directory without a login, counted once'
select pg_temp.check((select count(*) from public.partners o join public.agency_prospects a on a.partner_id = o.id
  where a.id in (:h1, :h3) and o.archived_at is null and not o.internal and not exists (select 1 from public.profiles u where u.partner_id = o.id)) = 2,
  'both clients exist without any portal login, not archived or internal');
rollback;
