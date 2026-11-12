-- Strict partner commission view and bulk assignment (0031).
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
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''

\echo '== partner view returns only permitted fields (TEST 3)'
select pg_temp.check(pg_get_function_result('public.my_partner_commissions()'::regprocedure) !~ '(route|provider|raw_value|received|margin|remark|internal)',
  'the partner function has no route, portal, raw sheet, SSI GLOBAL or internal columns');

begin;
select pg_temp.act_as(:super);
-- 55 commission records with all three tiers, plus one without valid Tier 2 data; all via a portal.
insert into public.commission_countries (id, name) values ('bulkland', 'Bulkland') on conflict do nothing;
select public.save_commission_record(null, jsonb_build_object('country_id', 'bulkland', 'university_name', 'Bulk University ' || g, 'route', 'portal', 'provider_label', 'SECRET PORTAL', 'currency', 'GBP'),
  '[{"tier_id":"tier_1","raw_value":"0.2","value_kind":"percent","value":"20"},{"tier_id":"tier_2","raw_value":"0.18","value_kind":"percent","value":"18"},{"tier_id":"tier_3","raw_value":"0.16","value_kind":"percent","value":"16"}]',
  '{"received_raw":"0.25","received_kind":"percent","received_value":"25","margin_raw":"0.05","margin_kind":"percent","margin_value":"5"}')
from generate_series(1, 55) g;
select public.save_commission_record(null, jsonb_build_object('country_id', 'bulkland', 'university_name', 'Unclear University', 'route', 'portal', 'provider_label', 'SECRET PORTAL'),
  '[{"tier_id":"tier_1","raw_value":"0.2","value_kind":"percent","value":"20"},{"tier_id":"tier_2","raw_value":"15.0","value_kind":"unclear","value":""}]', null) as unclear_id \gset
select (select jsonb_agg(jsonb_build_object('record_id', id, 'tier_id', 'tier_1') order by university_name)
        from (select id, university_name from public.commission_records where country_id = 'bulkland' and university_name like 'Bulk University %' order by university_name limit 50) x) as items50 \gset
select id as uni_b from public.commission_records where university_name = 'Bulk University 2' \gset

\echo '== bulk assignment (TEST 4, 5, 6)'
select pg_temp.act_as(:po);
select pg_temp.denied(format($$select public.preview_bulk_partner_commissions('p1', %L::jsonb)$$, :'items50'), 'a Partnership Officer cannot bulk assign', '%commission managers%');
select pg_temp.denied(format($$select public.save_commission_record(%L, '{"country_id":"bulkland","university_name":"X","route":"direct"}', null)$$, :'uni_b'), 'nor edit master rates (TEST 8)', '%cannot edit%');
select pg_temp.act_as(:super);
select public.preview_bulk_partner_commissions('p1', :'items50') -> 'counts' as pv \gset
select pg_temp.check((:'pv'::jsonb ->> 'new')::int = 50, 'preview: 50 new assignments');
select pg_temp.check((select count(*) from public.partner_commission_assignments a join public.commission_records r on r.id = a.record_id where r.country_id = 'bulkland') = 0, 'preview writes nothing');
select public.bulk_assign_partner_commissions('p1', :'items50') as res \gset
select pg_temp.check((:'res'::jsonb ->> 'created')::int = 50, '50 Tier 1 assignments created in one operation');
select public.bulk_assign_partner_commissions('p1', :'items50') as res2 \gset
select pg_temp.check((:'res2'::jsonb ->> 'created')::int = 0 and (:'res2'::jsonb ->> 'unchanged')::int = 50, 'running it again creates no duplicates');
select pg_temp.check((select count(*) from public.partner_commission_assignments a join public.commission_records r on r.id = a.record_id where r.country_id = 'bulkland' and a.status = 'active') = 50,
  'exactly 50 active assignments');

-- override University B to Tier 2 (existing assignment: needs explicit overwrite)
select public.bulk_assign_partner_commissions('p1', jsonb_build_array(jsonb_build_object('record_id', :'uni_b', 'tier_id', 'tier_2'))) as res3 \gset
select pg_temp.check((:'res3'::jsonb ->> 'changed')::int = 0 and (:'res3'::jsonb ->> 'skipped')::int = 1, 'an existing assignment is not overwritten without confirmation');
select public.bulk_assign_partner_commissions('p1', jsonb_build_array(jsonb_build_object('record_id', :'uni_b', 'tier_id', 'tier_2')), true) as res4 \gset
select pg_temp.check((:'res4'::jsonb ->> 'changed')::int = 1, 'with confirmation University B moves to Tier 2');
select pg_temp.check((select tier_id from public.partner_commission_assignments where partner_id = 'p1' and record_id = :'uni_b' and status = 'active') = 'tier_2'
  and (select count(*) from public.partner_commission_assignments a join public.commission_records r on r.id = a.record_id where r.country_id = 'bulkland' and a.partner_id = 'p1' and a.status = 'active' and a.tier_id = 'tier_1') = 49,
  'University B is Tier 2; the other 49 stay Tier 1');
select pg_temp.check((select count(*) from public.partner_commission_assignments where partner_id = 'p1' and record_id = :'uni_b') = 2, 'the earlier Tier 1 agreement is kept in the history');

-- custom agreements and unclear tier data are protected
select public.set_custom_partner_commission('p1', (select id from public.commission_records where university_name = 'Bulk University 3'), 'tier_1', 'percent', 21, null, null, null, null, 'Special deal');
select public.preview_bulk_partner_commissions('p1', jsonb_build_array(
  jsonb_build_object('record_id', (select id from public.commission_records where university_name = 'Bulk University 3'), 'tier_id', 'tier_3'),
  jsonb_build_object('record_id', :'unclear_id', 'tier_id', 'tier_2'),
  jsonb_build_object('record_id', :'unclear_id', 'tier_id', 'tier_9'))) -> 'items' as pv2 \gset
select pg_temp.check((:'pv2'::jsonb -> 0 ->> 'result') = 'custom_kept', 'a custom agreement is never overwritten by bulk assignment');
select pg_temp.check((:'pv2'::jsonb -> 1 ->> 'result') = 'no_tier_data', 'a tier with unreadable sheet data is skipped, not invented');
select pg_temp.check(jsonb_array_length(:'pv2'::jsonb) = 2, 'the same record twice is counted once');
select public.bulk_assign_partner_commissions('p1', jsonb_build_array(jsonb_build_object('record_id', (select id from public.commission_records where university_name = 'Bulk University 3'), 'tier_id', 'tier_3')), true);
select pg_temp.check((select is_custom and custom_value = 21 from public.partner_commission_assignments where partner_id = 'p1' and status = 'active'
  and record_id = (select id from public.commission_records where university_name = 'Bulk University 3')), 'even with overwrite confirmed, the custom agreement stays');

-- another partner
select public.bulk_assign_partner_commissions('p2', (select jsonb_agg(jsonb_build_object('record_id', id, 'tier_id', 'tier_3')) from public.commission_records where university_name like 'Bulk University 1%'));
select pg_temp.check((select count(*) from public.partner_commission_assignments a join public.commission_records r on r.id = a.record_id
  where a.partner_id = 'p1' and a.status = 'active' and r.country_id = 'bulkland' and a.tier_id = 'tier_3') = 0, 'assigning p2 never changes p1 (TEST 6)');
commit;

\echo '== what the partner sees (TEST 1, 2, 3, 7)'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.my_partner_commissions() where country = 'Bulkland') = 50, 'p1 sees its 50 assigned universities');
select pg_temp.check((select commission_value = 18 and tier = 'Tier 2' from public.my_partner_commissions() where university = 'Bulk University 2'), 'University B shows only its Tier 2 commission');
select pg_temp.check((select bool_and(commission_value in (20, 18, 21)) from public.my_partner_commissions() where country = 'Bulkland'), 'only the assigned tier value per university (never 16 = Tier 3 here)');
select pg_temp.check((select count(*) from public.my_partner_commissions() where university = 'Unclear University') = 0, 'unassigned universities are not shown');
select pg_temp.check(not exists (select 1 from public.my_partner_commissions() m where to_jsonb(m)::text ilike '%SECRET PORTAL%' or m.commission_value in (25, 5)),
  'no portal name or SSI GLOBAL commission in the response');
select pg_temp.check((select count(*) from public.commission_tier_rates) + (select count(*) from public.commission_records) + (select count(*) from public.commission_internal) = 0,
  'the partner cannot read master tables directly');
rollback;
begin; select pg_temp.act_as(:p1staff);
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'a partner employee gets nothing (TEST 7)');
rollback;
begin; select pg_temp.act_as(:p2admin);
select pg_temp.check((select bool_and(tier = 'Tier 3') from public.my_partner_commissions() where country = 'Bulkland'), 'p2 sees only its own Tier 3 agreements');
rollback;
