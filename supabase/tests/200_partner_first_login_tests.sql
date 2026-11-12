-- First sign-in of a partner account with a temporary password (0033).
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

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''

\echo '== temporary password: portal open, change-password step, no data yet'
begin;
update public.profiles set must_change_password = true where id = :p1admin;
select pg_temp.act_as(:p1admin);
select pg_temp.check((select portal_open and must_change_password from public.my_access()), 'portal_open stays true so the sign-in reaches the password-change step');
select pg_temp.check(public.my_partner_id() is null, 'no partner data access until the password is changed');
select pg_temp.check((select count(*) from public.students) = 0, 'students stay locked with a temporary password');
select pg_temp.check((select cardinality(partner_modules) = 0 and not commission from public.my_access()), 'no modules or commission before the password is changed');
rollback;

\echo '== portal genuinely closed'
begin;
update public.partners set portal_enabled = false where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select not portal_open from public.my_access()), 'portal turned off: still reported as closed');
rollback;
begin;
update public.partners set status = 'Inactive' where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select not portal_open from public.my_access()), 'inactive partner: closed');
rollback;
begin;
update public.partners set archived_at = now() where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select not portal_open from public.my_access()), 'archived partner: closed');
rollback;

\echo '== normal sign-in unchanged'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select portal_open and not must_change_password and cardinality(partner_modules) > 0 from public.my_access()), 'active partner admin: open with modules');
rollback;
