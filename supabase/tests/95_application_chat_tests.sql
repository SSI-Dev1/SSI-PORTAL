-- Application chat (0018): access rules, sending, retries, unread counts, notifications.
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
create or replace function pg_temp.send(app text, body text, cid uuid default gen_random_uuid()) returns bigint language sql as $$
  select (public.send_application_message(app, body, cid)).id;
$$;

\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set assigned '''00000000-0000-0000-0000-00000000c0a1'''
\set manager '''00000000-0000-0000-0000-00000000c0a2'''
\set officer '''00000000-0000-0000-0000-00000000c0a3'''

insert into auth.users (id, email) values (:assigned, 'chat-assigned@ssi.test'), (:manager, 'chat-manager@ssi.test'), (:officer, 'chat-officer@ssi.test');
insert into public.profiles (id, role, full_name, email, status) values
  (:assigned, 'application_manager', 'Assigned Staff', 'chat-assigned@ssi.test', 'active'),
  (:manager, 'application_manager', 'Other Manager', 'chat-manager@ssi.test', 'active'),
  (:officer, 'support_staff', 'Partnership Officer', 'chat-officer@ssi.test', 'active');

\echo '== who can open a conversation'
begin;
update public.applications set assigned_to = :assigned where id = 'a1';
update public.partners set partnership_officer_id = :officer where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check(public.can_access_application_chat('a1'), 'partner admin opens own application chat');
select pg_temp.check(not public.can_access_application_chat('a2'), 'partner cannot open another organisation''s chat');
select pg_temp.check((select array_agg(application_id) from public.my_application_chats()) = '{a1}', 'partner conversation list holds only own application');
select pg_temp.act_as(:p1staff);
select pg_temp.check(public.can_access_application_chat('a1'), 'partner staff of the organisation has access');
select pg_temp.act_as(:p2admin);
select pg_temp.check(not public.can_access_application_chat('a1'), 'other organisation denied');
select pg_temp.denied($$select public.application_chat_context('a1')$$, 'other organisation cannot read the chat header', '%CHAT_DENIED%');
select pg_temp.denied($$select pg_temp.send('a1', 'hello')$$, 'other organisation cannot post by changing the application id', '%CHAT_DENIED%');
select pg_temp.denied($$select public.mark_application_chat_read('a1')$$, 'other organisation cannot mark read', '%CHAT_DENIED%');
select pg_temp.act_as(:super);
select pg_temp.check(public.can_access_application_chat('a1') and public.can_access_application_chat('a2'), 'Super Admin opens every chat');
select pg_temp.act_as(:admin);
select pg_temp.check(public.can_access_application_chat('a2'), 'Admin Staff with Applications permission opens every chat');
select pg_temp.act_as(:assigned);
select pg_temp.check(public.can_access_application_chat('a1'), 'assigned employee has access');
select pg_temp.check(not public.can_access_application_chat('a2'), 'assigned employee has no access to unassigned application');
select pg_temp.act_as(:manager);
select pg_temp.check(not public.can_access_application_chat('a1'), 'employee who is not assigned is denied, even with Applications permission');
select pg_temp.check((select count(*) from public.my_application_chats()) = 0, 'unassigned manager has no conversations');
select pg_temp.act_as(:officer);
select pg_temp.check(public.can_access_application_chat('a1'), 'partnership officer of the partner has access');
select pg_temp.check(not public.can_access_application_chat('a2'), 'partnership officer has no access to other partners');
select pg_temp.check((public.application_chat_context('a1') ->> 'student') = 'Asha One', 'officer without the Applications module still gets the header');
select pg_temp.trusted();
update public.profiles set permissions = '{students}' where id = :admin;
select pg_temp.act_as(:admin);
select pg_temp.check(not public.can_access_application_chat('a1'), 'Admin Staff loses access when the Applications permission is removed');
select pg_temp.trusted();
update public.profiles set status = 'suspended' where id = :p1admin;
select pg_temp.act_as(:p1admin);
select pg_temp.check(not public.can_access_application_chat('a1'), 'suspended user loses access');
select pg_temp.trusted();
update public.profiles set status = 'active' where id = :p1admin;
update public.partners set portal_enabled = false where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check(not public.can_access_application_chat('a1'), 'closed partner portal removes access');
select pg_temp.trusted();
update public.partners set portal_enabled = true, modules = array_remove(modules, 'applications') where id = 'p1';
select pg_temp.act_as(:p1admin);
select pg_temp.check(not public.can_access_application_chat('a1'), 'partner loses access when the Applications module is off');
rollback;

\echo '== sending and history'
begin;
update public.applications set assigned_to = :assigned where id = 'a1';
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', '  Why is the assessment pending?  ', '11111111-1111-1111-1111-111111111111');
select pg_temp.check((select body from public.application_messages where client_id = '11111111-1111-1111-1111-111111111111') = 'Why is the assessment pending?', 'message saved and trimmed');
select pg_temp.check((select sender_name = 'P1 Admin' and sender_role = 'partner_admin' and sender_id = :p1admin::uuid from public.application_messages), 'sender is stamped by the server');
select pg_temp.send('a1', 'Why is the assessment pending?', '11111111-1111-1111-1111-111111111111');
select pg_temp.check((select count(*) from public.application_messages) = 1, 'retry with the same client id does not create a duplicate');
select pg_temp.denied($$select pg_temp.send('a1', '   ')$$, 'blank message rejected', '%CHAT_EMPTY%');
select pg_temp.denied($$select pg_temp.send('a1', repeat('x', 4001))$$, 'message over 4000 characters rejected', '%CHAT_TOO_LONG%');
select pg_temp.denied($$insert into public.application_messages (application_id, sender_name, sender_role, sender_org, body, client_id) values ('a1', 'Fake', 'super_admin', 'SSI', 'x', gen_random_uuid())$$, 'direct insert is not allowed');
select pg_temp.denied($$update public.application_messages set body = 'changed'$$, 'messages cannot be edited directly');
select pg_temp.denied($$delete from public.application_messages$$, 'messages cannot be deleted directly');
select pg_temp.denied($$insert into public.application_chat_reads (application_id, user_id) values ('a2', auth.uid())$$, 'read state cannot be written directly');
select pg_temp.send('a1', E'line one\nline two<script>x</script>\x01');
select pg_temp.check((select body from public.application_messages order by id desc limit 1) = E'line one\nline two<script>x</script>', 'new lines kept, control characters removed; text stored as written');
select pg_temp.act_as(:p2admin);
select pg_temp.check((select count(*) from public.application_messages) = 0, 'other organisation reads no messages (RLS)');
select pg_temp.check((select count(*) from public.application_chat_reads) = 0, 'other organisation reads no read receipts (RLS)');
select pg_temp.act_as(:manager);
select pg_temp.check((select count(*) from public.application_messages) = 0, 'unassigned employee reads no messages (RLS)');
select pg_temp.act_as(:assigned);
select pg_temp.check((select count(*) from public.application_messages where application_id = 'a1') = 2, 'assigned employee sees the same conversation');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.application_messages where application_id = 'a1') = 2, 'Admin sees the same conversation history');
select pg_temp.send('a2', 'Other application');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.application_messages) = 2, 'a different application has its own conversation');
select pg_temp.trusted();
select pg_temp.check(not exists (select 1 from public.audit_log where to_jsonb(audit_log)::text like '%assessment pending%'), 'message text is not in the audit log');
select pg_temp.check(not exists (select 1 from public.activities where to_jsonb(activities)::text like '%assessment pending%'), 'message text is not in the activity feed');
rollback;

\echo '== rate limit'
begin;
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'msg ' || g) from generate_series(1, 30) g;
select pg_temp.denied($$select pg_temp.send('a1', 'one too many')$$, 'more than 30 messages a minute rejected', '%CHAT_RATE_LIMIT%');
rollback;

\echo '== unread counts, read receipts and notifications'
begin;
update public.applications set assigned_to = :assigned where id = 'a1';
update public.partners set partnership_officer_id = :officer where id = 'p1';
delete from public.notifications;
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'secret passport detail');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :p1admin) = 0, 'sender is not notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :assigned) = 1, 'assigned employee is notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :officer) = 1, 'partnership officer is notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :super) = 1, 'Super Admin is notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :p1staff) = 1, 'other users of the organisation are notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id in (:p2admin, :manager)) = 0, 'unauthorised users are not notified');
select pg_temp.check(not exists (select 1 from public.notifications where kind = 'chat' and (title like '%passport%' or body like '%passport%')), 'notifications do not contain the message text');
select pg_temp.check((select link from public.notifications where kind = 'chat' and user_id = :assigned) = 'applications?chat=a1', 'notification opens the right chat');
select pg_temp.act_as(:p1admin);
select pg_temp.send('a1', 'second');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :assigned) = 1, 'unread notification is not repeated for every message');
select pg_temp.act_as(:assigned);
select pg_temp.check((select unread from public.my_application_chats() where application_id = 'a1') = 2, 'recipient has 2 unread');
select public.mark_application_chat_read('a1');
select pg_temp.check((select unread from public.my_application_chats() where application_id = 'a1') = 0, 'reading clears the unread count');
select pg_temp.check((select read_at is not null from public.notifications where kind = 'chat' and user_id = :assigned), 'reading marks the notification read');
select pg_temp.check((public.application_chat_context('a1') -> 'myLastReadId')::bigint > 0, 'read position is stored');
select public.mark_application_chat_read('a1', 1);
select pg_temp.check((select r.last_read_id > 1 from public.application_chat_reads r where r.user_id = :assigned), 'read position never moves backwards');
select pg_temp.send('a1', 'reply from staff');
select pg_temp.check((select unread from public.my_application_chats() where application_id = 'a1') = 0, 'own messages are never unread');
select pg_temp.act_as(:p1admin);
select pg_temp.check((select unread from public.my_application_chats() where application_id = 'a1') = 1, 'partner has 1 unread after the reply');
select pg_temp.check(jsonb_array_length(public.application_chat_context('a1') -> 'reads') = 2, 'read receipts list both participants');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :p1admin) = 1, 'partner is notified of the reply');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :assigned) = 1, 'staff who replied is not notified of their own reply');
rollback;

\echo '== partnership officer field'
begin;
select pg_temp.act_as(:p1admin);
select pg_temp.denied(format($$update public.partners set partnership_officer_id = %L where id = 'p1'$$, :officer), 'a partner cannot choose its own Partnership Officer');
select pg_temp.act_as(:super);
select pg_temp.denied(format($$update public.partners set partnership_officer_id = %L where id = 'p1'$$, :p1admin), 'the Partnership Officer must be an employee');
update public.partners set partnership_officer_id = :officer where id = 'p1';
select pg_temp.check((select partnership_officer_id = :officer::uuid from public.partners where id = 'p1'), 'Admin sets the Partnership Officer');
rollback;

delete from public.profiles where id in (:assigned, :manager, :officer);
delete from auth.users where id in (:assigned, :manager, :officer);
