-- Agency Type: Domestic / International classification (0043). Synthetic rows only.
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
\set partner '''00000000-0000-0000-0000-0000000000b1'''
\set mgr     '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set app     '''00000000-0000-0000-0000-0000000000f4'''

begin;
select pg_temp.trusted();
-- f2 is the Senior IRM: Agencies & proposals with student work, no bulk administration.
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach')
where id = :mgr and not ('agency_outreach' = any (coalesce(permissions, public.role_default_permissions(role))));
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, onboarding_source) values
  ('tx_hist', 'Type Historic Ltd', 'TXH', 'H', 'h@typehist.test', 'Active', false, 'historical'),
  ('tx_solo', 'Solo Client', 'TXS', 'S', 's@solo.test', 'Active', true, 'portal');
insert into public.agency_prospects (id, reference, company_name, contact_name, phone, stage, assigned_officer, source, source_status, historical_onboarded, partner_id) values
  ('c0000000-0000-4000-8000-000000000001', 'AG-T-01', 'Old Import One', 'O', '9100000001', 'proposal_sent', :po, 'import', 'Proposal Send', false, null),
  ('c0000000-0000-4000-8000-000000000002', 'AG-T-02', 'Old Import Two', 'T', '9100000002', 'onboarded', :po, 'import', 'Onboarded', true, 'tx_hist'),
  ('c0000000-0000-4000-8000-000000000003', 'AG-T-03', 'Old Import Three', 'R', '9100000003', 'mou_sent', :po, 'import', 'MOU Send', false, null),
  ('c0000000-0000-4000-8000-000000000004', 'AG-T-04', 'Old Import Four', 'F', '9100000004', 'onboarded', :po, 'import', 'Onboarded', true, null);
create temp table base as select (select count(*) from public.agency_prospects) agencies, (select count(*) from public.partners) partners,
  (select count(*) from public.work_activities) work;
grant select on base to authenticated;

\echo '== existing records stay Not Classified'
select pg_temp.check((select count(*) from public.agency_prospects where reference like 'AG-T-%' and agency_type is null) = 4
  and (select agency_type is null from public.partners where id = 'tx_hist'), 'imported agencies and historical clients are Not Classified (nothing assumed)');
select pg_temp.denied($$update public.agency_prospects set agency_type = 'overseas' where reference = 'AG-T-01'$$, 'only Domestic or International can be stored', '%check%');

\echo '== add agency'
select pg_temp.act_as(:po);
select (public.create_agency_prospect('{"company_name": "Kochi Domestic Edu", "phone": "9100000010", "agency_type": "domestic"}'::jsonb, gen_random_uuid()) ->> 'id') as dom \gset
select (public.create_agency_prospect('{"company_name": "London Intl Edu", "phone": "+44 20 7946 0001", "agency_type": "International"}'::jsonb, gen_random_uuid()) ->> 'id') as intl \gset
select (public.create_agency_prospect('{"company_name": "No Type Yet"}'::jsonb, gen_random_uuid()) ->> 'id') as none \gset
select pg_temp.check((select agency_type = 'domestic' and agency_type_changed_by = :po::uuid from public.agency_prospects where id = :'dom'), 'Domestic agency created');
select pg_temp.check((select agency_type = 'international' from public.agency_prospects where id = :'intl'), 'International agency created (case ignored)');
select pg_temp.check((select agency_type is null from public.agency_prospects where id = :'none'), 'type is optional when adding');
select pg_temp.denied($$select public.create_agency_prospect('{"company_name": "Bad Type", "agency_type": "local"}'::jsonb, gen_random_uuid())$$, 'invalid type rejected', '%Domestic or International%');
select pg_temp.check((select count(*) from public.agency_prospects where company_name = 'Bad Type') = 0, 'nothing saved for an invalid type');

\echo '== edit agency type'
select public.update_agency_prospect(:'dom', '{"agency_type": "international", "notes": "moved abroad"}'::jsonb);
select pg_temp.check((select agency_type = 'international' and notes = 'moved abroad' from public.agency_prospects where id = :'dom'), 'Edit Agency changes the type');
select public.update_agency_prospect(:'dom', '{"agency_type": "", "country": "India"}'::jsonb);
select pg_temp.check((select agency_type = 'international' and country = 'India' from public.agency_prospects where id = :'dom'), 'an edit without a chosen type never clears it');
select pg_temp.check((select (detail ->> 'from') is null and detail ->> 'to' = 'domestic' from public.agency_activities where prospect_id = :'dom' and kind = 'agency_type' order by id limit 1)
  and (select detail ->> 'from' = 'domestic' and detail ->> 'to' = 'international' from public.agency_activities where prospect_id = :'dom' and kind = 'agency_type' order by id desc limit 1),
  'each change is in the activity history with the previous value');
select pg_temp.check(public.set_agency_type(:'dom', 'domestic', 'confirmed with POC') and not public.set_agency_type(:'dom', 'domestic'), 'Agency Profile sets the type; same value changes nothing');

\echo '== LinkedIn → Move to Agency List'
select (public.create_linkedin_prospect('{"name": "Ravi Only"}'::jsonb, gen_random_uuid()) ->> 'id') as li \gset
select pg_temp.check((select agency_id is null from public.linkedin_prospects where id = :'li'), 'a LinkedIn prospect is still created with a name only');
select (public.convert_linkedin_prospect(:'li', '{"company_name": "Ravi Domestic Overseas", "contact_name": "Ravi Kumar", "phone": "9100000020", "agency_type": "domestic"}'::jsonb) ->> 'agency_id') as liag \gset
select pg_temp.check((select agency_type = 'domestic' and source = 'linkedin' from public.agency_prospects where id = :'liag'), 'converted to a Domestic agency');
select (public.create_linkedin_prospect('{"name": "Old Contact", "phone": "9100000001"}'::jsonb, gen_random_uuid()) ->> 'id') as li2 \gset
select pg_temp.check((select (r ->> 'linked')::boolean from public.convert_linkedin_prospect(:'li2', '{"contact_name": "Old Contact", "agency_type": "international"}'::jsonb) r), 'same phone links to the existing agency');
select pg_temp.check((select agency_type = 'international' from public.agency_prospects where reference = 'AG-T-01'), 'an unclassified existing agency takes the chosen type');
select (public.create_linkedin_prospect('{"name": "Third", "phone": "9100000020"}'::jsonb, gen_random_uuid()) ->> 'id') as li3 \gset
select public.convert_linkedin_prospect(:'li3', '{"contact_name": "Third", "agency_type": "international"}'::jsonb);
select pg_temp.check((select agency_type = 'domestic' from public.agency_prospects where id = :'liag'), 'an existing classification is not overwritten by a later conversion');

\echo '== filters use the stored field'
select pg_temp.check((select count(*) from public.agency_prospects where agency_type = 'domestic' and stage = 'onboarded') = 0
  and (select count(*) from public.agency_prospects where agency_type is null and reference like 'AG-T-%') = 3, 'Domestic + Onboarded is empty; 3 test imports still Not Classified and listed');

\echo '== bulk classification'
select pg_temp.denied($$select public.bulk_set_agency_type(array['c0000000-0000-4000-8000-000000000003'::uuid], 'domestic', null, gen_random_uuid())$$, 'officers cannot classify in bulk', '%administrators%');
select pg_temp.act_as(:super);
select public.preview_agency_type(array['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004']::uuid[], 'domestic') as pv \gset
select pg_temp.check((:'pv'::jsonb ->> 'found')::int = 4 and (:'pv'::jsonb ->> 'change')::int = 4 and (:'pv'::jsonb -> 'from' ->> 'unclassified')::int = 3
  and (:'pv'::jsonb -> 'from' ->> 'international')::int = 1, 'preview shows what will change and from what');
select pg_temp.check((select count(*) from public.agency_prospects where reference like 'AG-T-%' and agency_type = 'domestic') = 0, 'preview writes nothing');
select gen_random_uuid() as req \gset
select (select count(*) from public.work_activities) as w0 \gset
select public.bulk_set_agency_type(array['c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004']::uuid[], 'domestic', 'Kerala agents', :'req') as b1 \gset
select pg_temp.check((:'b1'::jsonb ->> 'changed')::int = 3, 'confirmed update classifies the selected agencies');
select pg_temp.check((select count(*) from public.work_activities) = :w0, 'classification adds nothing to anyone''s Daily Work Report');
select pg_temp.check((select (r ->> 'replayed')::boolean and (r ->> 'changed')::int = 3 from public.bulk_set_agency_type(array['c0000000-0000-4000-8000-000000000001']::uuid[], 'domestic', null, :'req') r)
  and (select agency_type = 'international' from public.agency_prospects where reference = 'AG-T-01'), 'a repeated request changes nothing more');
select pg_temp.check((select count(*) from public.agency_activities a join public.agency_prospects p on p.id = a.prospect_id where p.reference like 'AG-T-%' and a.kind = 'agency_type' and a.detail ->> 'bulk' = 'true') = 3
  and exists (select 1 from public.agency_bulk_operations where request_key = :'req'::uuid and kind = 'agency_type'), 'bulk changes are audited per agency and per run');

\echo '== Clients & Branches'
select pg_temp.check((select agency_type = 'domestic' from public.partners where id = 'tx_hist'), 'a linked client takes its agency''s type');
select pg_temp.check((select agency_type = 'domestic' and business_status = 'historical' from public.partner_directory_status() where partner_id = 'tx_hist'), 'directory shows the historical client as Domestic');
select pg_temp.check((select agency_type = 'domestic' and verification = 'pending' from public.onboarded_agency_directory() where reference = 'AG-T-04'), 'an onboarded agency still to review is listed with its type');
select pg_temp.check((select agency_type is null from public.partner_directory_status() where partner_id = 'tx_solo'), 'a client never classified stays listed as Not Classified');
select public.set_partner_agency_type('tx_hist', 'international');
select pg_temp.check((select o.agency_type = 'international' and a.agency_type = 'international' from public.partners o join public.agency_prospects a on a.partner_id = o.id where o.id = 'tx_hist'),
  'classifying a client updates its agency too');
select public.set_partner_agency_type('tx_solo', 'domestic');
select pg_temp.check((select agency_type = 'domestic' from public.partners where id = 'tx_solo'), 'a client without an agency can be classified');
select pg_temp.check((select count(*) from public.partners) = (select partners from base) and (select count(*) from public.agency_prospects) = (select agencies from base) + 4,
  'no duplicate agency or partner records');

\echo '== dashboard counts'
select pg_temp.check((select (s ->> 'total')::int from public.partnership_onboarding_summary() s)
  = (select (d ->> 'total')::int from public.partnership_onboarding_summary('domestic') d) + (select (i ->> 'total')::int from public.partnership_onboarding_summary('international') i)
  + (select (u ->> 'total')::int from public.partnership_onboarding_summary('unclassified') u), 'Domestic + International + Not Classified = all onboarded clients');
select pg_temp.check((select (d ->> 'unlinked')::int >= 1 from public.partnership_onboarding_summary('domestic') d), 'an unlinked onboarded Domestic agency counts as Domestic');
select pg_temp.check(public.partnership_onboarding_summary('overseas') is null, 'unknown filter returns nothing');

\echo '== who can classify'
select pg_temp.act_as(:mgr);
select pg_temp.check(public.set_agency_type(:'none', 'international'), 'the Senior IRM can classify an agency');
select pg_temp.denied($$select public.bulk_set_agency_type(array['c0000000-0000-4000-8000-000000000001'::uuid], 'domestic', null, gen_random_uuid())$$, 'but not in bulk', '%administrators%');
select pg_temp.act_as(:app);
select pg_temp.denied(format($$select public.set_agency_type(%L, 'domestic')$$, :'none'), 'staff without Agencies access cannot classify', '%Not allowed%');
select pg_temp.denied($$select public.set_partner_agency_type('tx_solo', 'international')$$, 'or classify clients', '%Not allowed%');
select pg_temp.denied($$select public.agency_apply_type('c0000000-0000-4000-8000-000000000001', 'domestic', null, '{}')$$, 'the internal helper is not callable', '%permission denied%');
select pg_temp.act_as(:partner);
select pg_temp.denied($$select public.set_partner_agency_type('tx_solo', 'international')$$, 'partner users cannot classify', '%Not allowed%');
select pg_temp.check(public.partnership_onboarding_summary('domestic') is null, 'partner users see no counts');
rollback;
