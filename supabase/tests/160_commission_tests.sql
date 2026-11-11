-- Commission management (0029): import, tiers, partner visibility, tagging, custom agreements, applications.
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
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''
\set pso     '''00000000-0000-0000-0000-0000000000f5'''

-- Two sheet rows as the app's parser produces them (values from the commission sheet format).
select name as u1name from public.universities where id = 'u1' \gset
select jsonb_build_array(
  jsonb_build_object('source_key', 'sheet:united_kingdom|' || lower(:'u1name') || '|ug - unimatch|', 'source_row_number', 2, 'university_name', :'u1name',
    'intake', 'January/February 2027', 'study_level', 'UG', 'student_market', 'India', 'route', 'portal', 'provider_label', 'UNIMATCH',
    'needs_review', true, 'review_notes', 'Currency not stated in the sheet',
    'tiers', jsonb_build_array(
      jsonb_build_object('tier_id', 'tier_1', 'raw_value', '5000', 'value_kind', 'amount', 'value', '5000'),
      jsonb_build_object('tier_id', 'tier_2', 'raw_value', '4000', 'value_kind', 'amount', 'value', '4000'),
      jsonb_build_object('tier_id', 'tier_3', 'raw_value', '4000', 'value_kind', 'amount', 'value', '4000')),
    'internal', jsonb_build_object('received_raw', 'UG - 5500', 'received_kind', 'amount', 'received_value', '5500', 'margin_raw', '500', 'margin_kind', 'amount', 'margin_value', '500'),
    'source_row', jsonb_build_object('(column A)', :'u1name', 'WHAT WE GETTING', 'UG - 5500', 'PORTAL', 'UG - UNIMATCH', 'OUR COMMISSION TIER 1', '5000', 'PROFIT', '500', 'TIER 2', '4000', 'TIER 3', '4000')),
  jsonb_build_object('source_key', 'sheet:united_kingdom|university of greenwich|crizac|', 'source_row_number', 11, 'university_name', 'University of Greenwich',
    'intake', 'January/February 2027', 'student_market', 'India', 'route', 'portal', 'provider_label', 'CRIZAC', 'currency', 'GBP',
    'conditions', '750 GBP bonus on top of the commission',
    'tiers', jsonb_build_array(
      jsonb_build_object('tier_id', 'tier_1', 'raw_value', '0.2', 'value_kind', 'percent', 'value', '20'),
      jsonb_build_object('tier_id', 'tier_2', 'raw_value', '0.2', 'value_kind', 'percent', 'value', '20'),
      jsonb_build_object('tier_id', 'tier_3', 'raw_value', '0.18', 'value_kind', 'percent', 'value', '18')),
    'internal', jsonb_build_object('received_raw', '22.5 / 750 GBP Bonus', 'received_kind', 'percent', 'received_value', '22.5', 'margin_raw', '0.025', 'margin_kind', 'percent', 'margin_value', '2.5'),
    'source_row', jsonb_build_object('(column A)', 'University of Greenwich', 'PORTAL', 'CRIZAC'))
) as rows \gset

-- Staff permissions: f3 (Partnership Officer) may view + tag; f5 may only view.
update public.profiles set permissions = '{partners,catalogue,tasks,commission_view,commission_tag}' where id = :po;
update public.profiles set permissions = '{partners,tasks,commission_view}' where id = :pso;

\echo '== permissions'
begin; select pg_temp.act_as(:admin);
update public.profiles set permissions = '{partners,commission_internal}' where id = :pso;
select pg_temp.trusted();
select pg_temp.check((select not ('commission_internal' = any (permissions)) from public.profiles where id = :pso), 'only a Super Admin grants commission permissions');
rollback;
begin; select pg_temp.act_as(:admin);
select pg_temp.check((select count(*) from public.commission_tiers) = 0, 'staff without commission permissions see nothing');
rollback;

\echo '== import (preview, apply, re-import)'
begin;
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.preview_commission_import('United Kingdom', %L::jsonb)$$, :'rows'), 'a tagger cannot import sheets', '%cannot import%');
select pg_temp.act_as(:super);
select public.preview_commission_import('United Kingdom', :'rows') as pv \gset
select pg_temp.check((:'pv'::jsonb -> 'counts' ->> 'new')::int = 2 and (:'pv'::jsonb -> 'country' ->> 'new')::boolean, 'preview: 2 new records, new country');
select pg_temp.check(jsonb_array_length(:'pv'::jsonb -> 'new_providers') = 2, 'preview lists the new portals');
select pg_temp.check((select count(*) from public.commission_records) = 0, 'preview writes nothing');
select public.apply_commission_import('United Kingdom', 'commission.xlsx', 'Sheet1', :'rows');
select pg_temp.check((select count(*) from public.commission_records where country_id = 'united_kingdom') = 2, 'two records imported for United Kingdom');
select pg_temp.check((select array_agg(name order by name) from public.commission_providers) = '{CRIZAC,UNIMATCH}', 'portals created with their sheet names');
select pg_temp.check((select university_id = 'u1' from public.commission_records where provider_label = 'UNIMATCH'), 'record linked to the catalogue university by name');
select pg_temp.check((select i.source_row ->> 'WHAT WE GETTING' = 'UG - 5500' from public.commission_internal i join public.commission_records r on r.id = i.record_id where r.provider_label = 'UNIMATCH'),
  'the full source row is kept with original headers');
select pg_temp.check((select value = 20 and value_kind = 'percent' from public.commission_tier_rates t join public.commission_records r on r.id = t.record_id
  where r.provider_label = 'CRIZAC' and t.tier_id = 'tier_1'), 'percent stored exactly (0.2 → 20)');
select public.apply_commission_import('United Kingdom', 'commission.xlsx', 'Sheet1', :'rows');
select pg_temp.check((select count(*) from public.commission_records) = 2, 're-importing the same sheet creates no duplicates');
select pg_temp.check((select count(*) from public.commission_imports) = 2, 'every import is in the history');

-- the other test blocks need this data: keep it
commit;

\echo '== who sees what'
select id as rec_gre from public.commission_records where provider_label = 'CRIZAC' \gset
select id as rec_u1 from public.commission_records where provider_label = 'UNIMATCH' \gset
begin; select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.commission_records) = 2 and (select count(*) from public.commission_tier_rates) = 6, 'viewer sees records and Tier 1/2/3 rates');
select pg_temp.check((select count(*) from public.commission_internal) = 0, 'viewer never sees SSI GLOBAL internal commission or profit');
select pg_temp.denied(format($$select public.save_commission_record(%L, '{"country_id":"united_kingdom","university_name":"X Uni","route":"direct"}', null)$$, :'rec_gre'),
  'restricted staff cannot edit master records', '%cannot edit%');
select pg_temp.denied(format($$select public.tag_partner_commission('p1', %L, 'tier_1')$$, :'rec_gre'), 'view-only staff cannot tag agencies', '%cannot tag%');
rollback;
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.commission_records) + (select count(*) from public.commission_tier_rates) + (select count(*) from public.commission_internal) = 0,
  'partners cannot read commission tables directly');
rollback;

\echo '== tagging, approval, custom agreements'
begin;
select pg_temp.act_as(:po);
select public.tag_partner_commission('p1', :'rec_gre', 'tier_1', null, null, null, 'Discussed with p1 owner') ->> 'status' as st1 \gset
select pg_temp.check(:'st1' = 'active', 'a Partnership Officer tags an agency to Tier 1 (active)');
select pg_temp.denied(format($$select public.tag_partner_commission('p1', %L, 'tier_1')$$, :'rec_gre'), 'tagging the same tier twice is refused', '%already has%');
select public.tag_partner_commission('p1', :'rec_gre', 'tier_3') ->> 'status' as st2 \gset
select pg_temp.check(:'st2' = 'pending_approval', 'changing an existing agreement waits for approval');
select pg_temp.check((select tier_id from public.partner_commission_assignments where partner_id = 'p1' and record_id = :'rec_gre' and status = 'active') = 'tier_1',
  'the live agreement is unchanged until approved');
select id as pend from public.partner_commission_assignments where partner_id = 'p1' and status = 'pending_approval' \gset
select pg_temp.denied(format($$select public.decide_partner_commission(%L, true)$$, :'pend'), 'a tagger cannot approve', '%commission managers%');
select pg_temp.denied(format($$select public.set_custom_partner_commission('p1', %L, 'tier_1', 'percent', 19, null, null, null, null, 'special deal')$$, :'rec_gre'),
  'a tagger cannot set custom commissions', '%commission managers%');

select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) = 1 and bool_and(tier = 'Tier 1' and commission_value = 20 and commission_kind = 'percent' and not is_custom) from public.my_partner_commissions()),
  'Partner Admin sees only their Tier 1 rate');
select pg_temp.check((select count(*) from public.partner_commission_signals where partner_id = 'p1') = 1, 'Partner Admin can follow their change signal');
select pg_temp.act_as(:p1staff);
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'partner employees see no commission');
select pg_temp.act_as(:p2admin);
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'another partner cannot see p1''s agreement');
select pg_temp.check((select count(*) from public.partner_commission_signals where partner_id = 'p1') = 0, 'nor its change signal');

select pg_temp.act_as(:super);
select public.decide_partner_commission(:'pend', true, 'Agreed');
select pg_temp.check((select tier_id from public.partner_commission_assignments where partner_id = 'p1' and record_id = :'rec_gre' and status = 'active') = 'tier_3',
  'approved change is live; the earlier agreement is kept as inactive');
select public.set_custom_partner_commission('p1', :'rec_gre', 'tier_1', 'percent', 19.5, null, null, null, 'Includes the bonus terms', 'Special deal for p1');
select pg_temp.check((select value from public.commission_tier_rates where record_id = :'rec_gre' and tier_id = 'tier_1') = 20, 'a custom agreement never changes the master rate');
select pg_temp.check((select count(*) from public.commission_assignment_history where partner_id = 'p1') >= 4, 'every change is in the history');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select is_custom and commission_value = 19.5 and conditions like '%Includes the bonus terms%' from public.my_partner_commissions()), 'the partner sees their custom rate');
select pg_temp.check((select count(*) from public.my_partner_commissions() where conditions like '%Special deal%') = 0, 'internal remarks never reach the partner');
select pg_temp.act_as(:super);
select public.tag_partner_commission('p2', :'rec_gre', 'tier_2');
commit;

\echo '== re-import with changed rates'
begin;
select pg_temp.act_as(:super);
select jsonb_set(:'rows'::jsonb, '{1,tiers,0}', jsonb_build_object('tier_id', 'tier_1', 'raw_value', '0.21', 'value_kind', 'percent', 'value', '21')) as rows2 \gset
select jsonb_set(:'rows2'::jsonb, '{1,tiers,1}', jsonb_build_object('tier_id', 'tier_2', 'raw_value', '0.19', 'value_kind', 'percent', 'value', '19')) as rows2 \gset
select public.preview_commission_import('United Kingdom', :'rows2') as pv2 \gset
select pg_temp.check((:'pv2'::jsonb -> 'counts' ->> 'changed')::int = 1 and (:'pv2'::jsonb -> 'counts' ->> 'unchanged')::int = 1, 'preview finds 1 changed and 1 unchanged record');
select pg_temp.check((:'pv2'::jsonb ->> 'affected_standard_assignments')::int = 1, 'preview counts the standard agreement (p2) that would change; the custom one is excluded');
select pg_temp.denied(format($$select public.apply_commission_import('United Kingdom', 'v2.xlsx', 'Sheet1', %L::jsonb)$$, :'rows2'), 'applying needs explicit confirmation', 'CONFIRM_PARTNER_CHANGES%');
select public.apply_commission_import('United Kingdom', 'v2.xlsx', 'Sheet1', :'rows2', true);
select pg_temp.check((select count(*) from public.commission_record_versions where record_id = :'rec_gre') >= 1, 'the previous version is kept');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select commission_value from public.my_partner_commissions()) = 19.5, 'the custom agreement is untouched by the import');
select pg_temp.act_as(:p2admin);
select pg_temp.check((select commission_value from public.my_partner_commissions()) = 19, 'p2 (standard Tier 2) sees the confirmed new rate');
rollback;

\echo '== applications'
begin;
select pg_temp.act_as(:super);
select public.tag_partner_commission('p1', :'rec_u1', 'tier_2');
select pg_temp.trusted();
select partner_id as s1partner from public.students where id = 's1' \gset
select pg_temp.check(:'s1partner' = 'p1', 'fixture: student s1 belongs to p1');
insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('cm1', 's1', 'u1', 'c1', 'Jan 2031', 'Draft');
select pg_temp.check((select match = 'matched' and record_id = :'rec_u1' from public.application_commissions where application_id = 'cm1'), 'one clear agreement → matched');
-- a second portal for the same university makes it ambiguous
select pg_temp.act_as(:super);
select public.save_commission_record(null, jsonb_build_object('country_id', 'united_kingdom', 'university_name', :'u1name', 'university_id', 'u1', 'route', 'direct'),
  '[{"tier_id":"tier_1","raw_value":"15%","value_kind":"percent","value":"15"}]', null) as rec_direct \gset
select public.tag_partner_commission('p1', :'rec_direct', 'tier_1');
select pg_temp.check((select match = 'ambiguous' and record_id is null and candidates = 2 from public.application_commissions where application_id = 'cm1'),
  'two possible agreements → ambiguous, nothing assigned automatically');
select id as a_direct from public.partner_commission_assignments where record_id = :'rec_direct' and status = 'active' \gset
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.confirm_application_commission('cm1', %L)$$, :'a_direct'), 'only a commission manager resolves it', '%commission managers%');
select pg_temp.act_as(:super);
select public.confirm_application_commission('cm1', :'a_direct');
select pg_temp.check((select match = 'confirmed' and record_id = :'rec_direct' from public.application_commissions where application_id = 'cm1'), 'manager confirms the right agreement');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.application_commissions) = 0, 'partners never see application commission links');
rollback;
