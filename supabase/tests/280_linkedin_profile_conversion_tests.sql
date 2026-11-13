-- LinkedIn prospect profile, contact status and Move to Agency List (0041). Synthetic rows only.
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
create or replace function pg_temp.work(emp text, t text) returns bigint language sql as $$
  select count(*) from public.work_activities where employee_id = emp::uuid and activity_type = t;
$$;

\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set app '''00000000-0000-0000-0000-0000000000f4'''

begin;
select pg_temp.trusted();
-- f2 is the Senior IRM (Agencies & proposals by designation); f3 reports to f2.
update public.profiles set permissions = array_append(coalesce(permissions, public.role_default_permissions(role)), 'agency_outreach')
where id = :mgr and not ('agency_outreach' = any (coalesce(permissions, public.role_default_permissions(role))));
create temp table base as select (select count(*) from public.agency_prospects) agencies, (select count(*) from public.partners) partners,
  (select count(*) from public.profiles where partner_id is not null) partner_users,
  pg_temp.work('00000000-0000-0000-0000-0000000000f3', 'linkedin_connection') conn0,
  pg_temp.work('00000000-0000-0000-0000-0000000000f3', 'partner_call') calls0,
  pg_temp.work('00000000-0000-0000-0000-0000000000f3', 'linkedin_converted') conv0;
grant select on base to authenticated;

\echo '== TEST 1: a name is enough'
select pg_temp.act_as(:po);
select (public.create_linkedin_prospect('{"name": "Hari"}'::jsonb, gen_random_uuid()) ->> 'id') as hari \gset
select pg_temp.check((select reference like 'LI-%' and company_name is null and phone is null and email is null and contact_status = 'unknown' and status = 'not_contacted'
                      from public.linkedin_prospects where id = :'hari'), 'Hari saved with only a name, own reference, contact Not recorded');
select pg_temp.check((select count(*) from public.agency_prospects) = (select agencies from base), 'adding a prospect creates no agency');
select pg_temp.check(pg_temp.work(:po, 'linkedin_connection') = (select conn0 from base), 'adding is not counted as a contact');

\echo '== TEST 3: contact status'
select public.set_linkedin_contact_status(:'hari', 'connected', 'Accepted my request', gen_random_uuid());
select pg_temp.check((select contact_status = 'connected' and contact_changed_by = :po::uuid and contact_changed_at is not null and status = 'contacted' and last_contact_at is not null
                      from public.linkedin_prospects where id = :'hari'), 'Connected saved with the employee and time');
select pg_temp.check(pg_temp.work(:po, 'linkedin_connection') = (select conn0 from base) + 1, 'first Connected counts once as a LinkedIn connection');
select public.set_linkedin_contact_status(:'hari', 'not_connected', null, gen_random_uuid());
select public.set_linkedin_contact_status(:'hari', 'connected', null, gen_random_uuid());
select public.log_linkedin_activity(:'hari', 'contacted', 'messaged again', null, gen_random_uuid());
select pg_temp.check(pg_temp.work(:po, 'linkedin_connection') = (select conn0 from base) + 1, 'switching back and forth, or also recording contact, never counts twice');
select pg_temp.check((select count(*) from public.linkedin_activities where prospect_id = :'hari' and kind = 'contact_status') = 3, 'each status change is in the activity history');
select pg_temp.denied(format($$select public.set_linkedin_contact_status(%L, 'interested', null, gen_random_uuid())$$, :'hari'), 'only Connected or Not connected', '%Connected or Not connected%');

\echo '== TEST 4: Move to Agency List needs the mandatory fields'
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{"contact_name": "Hari Kumar"}'::jsonb)$$, :'hari'),
  'no agency name and no phone: both are asked for', '%agency / company name%valid phone number%');
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{"company_name": "Hari Overseas"}'::jsonb)$$, :'hari'), 'no phone: asked for', '%valid phone number%');
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{"company_name": "Hari Overseas", "phone": "12ab"}'::jsonb)$$, :'hari'), 'invalid phone rejected', '%valid phone number%');
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{"company_name": "Hari Overseas", "phone": "+91 98950 22222", "email": "nope"}'::jsonb)$$, :'hari'), 'invalid email rejected', '%valid email%');
select pg_temp.check((select agency_id is null and status <> 'converted' from public.linkedin_prospects where id = :'hari'), 'nothing changes while the form is incomplete');

\echo '== TEST 5 / 6: conversion without email keeps everything'
select public.convert_linkedin_prospect(:'hari', '{"company_name": "Hari Overseas", "contact_name": "Hari Kumar", "phone": "+91 98950 22222", "country": "India", "notes": "Prefers WhatsApp"}'::jsonb) as c1 \gset
select (:'c1'::jsonb ->> 'agency_id') as ag \gset
select pg_temp.check(not (:'c1'::jsonb ->> 'linked')::boolean, 'a new agency is created');
select pg_temp.check((select company_name = 'Hari Overseas' and contact_name = 'Hari Kumar' and phone = '+91 98950 22222' and email is null and country = 'India'
                      and source = 'linkedin' and source_values ->> 'linkedin_id' = :'hari' and stage = 'new_prospect' and assigned_officer = :po::uuid and notes like '%Prefers WhatsApp%'
                      from public.agency_prospects where id = :'ag'), 'agency has name, full POC name, phone as text, no email, source LinkedIn with the prospect id');
select pg_temp.check((select contact_status = 'connected' and first_connected_at is not null from public.agency_prospects where id = :'ag'), 'the agency carries the prospect''s recorded contact status');
select pg_temp.check((select status = 'converted' and agency_id = :'ag'::uuid and converted_by = :po::uuid from public.linkedin_prospects where id = :'hari'), 'prospect marked Converted and linked');
select pg_temp.check((select count(*) from public.linkedin_activities where prospect_id = :'hari') >= 6, 'the LinkedIn history is kept');
select pg_temp.check(pg_temp.work(:po, 'linkedin_converted') = (select conv0 from base) + 1, 'conversion recorded once for the employee');
select pg_temp.check(pg_temp.work(:po, 'partner_call') = (select calls0 from base), 'conversion is not counted as a call');

\echo '== TEST 10: no duplicates'
select pg_temp.check((select (r ->> 'duplicate')::boolean and r ->> 'agency_id' = :'ag' from public.convert_linkedin_prospect(:'hari', '{"company_name": "Another", "contact_name": "X", "phone": "9000000000"}'::jsonb) r),
  'moving the same prospect again returns the same agency');
select (public.create_linkedin_prospect('{"name": "Hari K", "phone": "9895022222"}'::jsonb, gen_random_uuid()) ->> 'id') as hari2 \gset
select pg_temp.check((select (r ->> 'linked')::boolean and r ->> 'agency_id' = :'ag' from public.convert_linkedin_prospect(:'hari2', '{"company_name": "Hari Overseas Pvt", "contact_name": "Hari K"}'::jsonb) r),
  'another prospect with the same number (without country code) links to the existing agency');
select pg_temp.check((select count(*) from public.agency_prospects) = (select agencies from base) + 1, 'only one agency exists');
select pg_temp.check(pg_temp.work(:po, 'linkedin_converted') = (select conv0 from base) + 2, 'each prospect counts its own conversion once');

\echo '== no contact invented'
select (public.create_linkedin_prospect('{"name": "Meera Nair", "company_name": "Nair Edu"}'::jsonb, gen_random_uuid()) ->> 'id') as meera \gset
select (public.convert_linkedin_prospect(:'meera', '{"contact_name": "Meera Nair", "phone": "0484 2345678"}'::jsonb) ->> 'agency_id') as ag2 \gset
select pg_temp.check((select company_name = 'Nair Edu' and contact_status = 'unknown' and first_contact_at is null and first_connected_at is null and last_contact_at is null
                      from public.agency_prospects where id = :'ag2'), 'prefilled company name used; Not recorded stays Not recorded, no contact dates');

\echo '== TEST 11: Senior IRM'
select pg_temp.act_as(:mgr);
select pg_temp.check(exists (select 1 from public.linkedin_prospects where id = :'meera'), 'the Senior IRM sees the team member''s prospect');
select (public.create_linkedin_prospect('{"name": "Ravi"}'::jsonb, gen_random_uuid()) ->> 'id') as ravi \gset
select public.set_linkedin_contact_status(:'ravi', 'not_connected', null, gen_random_uuid());
select pg_temp.check((select (r ->> 'agency_id') is not null from public.convert_linkedin_prospect(:'ravi', '{"company_name": "Ravi Global", "contact_name": "Ravi Menon", "phone": "+44 20 7946 0999"}'::jsonb) r),
  'the Senior IRM can move a prospect to the Agency List');
select pg_temp.check((select contact_status = 'not_connected' and assigned_officer = :mgr::uuid from public.agency_prospects where company_name = 'Ravi Global'), 'Not connected and the Senior IRM as officer are kept');
select pg_temp.act_as(:app);
select pg_temp.denied($$select public.create_linkedin_prospect('{"name": "Nope"}'::jsonb, gen_random_uuid())$$, 'employees without Agencies access cannot add prospects', '%Not allowed%');
select pg_temp.denied(format($$select public.set_linkedin_contact_status(%L, 'connected', null, gen_random_uuid())$$, :'meera'), 'or change their contact status', '%Not allowed%');
select pg_temp.denied(format($$select public.convert_linkedin_prospect(%L, '{}'::jsonb)$$, :'hari2'), 'or move them', '%Not allowed%');

\echo '== access is not granted by moving'
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.partners) = (select partners from base) and (select count(*) from public.profiles where partner_id is not null) = (select partner_users from base),
  'no partner organisation or login is created');

\echo '== name keys'
select pg_temp.check(public.agency_name_key('S&S  Overseas') = 's&s overseas' and public.agency_name_key('S&S Overseas') <> public.agency_name_key('SS Overseas'),
  'duplicate matching ignores only case and spacing (0035 rule restored)');
select pg_temp.check(public.agency_suggest_key('S&S Overseas') = public.agency_suggest_key('SS Overseas'), 'Clients & Branches suggestions use the looser key');
rollback;
