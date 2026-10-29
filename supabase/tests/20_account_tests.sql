-- Account management: employee permissions, partner portal control, session revocation,
-- account status and the Super Admin directory. Reuses fixtures from 10_rls_tests.sql.
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
create or replace function pg_temp.denied(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'pass: % (rejected: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement was allowed', msg using errcode = 'TF001';
end $$;
create or replace function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
-- Back to the trusted (dashboard/migration) context: no role, no end-user JWT.
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
-- End user with a token issued at `iat` (default: now).
create or replace function pg_temp.act_as(uid text, iat bigint default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', coalesce(iat, extract(epoch from clock_timestamp())::bigint + 1))::text, true);
  execute 'set local role authenticated';
end $$;

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set staff   '''00000000-0000-0000-0000-0000000000a2'''
\set fin     '''00000000-0000-0000-0000-0000000000e1'''
\set appmgr  '''00000000-0000-0000-0000-0000000000e2'''

insert into auth.users (id, email) values (:fin, 'finance@ssi.test'), (:appmgr, 'apps@ssi.test');
insert into public.profiles (id, role, full_name, email, status) values
  (:fin, 'finance_staff', 'Finance', 'finance@ssi.test', 'active'),
  (:appmgr, 'application_manager', 'Apps', 'apps@ssi.test', 'active');

\echo '== employee roles and permissions (Flow E)'
begin; select pg_temp.act_as(:fin);
select pg_temp.check((select count(*) from public.payments) = 2, 'finance staff sees all invoices');
select pg_temp.check((select count(*) from public.students) = 0, 'finance staff cannot read students');
select pg_temp.check((select count(*) from public.applications) = 0, 'finance staff cannot read applications');
select pg_temp.check((select count(*) from public.partners where id in ('p1', 'p2')) = 2, 'finance staff can read partner names');
select pg_temp.check(pg_temp.affected($q$update public.students set first_name = 'X'$q$) = 0, 'finance staff cannot edit students');
rollback;

begin; select pg_temp.act_as(:appmgr);
select pg_temp.check((select count(*) from public.applications) = 2, 'application manager sees applications');
select pg_temp.check((select count(*) from public.payments) = 0, 'application manager cannot read finance');
select pg_temp.check((select count(*) from public.assessments) = 0, 'application manager cannot read assessments');
select pg_temp.check((select count(*) from public.tasks) = 1, 'application manager sees tasks');
rollback;

begin;
update public.profiles set permissions = array['finance', 'students'] where id = :fin;
select pg_temp.act_as(:fin);
select pg_temp.check((select count(*) from public.students) = 2, 'granting "students" opens students immediately');
select pg_temp.check((select count(*) from public.tasks) = 0, 'removing "tasks" closes tasks immediately');
select pg_temp.trusted();
update public.profiles set permissions = null where id = :fin;
select pg_temp.act_as(:fin);
select pg_temp.check((select count(*) from public.students) = 0, 'reset to role defaults removes students again');
rollback;

begin; select pg_temp.act_as(:staff);
select pg_temp.check(pg_temp.affected($q$update public.profiles set permissions = array['finance'] where id = '00000000-0000-0000-0000-0000000000e1'$q$) = 0, 'admin staff cannot change permissions');
select pg_temp.check((select count(*) from public.user_directory()) = 0, 'admin staff cannot read the user directory');
rollback;

begin; select pg_temp.act_as(:fin);
select pg_temp.denied($$update public.profiles set permissions = array['students','finance'] where id = auth.uid()$$, 'employee cannot grant themselves permissions');
rollback;

begin;
select pg_temp.denied($$update public.profiles set permissions = array['root'] where id = '00000000-0000-0000-0000-0000000000e1'$$, 'unknown permission names are rejected');
rollback;

begin; select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.user_directory()) = 8, 'super admin reads the user directory');
select pg_temp.check((select permissions from public.user_directory() where id = '00000000-0000-0000-0000-0000000000e1')
  = public.role_default_permissions('finance_staff'), 'directory shows effective permissions');
select pg_temp.check((select permissions from public.my_access()) = public.staff_modules(), 'super admin has every module');
rollback;

\echo '== partner portal control (Flows B, D)'
begin;
update public.partners set modules = array['students', 'applications'] where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 1, 'partner with "students" sees own students');
select pg_temp.check((select count(*) from public.documents) = 0, 'module switched off: documents hidden');
select pg_temp.check((select count(*) from public.payments) = 0, 'module switched off: finance hidden');
select pg_temp.check((select count(*) from storage.objects) = 0, 'module switched off: files hidden');
select pg_temp.check((select partner_modules from public.my_access()) = array['students', 'applications'], 'my_access reports enabled modules');
rollback;

begin;
update public.partners set portal_enabled = false where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 0, 'portal disabled: no students');
select pg_temp.check((select count(*) from public.partners) = 0, 'portal disabled: no partner record');
select pg_temp.check((select count(*) from public.courses) = 0, 'portal disabled: no catalogue');
select pg_temp.check(not (select portal_open from public.my_access()), 'my_access reports portal closed');
select pg_temp.trusted();
select pg_temp.act_as(:p2admin);
select pg_temp.check((select count(*) from public.students) = 1, 'other partners are unaffected');
rollback;

begin;
update public.partners set status = 'Inactive' where id = 'p1';
select pg_temp.act_as(:p1staff);
select pg_temp.check((select count(*) from public.applications) = 0, 'deactivated partner: staff lose access');
rollback;

begin;
update public.partners set archived_at = now() where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 0, 'archived partner: no access');
rollback;

begin; select pg_temp.act_as(:p1admin);
select pg_temp.denied($$update public.partners set modules = array['students','applications','finance','documents','assessments','updates','course_finder'], portal_enabled = true where id = 'p1'$$, 'partner admin cannot change own modules');
select pg_temp.denied($$update public.partners set status = case when status = 'Active' then 'Onboarding' else 'Active' end where id = 'p1'$$, 'partner admin cannot change own activation status');
rollback;

begin; select pg_temp.act_as(:staff);
select pg_temp.denied($$update public.partners set portal_enabled = false where id = 'p1'$$, 'admin staff cannot change portal access');
update public.partners set phone = '+91 1' where id = 'p1';
select pg_temp.check((select phone from public.partners where id = 'p1') = '+91 1', 'admin staff can edit partner details');
insert into public.partners (id, name, code, contact_name, email, portal_enabled) values ('p9', 'New', 'NEW', 'X', 'x@x.test', true);
select pg_temp.check(not (select portal_enabled from public.partners where id = 'p9'), 'partner created by staff starts with portal closed');
rollback;

begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students where partner_id = 'p2') = 0, 'partner cannot read another partner''s students (Flow F)');
select pg_temp.check(pg_temp.affected($q$update public.applications set intake = 'X' where partner_id = 'p2'$q$) = 0, 'partner cannot edit another partner''s applications (Flow F)');
rollback;

\echo '== account status and session revocation (Flows C, D)'
begin;
update public.profiles set status = 'suspended' where id = :p1admin;
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 0, 'suspended account sees nothing');
select pg_temp.trusted();
update public.profiles set status = 'active' where id = :p1admin;
select pg_temp.act_as(:p1admin, 1);
select pg_temp.check((select count(*) from public.students) = 0, 'reactivated account: tokens from before the suspension stay dead');
select pg_temp.trusted();
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 1, 'reactivated account works after signing in again');
rollback;

begin;
update public.profiles set status = 'deactivated' where id = :appmgr;
select pg_temp.act_as(:appmgr);
select pg_temp.check((select count(*) from public.applications) = 0, 'deactivated employee sees nothing');
rollback;

begin;
insert into auth.sessions (user_id) values (:p1admin), (:p1admin);
select pg_temp.act_as(:p1admin, extract(epoch from now())::bigint - 60);
select pg_temp.check((select count(*) from public.students) = 1, 'session works before the password reset');
select pg_temp.trusted(); set local role service_role;
select public.admin_revoke_sessions(:p1admin);
select pg_temp.trusted();
select pg_temp.check(not exists (select 1 from auth.sessions where user_id = :p1admin), 'password reset deletes refresh sessions');
select pg_temp.act_as(:p1admin, extract(epoch from now())::bigint - 60);
select pg_temp.check((select count(*) from public.students) = 0, 'access token issued before the reset is rejected');
select pg_temp.trusted();
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 1, 'new sign-in after the reset works');
rollback;

begin; select pg_temp.act_as(:super);
select pg_temp.denied($$select public.admin_revoke_sessions('00000000-0000-0000-0000-0000000000b1')$$, 'browser sessions cannot call admin_revoke_sessions');
rollback;

begin;
select pg_temp.denied($$insert into public.profiles (id, role, partner_id, full_name, email) values ('00000000-0000-0000-0000-0000000000e1', 'partner_staff', null, 'x', 'y@x.test')$$, 'partner roles need an organisation');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'dupe@x.test');
select pg_temp.denied($$insert into public.profiles (id, role, full_name, email) values ('00000000-0000-0000-0000-0000000000f1', 'support_staff', 'x', 'FINANCE@ssi.test')$$, 'duplicate email (case-insensitive) is rejected');
rollback;

\echo '== must change password'
begin;
update public.profiles set must_change_password = true where id = :p1staff;
select pg_temp.act_as(:p1staff);
select pg_temp.check((select must_change_password from public.my_access()), 'my_access reports password change required');
select public.password_change_done();
select pg_temp.check(not (select must_change_password from public.my_access()), 'flag clears after the change');
select pg_temp.denied($$update public.profiles set must_change_password = true, status = 'suspended' where id = auth.uid()$$, 'user cannot change own status');
rollback;

\echo 'ACCOUNT TESTS PASSED'
