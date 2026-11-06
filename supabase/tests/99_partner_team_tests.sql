-- Partner Company Employees: permissions, team management rules, isolation, commission (0022).
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
\set admin   '''00000000-0000-0000-0000-0000000000a2'''
\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set stadmin '''00000000-0000-0000-0000-00000000e0a1'''
\set emp1    '''00000000-0000-0000-0000-00000000e0a2'''
\set emp2    '''00000000-0000-0000-0000-00000000e0a3'''
\set lead    '''00000000-0000-0000-0000-00000000e0a4'''

-- What "SSI Admin creates Sterling" and "Sterling Admin creates employees" leave in the database
-- (admin-users create_partner / partner-team create_member write exactly these rows).
insert into public.partners (id, name, code, contact_name, email, status, portal_enabled, modules, commission_rate)
values ('sterling', 'Sterling', 'STR', 'Sterling Admin', 'admin@sterling.test', 'Active', true,
        '{students,applications,course_finder,assessments,documents,finance,updates}', 12.5);
insert into auth.users (id, email) values (:stadmin, 'admin@sterling.test'), (:emp1, 'emp1@sterling.test'), (:emp2, 'emp2@sterling.test'), (:lead, 'lead@sterling.test');
insert into public.profiles (id, role, partner_id, full_name, email, status, partner_permissions, created_by) values
  (:stadmin, 'partner_admin', 'sterling', 'Sterling Admin', 'admin@sterling.test', 'active', null, :super),
  (:emp1, 'partner_staff', 'sterling', 'Sterling Employee 1', 'emp1@sterling.test', 'active',
     '{students.view,students.add,applications.view,applications.create,chat,course_finder,updates}', :stadmin),
  (:emp2, 'partner_staff', 'sterling', 'Sterling Employee 2', 'emp2@sterling.test', 'active', '{students.view}', :stadmin),
  (:lead, 'partner_staff', 'sterling', 'Sterling Team Lead', 'lead@sterling.test', 'active', '{students.view,team.manage}', :stadmin);
insert into public.students (id, partner_id, first_name, last_name, email) values ('st-s1', 'sterling', 'Sara', 'Sterling', 'sara@x.test');
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status)
values ('st-a1', 'STR-1', 'st-s1', 'sterling', 'u1', 'c1', 'Jul 2026', 'Submitted');
insert into public.documents (id, student_id, partner_id, name, type, file_name, storage_path)
values ('st-d1', 'st-s1', 'sterling', 'Passport', 'Passport', 'p.pdf', 'sterling/st-s1/st-d1.pdf');
insert into public.payments (id, invoice_no, partner_id, type, amount, due_date) values
  ('st-pay1', 'INV-S1', 'sterling', 'Commission', 900, now()), ('st-pay2', 'INV-S2', 'sterling', 'Service Fee', 100, now());

\echo '== hierarchy and effective permissions'
begin;
select pg_temp.act_as(:stadmin);
select pg_temp.check('team.manage' = any (public.my_partner_permissions()) and public.partner_can('finance'), 'Partner Admin manages the team and has finance');
select pg_temp.check((select count(*) from public.partner_team()) = 4, 'Partner Admin sees the whole Sterling team');
select pg_temp.check((select commission from public.my_access()), 'Partner Admin may see commission');
select pg_temp.act_as(:emp1);
select pg_temp.check(not ('team.manage' = any (public.my_partner_permissions())), 'employee has no team management');
select pg_temp.check(not public.partner_can('finance'), 'employee has no finance');
select pg_temp.check(not (select commission from public.my_access()), 'employee has no commission access');
select pg_temp.check((select count(*) from public.partner_team()) = 0, 'employee cannot list the team');
select pg_temp.check((select count(*) from public.profiles) = 1, 'employee reads only their own account');
select pg_temp.check(public.partner_can('course_finder') and public.partner_can('updates') and not public.partner_can('assessments'), 'module access follows the employee''s permissions');
select pg_temp.act_as(:p1staff);
select pg_temp.check(public.partner_can('documents') and public.partner_perm('documents.upload') and not public.partner_perm('team.manage'),
  'existing partner staff keep their previous access (no team management)');
rollback;

\echo '== team management rules'
begin;
select pg_temp.act_as(:stadmin);
select pg_temp.check(public.partner_team_authorize('create', null, '{students.view,chat}') = 'sterling', 'Partner Admin may create an employee; organisation comes from the caller');
select pg_temp.check(public.partner_team_authorize('update', :emp1::uuid, '{students.view,team.manage}') = 'sterling', 'Partner Admin may make an employee a team manager');
select pg_temp.denied($$select public.partner_team_authorize('create', null, '{commission.view}')$$, 'commission permission does not exist for employees', '%TEAM_INVALID%');
select pg_temp.denied($$select public.partner_team_authorize('create', null, '{finance}')$$, 'finance cannot be granted', '%TEAM_INVALID%');
select pg_temp.denied(format($$select public.partner_team_authorize('status', %L)$$, :stadmin), 'Partner Admin cannot manage their own account here', '%TEAM_DENIED%');
select pg_temp.denied(format($$select public.partner_team_authorize('reset_password', %L)$$, :p1staff), 'Partner Admin cannot touch another organisation''s user', '%TEAM_DENIED%');
select pg_temp.denied(format($$select public.partner_team_authorize('update', %L)$$, :super), 'Partner Admin cannot touch SSI accounts', '%TEAM_DENIED%');
select pg_temp.trusted();
update public.partners set modules = array_remove(modules, 'documents') where id = 'sterling';
select pg_temp.act_as(:stadmin);
select pg_temp.denied($$select public.partner_team_authorize('create', null, '{documents.upload}')$$, 'cannot grant a module SSI has not enabled for the organisation', '%TEAM_DENIED%');
select pg_temp.act_as(:lead);
select pg_temp.check(public.partner_team_authorize('update', :emp2::uuid, '{students.view,chat}') = 'sterling', 'team manager may manage ordinary employees');
select pg_temp.denied($$select public.partner_team_authorize('create', null, '{team.manage}')$$, 'team manager cannot grant team management', '%TEAM_DENIED%');
select pg_temp.denied(format($$select public.partner_team_authorize('status', %L)$$, :stadmin), 'team manager cannot manage the Partner Admin', '%TEAM_DENIED%');
select pg_temp.act_as(:emp1);
select pg_temp.denied($$select public.partner_team_authorize('create', null, '{students.view}')$$, 'employee cannot create accounts', '%TEAM_DENIED%');
select pg_temp.denied(format($$update public.profiles set partner_permissions = '{students.view,team.manage}' where id = %L$$, :emp1), 'employee cannot raise their own permissions', '%only be changed%');
select pg_temp.denied(format($$update public.profiles set role = 'partner_admin' where id = %L$$, :emp1), 'employee cannot make themself Partner Admin');
select pg_temp.act_as(:stadmin);
update public.profiles set partner_permissions = '{students.view}' where id = :emp1;
select pg_temp.trusted();
select pg_temp.check((select 'chat' = any (partner_permissions) from public.profiles where id = :emp1), 'Partner Admin cannot write permissions directly either (only through the server function)');
rollback;

\echo '== permissions on records'
begin;
select pg_temp.act_as(:emp1);
insert into public.students (id, partner_id, first_name, last_name, email) values ('st-s2', 'sterling', 'New', 'Student', 'n@x.test');
select pg_temp.check((select created_by = :emp1::uuid from public.students where id = 'st-s2'), 'student created by the employee is attributed to the employee');
select pg_temp.trusted();
select pg_temp.check((select actor_id = :emp1::uuid and partner_id = 'sterling' from public.audit_log where entity = 'students' and entity_id = 'st-s2' and action = 'insert'), 'audit log records the employee and organisation');
select pg_temp.act_as(:emp1);
insert into public.applications (id, student_id, university_id, course_id, intake, status) values ('st-a2', 'st-s2', 'u1', 'c1', 'Jan 2027', 'Draft');
select pg_temp.check((select partner_id = 'sterling' and created_by = :emp1::uuid from public.applications where id = 'st-a2'), 'application belongs to Sterling and to its creator');
select pg_temp.check(public.can_access_application_chat('st-a1'), 'employee with chat permission opens the application chat');
update public.students set last_name = 'Changed' where id = 'st-s1';
select pg_temp.trusted();
select pg_temp.check((select last_name = 'Sterling' from public.students where id = 'st-s1'), 'employee without "Edit Students" cannot edit');
select pg_temp.act_as(:emp1);
delete from public.students where id = 'st-s1';
select pg_temp.check(exists (select 1 from public.students where id = 'st-s1'), 'employee cannot delete students');
select pg_temp.check((select count(*) from public.documents) = 0, 'employee without "View Documents" sees no documents');
insert into public.students (id, partner_id, first_name, last_name, email) values ('spoof', 'p1', 'X', 'Y', 'x@y.test');
select pg_temp.check((select partner_id = 'sterling' from public.students where id = 'spoof'), 'organisation sent by the browser is ignored: the student stays in Sterling');
select pg_temp.act_as(:emp2);
select pg_temp.check((select count(*) from public.students) = 3 and not exists (select 1 from public.students where partner_id <> 'sterling'), 'View Students only: sees Sterling students');
select pg_temp.check((select count(*) from public.applications) = 0 and not public.can_access_application_chat('st-a1'), 'no application or chat permission: no applications, no chat');
select pg_temp.denied($$insert into public.students (id, partner_id, first_name, last_name, email) values ('st-s3', 'sterling', 'X', 'Y', 'x@y.test')$$,
  'View Students only: cannot add');
select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.students where partner_id = 'sterling') = 3, 'SSI Admin sees the employee''s new students');
rollback;

\echo '== isolation between organisations'
begin;
select pg_temp.act_as(:p2admin);
select pg_temp.check((select count(*) from public.students where partner_id = 'sterling') = 0, 'another partner sees no Sterling students');
select pg_temp.check((select count(*) from public.applications where partner_id = 'sterling') = 0, 'another partner sees no Sterling applications');
select pg_temp.check((select count(*) from public.documents where partner_id = 'sterling') = 0, 'another partner sees no Sterling documents');
select pg_temp.check(not public.can_access_application_chat('st-a1'), 'another partner cannot open Sterling chats');
select pg_temp.check((select count(*) from public.partner_team() where id in (:stadmin, :emp1)) = 0, 'another partner cannot list Sterling''s team');
select pg_temp.check((select count(*) from public.profiles where partner_id = 'sterling') = 0, 'another partner reads no Sterling accounts');
select pg_temp.denied(format($$select public.partner_team_authorize('status', %L)$$, :emp1), 'another partner cannot manage Sterling employees', '%TEAM_DENIED%');
rollback;

\echo '== commission'
begin;
select pg_temp.act_as(:emp1);
select pg_temp.denied($$select commission_rate from public.partners$$, 'employee cannot select the commission rate', '%permission denied%');
select pg_temp.check((select name = 'Sterling' from public.partners), 'employee still reads the organisation name');
select pg_temp.check((select count(*) from public.partner_commissions()) = 0, 'commission API returns nothing to employees');
select pg_temp.check((select count(*) from public.payments) = 0, 'employee sees no invoices or commission payments');
select pg_temp.act_as(:stadmin);
select pg_temp.check((select commission_rate = 12.5 from public.partner_commissions() where partner_id = 'sterling'), 'Partner Admin sees Sterling''s commission');
select pg_temp.check((select count(*) from public.partner_commissions()) = 1, 'Partner Admin sees only their own commission');
select pg_temp.check((select count(*) from public.payments where type = 'Commission') = 1, 'Partner Admin sees commission invoices');
select pg_temp.denied($$update public.partners set commission_visible = false where id = 'sterling'$$, 'Partner Admin cannot change commission visibility', '%Super Admin%');
select pg_temp.act_as(:super);
update public.partners set commission_visible = false where id = 'sterling';
select pg_temp.act_as(:stadmin);
select pg_temp.check((select count(*) from public.partner_commissions()) = 0 and not (select commission from public.my_access()), 'commission hidden by SSI: Partner Admin no longer sees it');
select pg_temp.check((select count(*) from public.payments where type = 'Commission') = 0 and (select count(*) from public.payments) = 1, 'commission invoices hidden, other invoices kept');
select pg_temp.act_as(:admin);
select pg_temp.check((select count(*) from public.partner_commissions()) >= 3, 'SSI Admin Staff with Partners permission sees every commission');
rollback;

\echo '== notifications follow permissions'
begin;
delete from public.notifications;
select pg_temp.act_as(:super);
select (public.send_application_message('st-a1', 'Offer received', gen_random_uuid())).id;
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id in (:stadmin, :emp1)) = 2, 'Partner Admin and the employee with chat are notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id in (:emp2, :lead)) = 0, 'employees without chat permission are not notified');
select pg_temp.check((select count(*) from public.notifications where kind = 'chat' and user_id = :p2admin) = 0, 'other organisations are not notified');
rollback;

\echo '== suspension'
begin;
select pg_temp.trusted();
update public.profiles set status = 'suspended' where id = :emp1;
select pg_temp.act_as(:emp1);
select pg_temp.check((select count(*) from public.students) = 0 and not public.can_access_application_chat('st-a1'), 'suspended employee loses access immediately');
rollback;
begin;
select pg_temp.trusted();
update public.partners set status = 'Inactive' where id = 'sterling';
select pg_temp.act_as(:emp1);
select pg_temp.check((select count(*) from public.students) = 0, 'suspending Sterling revokes employee access');
select pg_temp.act_as(:stadmin);
select pg_temp.check((select count(*) from public.students) = 0 and (select count(*) from public.partner_team()) = 0, 'and the Partner Admin''s');
rollback;
begin;
select pg_temp.trusted();
update public.partners set portal_enabled = false where id = 'sterling';
select pg_temp.act_as(:emp2);
select pg_temp.check((select count(*) from public.students) = 0 and not (select portal_open from public.my_access()), 'closing the portal revokes employee access');
rollback;

\echo '== SSI HR data stays internal'
begin;
select pg_temp.act_as(:stadmin);
select pg_temp.check((select count(*) from public.employees) = 0 and (select count(*) from public.employee_salaries) = 0
  and (select count(*) from public.leave_requests) = 0 and (select count(*) from public.attendance_days) = 0, 'Partner Admin sees no SSI employees, salaries, leave or attendance');
rollback;

select pg_temp.trusted();
delete from public.payments where partner_id = 'sterling';
delete from public.documents where partner_id = 'sterling';
delete from public.applications where partner_id = 'sterling';
delete from public.students where partner_id = 'sterling';
delete from public.profiles where partner_id = 'sterling';
delete from auth.users where id in (:stadmin, :emp1, :emp2, :lead);
delete from public.partners where id = 'sterling';
