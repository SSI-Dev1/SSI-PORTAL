-- Temporary login credentials, first-login password change and delivery status (0024).
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
\set stadmin '''00000000-0000-0000-0000-0000000000c1'''
\set lead    '''00000000-0000-0000-0000-00000000e0a4'''
\set hr      '''00000000-0000-0000-0000-00000000c4e1'''
\set newemp  '''00000000-0000-0000-0000-00000000c4e2'''
\set newstaff '''00000000-0000-0000-0000-00000000c4e3'''
\set otherstaff '''00000000-0000-0000-0000-00000000c4e4'''
\set admin2  '''00000000-0000-0000-0000-00000000c4e5'''

-- Accounts as the account functions create them; encrypted_password stands in for the bcrypt hash.
insert into auth.users (id, email, encrypted_password) values
  (:hr, 'hr@ssi.test', '$2a$hr'), (:newemp, 'new.emp@ssi.test', '$2a$temp-1'), (:newstaff, 'new.staff@p2.test', '$2a$temp-2'),
  (:otherstaff, 'staff@p1.test', '$2a$temp-3'), (:admin2, 'admin2@ssi.test', '$2a$a2');
insert into public.profiles (id, role, partner_id, full_name, email, status, permissions, partner_permissions) values
  (:hr, 'support_staff', null, 'HR Manager', 'hr@ssi.test', 'active', '{hr,hr_accounts,tasks}', null),
  (:newemp, 'application_manager', null, 'New Employee', 'new.emp@ssi.test', 'active', null, null),
  (:newstaff, 'partner_staff', 'p2', 'New P2 Staff', 'new.staff@p2.test', 'active', null, '{students.view}'),
  (:otherstaff, 'partner_staff', 'p1', 'P1 Staff Member', 'staff@p1.test', 'active', null, '{students.view}'),
  (:admin2, 'admin_staff', null, 'Second Admin', 'admin2@ssi.test', 'active', null, null);

\echo '== temporary credentials are recorded as a hash and expire'
begin;
select pg_temp.trusted();
set local role service_role;
select pg_temp.check(public.record_temp_credential(:newemp, 72, :super) > now() + interval '71 hours', 'temporary password expires after the configured hours');
reset role;
select pg_temp.check((select password_hash = '$2a$temp-1' from public.account_temp_credentials where user_id = :newemp), 'only the Auth hash is kept, never the password');
select pg_temp.check((select must_change_password from public.profiles where id = :newemp), 'a temporary password forces a password change');
select pg_temp.act_as(:newemp);
select pg_temp.denied($$select * from public.account_temp_credentials$$, 'nobody can read temporary credentials');
select pg_temp.denied($$select public.record_temp_credential(auth.uid(), 720)$$, 'users cannot issue temporary credentials');
select pg_temp.check(public.my_temp_password_state() = 'active', 'state is active before expiry');
rollback;

\echo '== first login: no data until the password is changed, and the flag cannot be skipped'
begin;
select pg_temp.trusted();
select public.record_temp_credential(:newemp, 72, :super);
select pg_temp.act_as(:newemp);
select pg_temp.check(not public.my_profile_ok(), 'no data access while the temporary password is in use');
select pg_temp.check(not public.is_staff() and (select count(*) from public.students) = 0, 'RLS returns nothing before the change');
select pg_temp.check((select must_change_password from public.my_access()), 'the app is told a change is required');
update public.profiles set must_change_password = false where id = auth.uid();
select pg_temp.check((select must_change_password from public.my_access()), 'the flag cannot be cleared directly');
-- Even with row access, the guard refuses (covers any policy that lets users edit their own row).
select pg_temp.trusted();
select set_config('request.jwt.claims', json_build_object('sub', :newemp, 'role', 'authenticated')::text, true);
select pg_temp.denied(format($$update public.profiles set must_change_password = false where id = %L$$, :newemp), 'the guard refuses clearing it outside password_change_done', '%Set a new password%');
select pg_temp.act_as(:newemp);
select pg_temp.denied($$select public.password_change_done()$$, 'cannot finish without actually changing the password', '%PASSWORD_NOT_CHANGED%');
select pg_temp.trusted();
update auth.users set encrypted_password = '$2a$new-permanent' where id = :newemp;   -- what supabase.auth.updateUser does
select pg_temp.act_as(:newemp);
select public.password_change_done();
select pg_temp.check(public.my_profile_ok() and public.is_staff(), 'access opens after the change');
select pg_temp.check(public.my_temp_password_state() is null, 'the temporary credential is gone');
select pg_temp.check(not (select must_change_password from public.my_access()), 'the correct portal can open (no change required)');
rollback;

\echo '== expired temporary password'
begin;
select pg_temp.trusted();
select public.record_temp_credential(:newemp, 1, :super);
update public.account_temp_credentials set expires_at = now() - interval '1 minute' where user_id = :newemp;
update auth.users set encrypted_password = '$2a$new' where id = :newemp;
select pg_temp.act_as(:newemp);
select pg_temp.check(public.my_temp_password_state() = 'expired', 'expiry is reported');
select pg_temp.denied($$select public.password_change_done()$$, 'an expired temporary password cannot be exchanged', '%TEMP_PASSWORD_EXPIRED%');
select pg_temp.check(not public.my_profile_ok(), 'still no data access');
rollback;

\echo '== resending replaces the earlier temporary password'
begin;
select pg_temp.trusted();
select public.record_temp_credential(:newemp, 72, :super);
update auth.users set encrypted_password = '$2a$temp-resent' where id = :newemp;
select public.record_temp_credential(:newemp, 72, :hr);
select pg_temp.check((select password_hash = '$2a$temp-resent' and issued_by = :hr::uuid from public.account_temp_credentials where user_id = :newemp), 'new hash and issuer recorded; old one superseded');
select pg_temp.check((select count(*) from public.account_temp_credentials where user_id = :newemp) = 1, 'one temporary credential per account');
rollback;

\echo '== who may see delivery status and resend access'
begin;
select pg_temp.trusted();
insert into public.account_credential_deliveries (user_id, kind, status, provider_message_id) values
  (:newemp, 'initial', 'accepted', '<m1@brevo>'), (:newstaff, 'initial', 'accepted', '<m2@brevo>'),
  (:otherstaff, 'initial', 'failed', null), (:admin2, 'initial', 'accepted', '<m3@brevo>');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.account_credential_deliveries) = 4, 'Super Admin sees every delivery');
select pg_temp.act_as(:hr);
select pg_temp.check(public.can_manage_account(:newemp) and not public.can_manage_account(:admin2), 'HR manages employees but not Admin accounts');
select pg_temp.check((select array_agg(user_id) from public.account_credential_deliveries) = array[:newemp::uuid], 'HR sees only employee deliveries');
select pg_temp.check(not public.can_manage_account(:newstaff), 'HR cannot manage partner accounts');
select pg_temp.act_as(:stadmin);
select pg_temp.check(public.can_manage_account(:newstaff), 'Partner Admin manages own staff');
select pg_temp.check(not public.can_manage_account(:otherstaff), 'Partner Admin cannot reset another organisation''s employee');
select pg_temp.check((select array_agg(user_id) from public.account_credential_deliveries) = array[:newstaff::uuid], 'Partner Admin sees only own organisation');
select pg_temp.denied(format($$select public.partner_team_authorize('reset_password', %L)$$, :otherstaff), 'partner-team refuses another organisation''s account', '%TEAM_DENIED%');
select pg_temp.act_as(:p1admin);
select pg_temp.check(not public.can_manage_account(:newstaff), 'other Partner Admin cannot see P2 accounts');
select pg_temp.act_as(:newstaff);
select pg_temp.check(not public.can_manage_account(:newstaff) and (select count(*) from public.account_credential_deliveries) = 0, 'staff cannot see delivery records');
select pg_temp.denied($$insert into public.account_credential_deliveries (user_id, kind) values (auth.uid(), 'resend')$$, 'delivery records cannot be written from the app');
rollback;

\echo '== delivery events: accepted is not delivered'
begin;
select pg_temp.trusted();
insert into public.account_credential_deliveries (id, user_id, kind, status, provider_message_id) values
  ('11111111-1111-1111-1111-111111111111', :newemp, 'initial', 'accepted', '<a@brevo>'),
  ('22222222-2222-2222-2222-222222222222', :newstaff, 'initial', 'accepted', '<b@brevo>');
select public.apply_email_event('<a@brevo>', 'request');
select pg_temp.check((select status from public.account_credential_deliveries where provider_message_id = '<a@brevo>') = 'accepted', 'a request event is still only accepted');
select public.apply_email_event('<a@brevo>', 'soft_bounce');
select pg_temp.check((select status = 'accepted' and detail like 'Delivery delayed%' from public.account_credential_deliveries where provider_message_id = '<a@brevo>'), 'soft bounce stays accepted with a note');
select public.apply_email_event('<a@brevo>', 'delivered');
select pg_temp.check((select status from public.account_credential_deliveries where provider_message_id = '<a@brevo>') = 'delivered', 'delivered only on the provider''s delivered event');
select public.apply_email_event('<a@brevo>', 'spam');
select pg_temp.check((select status from public.account_credential_deliveries where provider_message_id = '<a@brevo>') = 'delivered', 'a later spam report does not undo delivery');
select public.apply_email_event('<b@brevo>', 'hard_bounce', 'Mailbox does not exist');
select pg_temp.check((select status = 'failed' and detail = 'Mailbox does not exist' from public.account_credential_deliveries where provider_message_id = '<b@brevo>'), 'hard bounce marks the email failed');
select public.apply_email_event('<b@brevo>', 'delivered');
select pg_temp.check((select status from public.account_credential_deliveries where provider_message_id = '<b@brevo>') = 'failed', 'failed stays failed');
select public.apply_email_event('<unknown@brevo>', 'delivered');
select pg_temp.act_as(:super);
select pg_temp.denied($$select public.apply_email_event('<a@brevo>', 'delivered')$$, 'users cannot post delivery events');
rollback;

\echo '== existing behaviour kept'
begin;
select pg_temp.act_as(:hr);
select pg_temp.check(public.my_profile_ok() and public.staff_can('hr_accounts'), 'accounts without a pending change keep their access');
select pg_temp.denied($$update public.profiles set must_change_password = true, status = 'suspended' where id = auth.uid()$$, 'users still cannot change their own status');
rollback;

select pg_temp.trusted();
delete from public.profiles where id in (:hr, :newemp, :newstaff, :otherstaff, :admin2);
delete from auth.users where id in (:hr, :newemp, :newstaff, :otherstaff, :admin2);
