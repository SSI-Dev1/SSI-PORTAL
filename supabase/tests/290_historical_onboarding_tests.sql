-- Historical onboarded clients: reconciliation, business vs portal status, summary (0042). Synthetic rows only.
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

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''

begin;
select pg_temp.trusted();
insert into public.partners (id, name, code, contact_name, email, phone, status, portal_enabled) values
  ('hx_exact', 'Exact Overseas', 'HXE', 'E', 'hello@exact.test', null, 'Active', true),
  ('hx_phone', 'Phone Partner Ltd', 'HXP', 'P', 'p@phone.test', '9876500001', 'Active', true),
  ('hx_delta', 'Deltaa', 'HXD', 'D', 'd@delta.test', null, 'Active', true),
  ('hx_m1', 'Multi One', 'HXM1', 'M', 'dup@multi.test', null, 'Active', true),
  ('hx_m2', 'Multi Two', 'HXM2', 'M', 'dup@multi.test', null, 'Active', true);
insert into public.agency_prospects (id, reference, company_name, contact_name, phone, email, country, contact_status, stage, assigned_officer, source, source_status, historical_onboarded, needs_reconciliation) values
  ('b0000000-0000-4000-8000-000000000001', 'AG-H-01', 'exact  overseas', 'Eva', '9000011111', 'other@exact.test', null, 'connected', 'onboarded', :po, 'import', 'Onboarded', true, true),
  ('b0000000-0000-4000-8000-000000000002', 'AG-H-02', 'Phone Match Edu', 'Pia', '+91 98765 00001', null, null, 'connected', 'onboarded', :po, 'import', 'Onboarded', true, true),
  ('b0000000-0000-4000-8000-000000000003', 'AG-H-03', 'Deltaa Study Abroad', 'Dev', '9000033333', 'dev@deltaa.test', null, 'connected', 'onboarded', :po, 'import', 'Onboarded', true, true),
  ('b0000000-0000-4000-8000-000000000004', 'AG-H-04', 'New Historic Co', 'Nina Nair', '9000044444', 'Nina@Historic.test', 'India', 'connected', 'onboarded', :po, 'import', 'Onboarded', true, true),
  ('b0000000-0000-4000-8000-000000000005', 'AG-H-05', 'Multi Agency', 'Mo', '9000055555', 'dup@multi.test', null, 'connected', 'onboarded', null, 'import', 'Onboarded', true, true),
  ('b0000000-0000-4000-8000-000000000006', 'AG-H-06', 'Still Proposal', 'Pat', '9000066666', null, null, 'unknown', 'proposal_sent', null, 'import', 'Proposal Send', false, false);
create temp table base as select (select count(*) from public.partners) partners, (select count(*) from public.profiles where partner_id is not null) logins,
  (select count(*) from public.work_activities) work, (select count(*) from public.notifications) notes;
grant select on base to authenticated;

\echo '== only a Super Admin'
select pg_temp.act_as(:admin);
select pg_temp.denied($$select public.reconcile_historical_onboarded(true)$$, 'Admin Staff cannot reconcile', '%Super Admin%');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.reconcile_historical_onboarded(false)$$, 'officers cannot run it', '%Super Admin%');

\echo '== preview changes nothing'
select pg_temp.act_as(:super);
select public.reconcile_historical_onboarded(false) as dry \gset
select pg_temp.check(not (:'dry'::jsonb ->> 'applied')::boolean and (select count(*) from public.partners) = (select partners from base)
  and (select count(*) from public.agency_prospects where reference like 'AG-H-%' and partner_id is not null) = 0, 'preview writes nothing');
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'dry'::jsonb -> 'created_records') e where e ->> 'reference' = 'AG-H-04'), 'preview lists the record it would create');

\echo '== apply'
select public.reconcile_historical_onboarded(true) as run1 \gset
select pg_temp.check((select partner_id = 'hx_exact' and not needs_reconciliation and stage = 'onboarded' from public.agency_prospects where reference = 'AG-H-01'), 'exact name (case and spaces ignored) links to the existing partner');
select pg_temp.check((select partner_id = 'hx_phone' from public.agency_prospects where reference = 'AG-H-02'), 'same phone with and without country code links');
select pg_temp.check((select partner_id is null and needs_reconciliation and reconciliation_note like '%Deltaa%' from public.agency_prospects where reference = 'AG-H-03'), 'a close name is flagged for review, nothing created');
select pg_temp.check((select partner_id is null and needs_reconciliation and reconciliation_note like 'Several partners match%' from public.agency_prospects where reference = 'AG-H-05'), 'several matches are flagged for review');
select pg_temp.check((select partner_id is null and stage = 'proposal_sent' from public.agency_prospects where reference = 'AG-H-06'), 'agencies that are not onboarded are untouched');
select (select partner_id from public.agency_prospects where reference = 'AG-H-04') as newp \gset
select pg_temp.check((select name = 'New Historic Co' and contact_name = 'Nina Nair' and email = 'nina@historic.test' and phone = '9000044444' and country = 'India'
                      and status = 'Active' and not portal_enabled and onboarding_source = 'historical' and partnership_officer_id = :po::uuid and not commission_visible
                      from public.partners where id = :'newp'), 'a historical client record is created with the agency''s details and officer, portal off');
select pg_temp.check((select stage = 'onboarded' and source_status = 'Onboarded' and source = 'import' from public.agency_prospects where reference = 'AG-H-04'), 'stage and the original sheet status are kept');
select pg_temp.check((select count(*) from public.profiles where partner_id is not null) = (select logins from base), 'no login is created');
select pg_temp.check((select count(*) from public.work_activities) = (select work from base), 'nothing counts as work done today');
select pg_temp.check((select count(*) from public.partners) = (select partners from base) + (:'run1'::jsonb ->> 'created')::int, 'exactly the reported client records were created');

\echo '== running it again'
select public.reconcile_historical_onboarded(true) as run2 \gset
select pg_temp.check((:'run2'::jsonb ->> 'created')::int = 0 and (:'run2'::jsonb ->> 'linked_existing')::int = 0, 'second run creates and links nothing');
select pg_temp.check((select count(*) from public.partners) = (select partners from base) + (:'run1'::jsonb ->> 'created')::int, 'no duplicate organisations');

\echo '== business onboarding vs portal access'
select pg_temp.check((select business_status = 'historical' and portal_status = 'no_account' and agency_reference = 'AG-H-04' from public.partner_directory_status() where partner_id = :'newp'),
  'historical client: Historically onboarded, no portal account');
select pg_temp.check((select business_status = 'verified' and portal_status = 'no_account' from public.partner_directory_status() where partner_id = 'hx_exact'), 'existing active partner without users: verified, no account');
select pg_temp.check((select (s ->> 'total')::int = (s ->> 'historical')::int + (s ->> 'verified')::int + (s ->> 'unlinked')::int
                         and (s ->> 'unlinked')::int >= 2 and (s ->> 'historical')::int >= 1 from public.partnership_onboarding_summary() s),
  'Onboarded total = historical + verified partners + onboarded agencies still to be linked (each once)');
select pg_temp.denied(format($$select public.issue_agency_registration(%L)$$, 'b0000000-0000-4000-8000-000000000004'), 'a linked client cannot get a second registration (no duplicate organisation)', '%already a client%');

\echo '== activation turns it into a verified, active partner'
select pg_temp.trusted();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aa01', 'nina@historic.test');
insert into public.profiles (id, role, partner_id, full_name, email, status) values ('00000000-0000-0000-0000-00000000aa01', 'partner_admin', :'newp', 'Nina Nair', 'nina@historic.test', 'active');
select pg_temp.act_as(:super);
select pg_temp.check((select business_status = 'historical' and portal_status = 'no_account' from public.partner_directory_status() where partner_id = :'newp') is not true,
  'a login changes the status');
select pg_temp.check((select business_status = 'verified' and portal_status = 'pending' from public.partner_directory_status() where partner_id = :'newp'), 'login created, portal still off: pending');
update public.partners set portal_enabled = true where id = :'newp';
select pg_temp.check((select business_status = 'verified' and portal_status = 'active' from public.partner_directory_status() where partner_id = :'newp'), 'portal opened by the Super Admin: active');
select pg_temp.check((select count(*) from public.partners where name = 'New Historic Co') = 1, 'still one organisation');

\echo '== who can read it'
select pg_temp.act_as(:po);
select pg_temp.check((select (s ->> 'mine')::int >= 1 from public.partnership_onboarding_summary() s), 'the officer sees the company total and their own onboarded clients');
select pg_temp.act_as(:app);
select pg_temp.check(public.partnership_onboarding_summary() is null and (select count(*) from public.partner_directory_status()) = 0, 'staff without Partners or Agencies access see nothing');
select pg_temp.act_as(:partner);
select pg_temp.check(public.partnership_onboarding_summary() is null and (select count(*) from public.partner_directory_status()) = 0, 'partner users see nothing');
rollback;
