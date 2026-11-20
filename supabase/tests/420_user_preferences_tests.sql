-- 0057: per-user sidebar order. Rolls back.
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
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

\set a '''00000000-0000-0000-0000-0000000000f3'''
\set b '''00000000-0000-0000-0000-0000000000f5'''

begin;
select pg_temp.act_as(:a);
select public.save_sidebar_order('partner_success', array['ps-workspace', 'ps-tools', 'ps-tools', 'bad id!', 'ps-self']);
select pg_temp.check((select sidebar_order -> 'partner_success' = '["ps-workspace", "ps-tools", "ps-self"]'::jsonb from public.user_preferences where user_id = :a),
  'order saved per navigation set, duplicates and invalid ids dropped');
select public.save_sidebar_order('staff', array['work', 'overview']);
select pg_temp.check((select sidebar_order ? 'partner_success' and sidebar_order ? 'staff' from public.user_preferences where user_id = :a), 'each navigation set keeps its own order');
select pg_temp.act_as(:b);
select pg_temp.check((select count(*) from public.user_preferences) = 0, 'another employee cannot see it (independent preferences)');
update public.user_preferences set sidebar_order = '{}' where user_id = :a;
select pg_temp.act_as(:a);
select pg_temp.check((select jsonb_array_length(sidebar_order -> 'partner_success') = 3 from public.user_preferences where user_id = :a), 'nor change it');
select public.save_sidebar_order('partner_success', null);
select pg_temp.check((select not (sidebar_order ? 'partner_success') and sidebar_order ? 'staff' from public.user_preferences where user_id = :a), 'Reset to Default removes only that set');
rollback;
