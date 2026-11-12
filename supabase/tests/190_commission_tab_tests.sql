-- Partner Commission tab access and the staff preview (0032). Runs after 180 (uses its data).
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

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set manager '''00000000-0000-0000-0000-0000000000f2'''
\set po      '''00000000-0000-0000-0000-0000000000f3'''

\echo '== the tab flag the sidebar uses (my_access().commission)'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select role = 'partner_admin' and commission from public.my_access()), 'Partner Admin: role partner_admin and commission = true (tab visible, TEST 1/10)');
select pg_temp.check((select count(*) from public.my_partner_commissions()) > 0, 'Partner Admin loads its assigned agreements (TEST 2/3)');
rollback;
begin; select pg_temp.act_as(:p1staff);
select pg_temp.check((select not commission from public.my_access()), 'partner employee: commission = false (tab hidden, TEST 5)');
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'partner employee: direct API call returns nothing (TEST 5)');
select pg_temp.denied($$select * from public.preview_partner_commissions('p1')$$, 'partner employee cannot use the staff preview', '%Not allowed%');
rollback;
begin; select pg_temp.act_as(:p2admin);
select pg_temp.denied($$select * from public.preview_partner_commissions('p1')$$, 'another partner cannot read p1 through the preview (TEST 8)', '%Not allowed%');
select pg_temp.check(not exists (select 1 from public.my_partner_commissions() where tier <> 'Tier 3' and country = 'Bulkland'), 'another partner still sees only its own agreements (TEST 8)');
rollback;
begin; select pg_temp.act_as(:p1admin);
select pg_temp.denied($$select * from public.partner_commission_rows('p2')$$, 'the internal row builder is not callable by partners', '%permission denied%');
rollback;

\echo '== commission hidden by SSI GLOBAL'
begin;
update public.partners set commission_visible = false where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select not commission from public.my_access()), 'hidden: the Partner Admin loses the tab');
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'hidden: no data even by direct call');
rollback;

\echo '== no assignments yet (TEST 4)'
begin;
update public.partner_commission_assignments set status = 'inactive' where partner_id = 'p1' and status = 'active';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select commission from public.my_access()), 'no assignments: the tab stays visible');
select pg_temp.check((select count(*) from public.my_partner_commissions()) = 0, 'no assignments: empty result, not an error');
rollback;

\echo '== staff preview of a partner'
begin; select pg_temp.act_as(:super);
select pg_temp.denied($$select * from public.partner_commission_rows('p1')$$, 'even Super Admin cannot call the internal row builder directly', '%permission denied%');
select pg_temp.check(pg_get_function_result('public.preview_partner_commissions(text)'::regprocedure) = pg_get_function_result('public.my_partner_commissions()'::regprocedure),
  'preview has the same restricted columns as the partner view');
select pg_temp.check(not exists (select 1 from public.preview_partner_commissions('p1') m where to_jsonb(m)::text ilike '%SECRET PORTAL%'), 'preview never contains portal names');
rollback;
begin; select pg_temp.act_as(:p1admin);
create temp table pa as select * from public.my_partner_commissions();
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from (select assignment_id, tier, commission_value from public.preview_partner_commissions('p1')
  except select assignment_id, tier, commission_value from pa) x) = 0
  and (select count(*) from public.preview_partner_commissions('p1')) = (select count(*) from pa), 'preview returns exactly what the Partner Admin receives');
rollback;
begin; select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.preview_partner_commissions('p1')) > 0, 'Partnership Officer with commission access can preview');
rollback;
begin; select pg_temp.act_as(:manager);
select pg_temp.check(not public.commission_can('commission_view'), 'fixture: manager has no commission access');
select pg_temp.denied($$select * from public.preview_partner_commissions('p1')$$, 'staff without commission access cannot preview', '%Not allowed%');
rollback;
