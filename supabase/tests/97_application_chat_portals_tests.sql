-- Application chat in every portal (0020): designation workspaces, conversation list,
-- notifications of participants, and refusals for everyone without access.
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
create or replace function pg_temp.send(app text, body text) returns bigint language sql as $$
  select (public.send_application_message(app, body, gen_random_uuid())).id;
$$;

\set super    '''00000000-0000-0000-0000-0000000000a1'''
\set p1admin  '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff  '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin  '''00000000-0000-0000-0000-0000000000c1'''
\set apteam   '''00000000-0000-0000-0000-00000000d0a1'''
\set success  '''00000000-0000-0000-0000-00000000d0a2'''
\set senior   '''00000000-0000-0000-0000-00000000d0a3'''
\set officer  '''00000000-0000-0000-0000-00000000d0a4'''
\set finance  '''00000000-0000-0000-0000-00000000d0a5'''

-- Permissions as the HR designations grant them (0012_hr_foundation.sql).
insert into auth.users (id, email) values
  (:apteam, 'apteam@ssi.test'), (:success, 'success@ssi.test'), (:senior, 'senior@ssi.test'), (:officer, 'po@ssi.test'), (:finance, 'fin@ssi.test');
insert into public.profiles (id, role, full_name, email, status, permissions) values
  (:apteam,  'application_manager', 'Application Team',  'apteam@ssi.test',  'active', '{students,applications,documents,catalogue,tasks}'),
  (:success, 'support_staff',       'Partner Success',   'success@ssi.test', 'active', '{partners,students,applications,catalogue,tasks}'),
  (:senior,  'application_manager', 'Senior Recruitment','senior@ssi.test',  'active', '{partners,students,applications,catalogue,tasks,reports}'),
  (:officer, 'support_staff',       'Partnership Officer','po@ssi.test',     'active', '{partners,catalogue,tasks}'),
  (:finance, 'finance_staff',       'Finance Only',      'fin@ssi.test',     'active', '{partners,finance,reports,tasks}');

\echo '== chat access matches the application rows each portal can read'
begin;
update public.partners set partnership_officer_id = :officer where id = 'p1';
select pg_temp.act_as(:apteam);
select pg_temp.check(public.can_access_application_chat('a1') and public.can_access_application_chat('a2'), 'Application Team opens chats of every application it can read');
select pg_temp.check((select count(*) from public.my_application_chats()) = (select count(*) from public.applications), 'Application Team: chat list equals visible applications');
select pg_temp.act_as(:success);
select pg_temp.check(public.can_access_application_chat('a1'), 'Partner Success Officer (Applications permission) has access');
select pg_temp.check((select count(*) from public.my_application_chats()) = (select count(*) from public.applications), 'Partner Success Officer: chat list equals visible applications');
select pg_temp.act_as(:senior);
select pg_temp.check(public.can_access_application_chat('a2'), 'Senior International Recruitment Manager has access');
select pg_temp.act_as(:officer);
select pg_temp.check((select count(*) from public.applications) = 0, 'Partnership Officer cannot read application rows (no Applications permission)');
select pg_temp.check(public.can_access_application_chat('a1'), 'Partnership Officer opens chats of their partner');
select pg_temp.check(not public.can_access_application_chat('a2'), 'Partnership Officer is denied other partners');
select pg_temp.check((select array_agg(application_id) from public.my_application_chat_inbox(null, true)) = '{a1}', 'Partnership Officer inbox lists only their partner''s applications');
select pg_temp.act_as(:finance);
select pg_temp.check(not public.can_access_application_chat('a1') and not public.can_access_application_chat('a2'), 'employee without Applications permission is denied');
select pg_temp.check((select count(*) from public.my_application_chat_inbox(null, true)) = 0, 'employee without access has an empty inbox');
select pg_temp.denied($$select pg_temp.send('a1', 'hello')$$, 'employee without access cannot send', '%CHAT_DENIED%');
select pg_temp.denied($$select public.application_chat_context('a1')$$, 'employee without access cannot read the header', '%CHAT_DENIED%');
select pg_temp.act_as(:p2admin);
select pg_temp.check((select count(*) from public.my_application_chat_inbox(null, true)) = (select count(*) from public.applications where partner_id = 'p2'), 'partner inbox holds only its own organisation');
select pg_temp.check(not exists (select 1 from public.my_application_chat_inbox(null, true) where application_id = 'a1'), 'partner never sees another organisation''s application in the inbox');
rollback;

\echo '== one shared conversation across portals'
begin;
delete from public.notifications;
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'Partner asks about the offer');
select pg_temp.act_as(:apteam);
select pg_temp.check((select count(*) from public.application_messages where application_id = 'a1') = 1, 'Application Team reads the partner''s message');
select pg_temp.send('a1', 'Application Team replies');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.application_messages where application_id = 'a1') = 2, 'Super Admin sees the same history');
select pg_temp.act_as(:p1staff);
select pg_temp.check((select array_agg(sender_name order by id) from public.application_messages where application_id = 'a1') = '{"P1 Admin","Application Team"}', 'partner staff sees both messages with sender names');
select pg_temp.check((select unread from public.my_application_chats() where application_id = 'a1') = 2, 'partner staff has two unread');
select pg_temp.check((select total = 2 and unread = 2 and last_sender = 'Application Team' and ref is not null from public.my_application_chat_inbox() where application_id = 'a1'), 'inbox row: counts, last sender and reference');
select pg_temp.check((select count(*) from public.my_application_chat_inbox('Asha')) = 1, 'inbox search by student name');
select pg_temp.check((select count(*) from public.my_application_chat_inbox('no-such-thing%')) = 0, 'inbox search treats % literally');
select pg_temp.act_as(:p2admin);
select pg_temp.check((select count(*) from public.application_messages) = 0, 'other organisation reads none of it (RLS)');
select pg_temp.check((select count(*) from public.application_chat_reads) = 0, 'other organisation reads no read state (RLS)');
select pg_temp.act_as(:finance);
select pg_temp.check((select count(*) from public.application_messages) = 0, 'employee without access reads none of it (RLS)');
rollback;

\echo '== notifications reach participants, never the sender or outsiders'
begin;
delete from public.notifications;
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'opening message');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :apteam) = 0, 'employee with access who has not taken part is not notified');
select pg_temp.act_as(:apteam);
select public.mark_application_chat_read('a1');  -- opened the conversation: now a participant
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'first');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :apteam) = 1, 'employee who took part is notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :success) = 0, 'employee with access who never took part is not notified (unread badge still shows)');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id in (:finance, :p2admin)) = 0, 'unauthorised users are not notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :p1admin) = 0, 'sender is not notified');
select pg_temp.act_as(:success);
select pg_temp.check((select unread from public.my_application_chats() where application_id = 'a1') = 2, 'non-participant with access still sees the unread count');
select pg_temp.trusted();
update public.profiles set permissions = '{students}' where id = :apteam;
delete from public.notifications;
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'second');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :apteam) = 0, 'participant who lost the Applications permission is no longer notified');
select pg_temp.act_as(:apteam);
select pg_temp.check(not public.can_access_application_chat('a1') and (select count(*) from public.application_messages) = 0, 'and can no longer read the conversation');
rollback;

delete from public.profiles where id in (:apteam, :success, :senior, :officer, :finance);
delete from auth.users where id in (:apteam, :success, :senior, :officer, :finance);
