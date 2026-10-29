-- Real-time support: publication, notifications (targeting + isolation), server-stamped
-- activity, assignment rules and edit versions. Reuses fixtures from earlier test files.
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
create or replace function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
    'iat', extract(epoch from clock_timestamp())::bigint + 1)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.trusted() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Notifications created in the current transaction for a user (trusted context).
create or replace function pg_temp.n(uid text, k text default null) returns bigint language sql as $$
  select count(*) from public.notifications where user_id = uid::uuid and (k is null or kind = k) and created_at >= now() $$;

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set susp    '''00000000-0000-0000-0000-0000000000d1'''
\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set staff   '''00000000-0000-0000-0000-0000000000a2'''
\set fin     '''00000000-0000-0000-0000-0000000000e1'''
\set appmgr  '''00000000-0000-0000-0000-0000000000e2'''

\echo '== realtime publication'
select pg_temp.check((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('partners', 'profiles', 'students', 'applications', 'documents', 'assessments', 'payments', 'tasks',
                    'announcements', 'activities', 'notifications')) = 11, 'all synced tables are in the supabase_realtime publication');
select pg_temp.check(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'audit_log'),
  'audit log is not streamed');

\echo '== partner creates a student (Admin is notified, other partners are not)'
begin; select pg_temp.act_as(:p1admin);
insert into public.students (id, partner_id, first_name, last_name, email) values ('s9', 'p1', 'Neha', 'Nine', 'neha@x.test');
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:super, 'student') = 1, 'super admin notified of new partner student');
select pg_temp.check(pg_temp.n(:staff, 'student') = 1, 'admin staff (students permission) notified');
select pg_temp.check(pg_temp.n(:appmgr, 'student') = 1, 'application manager (students permission) notified');
select pg_temp.check(pg_temp.n(:fin, 'student') = 0, 'finance staff (no students permission) not notified');
select pg_temp.check(pg_temp.n(:p1admin) = 0, 'the partner who acted is not notified');
select pg_temp.check(pg_temp.n(:p2admin) = 0, 'other partners are not notified');
select pg_temp.check((select actor_name = 'P1 Admin' and actor_role = 'partner_admin' and actor_org is not null and student_name = 'Neha Nine'
  from public.activities where ref_id = 's9' and title = 'New student added'), 'activity is stamped with actor, role and organisation');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.notifications where created_at >= now()) = 1, 'super admin reads own new notification');
select pg_temp.check(exists (select 1 from public.activities where ref_id = 's9'), 'admin sees the new activity');
select pg_temp.trusted(); select pg_temp.act_as(:p2admin);
select pg_temp.check(not exists (select 1 from public.activities where ref_id = 's9'), 'other partner cannot see the activity');
select pg_temp.check((select count(*) from public.notifications where created_at >= now()) = 0, 'other partner receives no notification');
rollback;

\echo '== partner edits a student'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select updated_at from public.students where id = 's1') is not null, 'students carry an edit version');
create temp table v on commit drop as select updated_at from public.students where id = 's1';
select pg_sleep(0.01);
update public.students set phone = '+91 99' where id = 's1';
select pg_temp.check((select updated_at from public.students where id = 's1') > (select updated_at from v), 'edit bumps updated_at');
select pg_temp.check(pg_temp.affected($q$update public.students set phone = '+91 00' where id = 's1' and updated_at = (select updated_at from v)$q$) = 0,
  'stale edit (old version) updates nothing');
select pg_temp.check(exists (select 1 from public.activities where ref_id = 's1' and title = 'Student details updated'), 'edit appears in activity');
rollback;

\echo '== staff changes application status (partner is notified)'
begin; select pg_temp.act_as(:appmgr);
update public.applications set status = 'Conditional Offer' where id = 'a1';
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:p1admin, 'status') = 1 and pg_temp.n(:p1staff, 'status') = 1, 'both active p1 users notified of the status change');
select pg_temp.check(pg_temp.n(:susp) = 0, 'suspended partner user not notified');
select pg_temp.check(pg_temp.n(:p2admin) = 0, 'other partner not notified');
select pg_temp.check(pg_temp.n(:appmgr) = 0, 'staff who changed it not notified');
select pg_temp.check((select actor_role from public.activities where ref_id = 'a1' and kind = 'status' order by id desc limit 1) = 'application_manager',
  'status activity records the staff role');
rollback;

begin;
update public.partners set modules = array['students'] where id = 'p1';
select pg_temp.act_as(:staff);
update public.applications set status = 'Conditional Offer' where id = 'a1';
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:p1admin) = 0, 'partner without the applications module is not notified');
rollback;

\echo '== documents and assessments'
begin; select pg_temp.act_as(:staff);
update public.documents set status = 'Verified' where id = 'd1';
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:p1admin, 'document') = 1, 'partner sees document verification result');
select pg_temp.check(pg_temp.n(:p2admin) = 0, 'other partner not told about it');
rollback;

\echo '== tasks and assignment'
begin; select pg_temp.act_as(:super);
insert into public.tasks (id, title, due, assigned_to) values ('t9', 'Call university', now(), '00000000-0000-0000-0000-0000000000e1');
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:fin, 'task') = 1, 'assigned employee notified of the task');
update public.profiles set permissions = array['finance'] where id = :fin;
select pg_temp.act_as(:fin);
select pg_temp.check((select count(*) from public.tasks) = 1, 'employee without "tasks" still sees tasks assigned to them');
select pg_temp.check(pg_temp.affected($q$update public.tasks set done = true where id = 't9'$q$) = 1, 'assignee can complete their task');
rollback;

begin; select pg_temp.act_as(:super);
select pg_temp.denied($$update public.applications set assigned_to = '00000000-0000-0000-0000-0000000000b1' where id = 'a1'$$, 'work cannot be assigned to partner users');
update public.applications set assigned_to = '00000000-0000-0000-0000-0000000000e2' where id = 'a1';
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:appmgr, 'assignment') = 1, 'assignee notified of the application');
rollback;

begin; select pg_temp.act_as(:p1admin);
select pg_temp.denied($$update public.applications set assigned_to = '00000000-0000-0000-0000-0000000000e2' where id = 'a1'$$, 'partners cannot assign work');
rollback;

\echo '== announcements'
begin; select pg_temp.act_as(:super);
insert into public.announcements (id, title, category, body, published, publish_at, expires_at, audience)
values ('n_new', 'Visa rule change', 'Visa', 'x', true, now() - interval '1 minute', now() + interval '9 days', '{p2}');
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:p2admin, 'update') = 1, 'targeted partner notified of the announcement');
select pg_temp.check(pg_temp.n(:p1admin, 'update') = 0, 'non-targeted partner not notified');
rollback;

\echo '== notification inbox rules'
begin; select pg_temp.act_as(:appmgr);
update public.applications set status = 'Conditional Offer' where id = 'a1';
select pg_temp.trusted(); select pg_temp.act_as(:p1admin);
select pg_temp.check(pg_temp.affected($q$update public.notifications set read_at = now() where created_at >= now()$q$) = 1, 'user marks own notification read');
select pg_temp.denied($$update public.notifications set title = 'x'$$, 'user cannot rewrite a notification');
select pg_temp.denied($$insert into public.notifications (user_id, kind, title) values (auth.uid(), 'x', 'forged')$$, 'user cannot create notifications');
select pg_temp.check(pg_temp.affected($q$delete from public.notifications where created_at >= now()$q$) = 1, 'user clears own notifications');
select pg_temp.trusted();
select pg_temp.check(pg_temp.n(:p1staff) = 1, 'clearing does not touch other users'' notifications');
select pg_temp.act_as(:p1staff);
select pg_temp.check(pg_temp.affected($q$delete from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'$q$) = 0, 'cannot delete someone else''s notifications');
rollback;

begin;
insert into public.notifications (user_id, kind, title) values (:p1admin, 'x', 'hello');
update public.profiles set status = 'suspended' where id = :p1admin;
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.notifications) = 0, 'suspended user cannot read notifications');
rollback;

\echo '== activity visibility'
begin;
insert into public.activities (kind, title, detail) values ('account', 'Employee account created', 'X');
select pg_temp.act_as(:staff);
select pg_temp.check(not exists (select 1 from public.activities where kind = 'account'), 'account events hidden from admin staff');
select pg_temp.trusted(); select pg_temp.act_as(:super);
select pg_temp.check(exists (select 1 from public.activities where kind = 'account'), 'super admin sees account events');
select pg_temp.denied($$insert into public.activities (kind, title) values ('student', 'forged')$$, 'users cannot write activity entries');
rollback;

begin; select pg_temp.act_as(:staff);
delete from public.students where id = 's1';
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.activities where title = 'Student removed' and actor_role = 'admin_staff'), 'student deletion is recorded with the actor');
rollback;

begin; select pg_temp.act_as(:staff);
select pg_temp.check((select count(*) from public.staff_directory()) >= 4, 'staff can list employees for assignment');
select pg_temp.trusted(); select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.staff_directory()) = 0, 'partners cannot list employees');
rollback;

\echo 'ALL SECURITY TESTS PASSED'
