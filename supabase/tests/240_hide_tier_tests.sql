-- Tier 1 / 2 / 3 stays internal (0037): partners and agencies see the commission only.
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
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;
\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''

\echo '== Partner Portal Commission'
select pg_temp.check(pg_get_function_result('public.my_partner_commissions()'::regprocedure) !~* '(tier|custom|route|provider|raw|received|margin|internal)',
  'partner commission returns no tier, custom flag or internal columns');
select pg_temp.check(pg_get_function_result('public.preview_partner_commissions(text)'::regprocedure) = pg_get_function_result('public.my_partner_commissions()'::regprocedure),
  'the staff preview shows exactly the partner view');
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) > 0 and bool_and(commission_value is not null) from public.my_partner_commissions()), 'the Partner Admin still gets the actual commission per university');
select pg_temp.check(not exists (select 1 from public.my_partner_commissions() m where to_jsonb(m)::text ~* 'tier [123]|tier_[123]'), 'no tier label anywhere in the rows');
rollback;
begin; select pg_temp.act_as(:p1staff);
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'partner employees still get nothing');
rollback;

\echo '== public proposal page (the proposal sent and confirmed in 210)'
\set tok '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
select public.agency_proposal_for_token(:tok) as pub \gset
select pg_temp.check((:'pub'::jsonb ->> 'state') = 'confirmed', 'the confirmed proposal still loads (confirmation unaffected)');
select pg_temp.check(not (:'pub'::jsonb ? 'arrangement') and (:'pub'::jsonb)::text !~* '(tier|record_id|"kind")', 'no tier label, tier id, arrangement kind or record ids for the agency');
select pg_temp.check((select bool_and((u ->> 'commission_value')::numeric = 20 and u ? 'university' and u ? 'currency') from jsonb_array_elements(:'pub'::jsonb -> 'universities') u),
  'the agency sees each university and its actual commission');
select pg_temp.check((select arrangement ->> 'tier_label' = 'Tier 1' from public.agency_proposals where token_hash = public.registration_token_hash(:tok)),
  'internally the proposal still records Tier 1 (audit)');
begin; select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.agency_proposals where arrangement ->> 'tier_label' = 'Tier 1') >= 1, 'administrators still see the tier');
select pg_temp.check((select count(*) from public.proposal_commission_options(null) where tier_label = 'Tier 2') > 0, 'staff still choose tiers when preparing a proposal');
rollback;
