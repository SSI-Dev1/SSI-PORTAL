-- Custom proposals university by university (0038). Uses Bulkland records from 180 and terms from 210.
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
\set super '''00000000-0000-0000-0000-0000000000a1'''
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''

select id as terms from public.proposal_terms where active \gset
select id as u4 from public.commission_records where university_name = 'Bulk University 4' \gset
select id as u5 from public.commission_records where university_name = 'Bulk University 5' \gset
select id as u6 from public.commission_records where university_name = 'Bulk University 6' \gset
select id as unclear from public.commission_records where university_name = 'Unclear University' \gset
-- an amount-based record (Tier 2 = GBP 1000) for the "never turn an amount into a percent" check
begin; select pg_temp.act_as(:super);
select public.save_commission_record(null, jsonb_build_object('country_id', 'bulkland', 'university_name', 'Amount University', 'route', 'direct', 'currency', 'GBP'),
  '[{"tier_id":"tier_2","raw_value":"1000","value_kind":"amount","value":"1000","currency":"GBP"}]', null) as amt \gset
commit;
create temp table rates_before as select record_id, tier_id, value_kind, value from public.commission_tier_rates;
begin; select pg_temp.act_as(:po);
select public.create_agency_prospect('{"company_name":"Custom Co","contact_name":"Cee","email":"c@custom.test","country":"India"}', gen_random_uuid()) ->> 'id' as ag \gset
commit;

\echo '== each university keeps its own value (tests 3-12)'
begin; select pg_temp.act_as(:po);
select public.create_agency_proposal(:'ag', jsonb_build_object('arrangement', 'custom', 'base_tier_id', 'tier_2', 'terms_id', :terms,
  'items', jsonb_build_array(jsonb_build_object('record_id', :'u4', 'value', 16), jsonb_build_object('record_id', :'u5', 'value', 18),
                             jsonb_build_object('record_id', :'u6', 'value', 15), jsonb_build_object('record_id', :'amt', 'value', 900, 'kind', 'percent'))),
  gen_random_uuid()) ->> 'id' as p1 \gset
select pg_temp.check((select string_agg(r.university_name || '=' || i.base_value::numeric(10,0) || '>' || i.final_value::numeric(10,0) || ':' || i.customized, ',' order by r.university_name)
  from public.agency_proposal_items i join public.commission_records r on r.id = i.record_id where i.proposal_id = :'p1')
  = 'Amount University=1000>900:true,Bulk University 4=18>16:true,Bulk University 5=18>18:false,Bulk University 6=18>15:true',
  'Tier 2 base values loaded; each line kept its own final value (B unchanged while A and C changed)');
select pg_temp.check((select final_kind = 'amount' and currency = 'GBP' from public.agency_proposal_items where proposal_id = :'p1' and record_id = :'amt'),
  'an amount stays an amount in its currency (a "percent" sent by the browser is ignored)');
select pg_temp.check((select status = 'draft' from public.agency_proposals where id = :'p1'), 'all lines at or below base: no approval needed');
select pg_temp.check((select bool_and(approval_status = 'not_required' and modified_by = :po and base_tier_id = 'tier_2') from public.agency_proposal_items where proposal_id = :'p1'),
  'lines record base tier, who prepared them and approval status');
select pg_temp.check((select (u ->> 'commission_value')::numeric = 16 from public.agency_proposals r, jsonb_array_elements(r.arrangement -> 'universities') u
  where r.id = :'p1' and u ->> 'university' = 'Bulk University 4'), 'the email snapshot carries the final per-university value');
commit;
select pg_temp.check((select public.proposal_public_universities(arrangement)::text !~* 'tier|base_|customi|needs_approval' from public.agency_proposals where id = :'p1'),
  'what the agency sees has no tier, base value or customisation flags (test 17)');
select pg_temp.check(not exists (select 1 from public.commission_tier_rates c join rates_before b using (record_id, tier_id) where c.value is distinct from b.value or c.value_kind <> b.value_kind)
  and (select count(*) from public.commission_tier_rates) = (select count(*) from rates_before), 'master tier rates unchanged (test 20)');

\echo '== approval rules (test 21)'
begin; select pg_temp.act_as(:po);
select public.create_agency_proposal(:'ag', jsonb_build_object('arrangement', 'custom', 'base_tier_id', 'tier_2', 'terms_id', :terms,
  'items', jsonb_build_array(jsonb_build_object('record_id', :'u4', 'value', 25))), gen_random_uuid()) ->> 'id' as p2 \gset
select pg_temp.check((select status = 'pending_approval' from public.agency_proposals where id = :'p2')
  and (select approval_status = 'pending' and needs_approval from public.agency_proposal_items where proposal_id = :'p2'), 'above base: pending approval, cannot be sent yet');
select pg_temp.denied(format($$select public.decide_agency_proposal(%L, true)$$, :'p2'), 'the officer cannot approve it', '%commission managers%');
select pg_temp.denied(format($$select public.create_agency_proposal(%L, jsonb_build_object('arrangement','custom','base_tier_id','tier_2','terms_id',%s,
  'items', jsonb_build_array(jsonb_build_object('record_id', %L, 'value', 10))), gen_random_uuid())$$, :'ag', :terms, :'unclear'),
  'no base rate for that tier: the officer must choose percent or amount', '%no Tier 2 rate%');
select public.create_agency_proposal(:'ag', jsonb_build_object('arrangement', 'custom', 'base_tier_id', 'tier_2', 'terms_id', :terms,
  'items', jsonb_build_array(jsonb_build_object('record_id', :'unclear', 'value', 10, 'kind', 'percent'))), gen_random_uuid()) ->> 'id' as p3 \gset
select pg_temp.check((select status = 'pending_approval' from public.agency_proposals where id = :'p3'), 'a line without base data always needs approval');
select pg_temp.denied(format($$select public.create_agency_proposal(%L, jsonb_build_object('arrangement','custom','base_tier_id','tier_2','terms_id',%s,
  'items', jsonb_build_array(jsonb_build_object('record_id', %L, 'value', 101))), gen_random_uuid())$$, :'ag', :terms, :'u4'), 'percent above 100 rejected', '%100%');
commit;
begin; select pg_temp.act_as(:super);
select public.decide_agency_proposal(:'p2', true, 'ok');
select pg_temp.check((select approval_status = 'approved' from public.agency_proposal_items where proposal_id = :'p2'), 'approval recorded on the line');
select public.create_agency_proposal(:'ag', jsonb_build_object('arrangement', 'custom', 'base_tier_id', 'tier_2', 'terms_id', :terms,
  'items', jsonb_build_array(jsonb_build_object('record_id', :'u5', 'value', 30))), gen_random_uuid()) ->> 'id' as p4 \gset
select pg_temp.check((select status = 'draft' and approved_by is not null from public.agency_proposals where id = :'p4'), 'a commission manager''s own proposal is approved as prepared');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.denied(format($$select public.create_agency_proposal(%L, '{}', gen_random_uuid())$$, :'ag'), 'employees without agency access cannot prepare proposals', '%Not allowed%');
select pg_temp.check((select count(*) from public.agency_proposal_items) = 0, 'and cannot read proposal lines');
rollback;

\echo '== standard tier proposals still work and store lines'
begin; select pg_temp.act_as(:po);
select public.create_agency_proposal(:'ag', jsonb_build_object('arrangement', 'tier', 'tier_id', 'tier_3', 'terms_id', :terms,
  'record_ids', jsonb_build_array(:'u4', :'u5')), gen_random_uuid()) ->> 'id' as p5 \gset
select pg_temp.check((select count(*) = 2 and bool_and(not customized and final_value = 16) from public.agency_proposal_items where proposal_id = :'p5'), 'Tier 3 lines stored, not customised');
rollback;
