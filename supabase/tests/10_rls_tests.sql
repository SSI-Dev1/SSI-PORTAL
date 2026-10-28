-- Security tests for the CRM schema: tenant isolation, MFA enforcement, role
-- separation, server-managed fields, audit log and storage policies.
-- Each test runs in its own transaction and rolls back. A failing test raises
-- SQLSTATE TF001 and stops the run (psql ON_ERROR_STOP).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = notice;

-- --------------------------------------------------------------- fixtures (trusted context)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@ssi.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff@ssi.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'p1admin@p1.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'p1staff@p1.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'p2admin@p2.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'suspended@p1.test');

insert into public.profiles (id, role, partner_id, full_name, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'super_admin',   null, 'Super Admin', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin_staff',   null, 'Staff', 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'partner_admin', 'p1', 'P1 Admin', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', 'partner_staff', 'p1', 'P1 Staff', 'active'),
  ('00000000-0000-0000-0000-0000000000c1', 'partner_admin', 'p2', 'P2 Admin', 'active'),
  ('00000000-0000-0000-0000-0000000000d1', 'partner_admin', 'p1', 'Suspended', 'suspended');

insert into public.universities (id, name, country) values ('u1', 'Test University', 'Australia'), ('u2', 'Other University', 'Canada');
insert into public.courses (id, university_id, name, level, tuition, currency, intakes)
values ('c1', 'u1', 'MSc Test', 'Postgraduate', 30000, 'AUD', '{Jul 2026}'), ('c2', 'u2', 'MBA', 'Postgraduate', 40000, 'CAD', '{Sep 2026}');
insert into public.students (id, partner_id, first_name, last_name, email) values
  ('s1', 'p1', 'Asha', 'One', 'asha@x.test'), ('s2', 'p2', 'Ben', 'Two', 'ben@x.test');
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status) values
  ('a1', 'x', 's1', 'p1', 'u1', 'c1', 'Jul 2026', 'Submitted'),
  ('a2', 'x', 's2', 'p2', 'u1', 'c1', 'Jul 2026', 'Visa Granted');
insert into public.documents (id, student_id, partner_id, name, type, file_name, storage_path) values
  ('d1', 's1', 'p1', 'Passport', 'Passport', 'p.pdf', 'p1/s1/d1.pdf'),
  ('d2', 's2', 'p2', 'Passport', 'Passport', 'p.pdf', 'p2/s2/d2.pdf');
insert into public.payments (id, invoice_no, partner_id, type, amount, due_date) values
  ('pay1', 'INV-1', 'p1', 'Service Fee', 500, now()), ('pay2', 'INV-2', 'p2', 'Service Fee', 500, now());
insert into public.announcements (id, title, category, body, published, publish_at, expires_at, audience) values
  ('n_all',   'For all',   'Admissions', 'x', true,  now() - interval '1 day', now() + interval '9 days', null),
  ('n_p2',    'For p2',    'Admissions', 'x', true,  now() - interval '1 day', now() + interval '9 days', '{p2}'),
  ('n_draft', 'Draft',     'Admissions', 'x', false, now() - interval '1 day', now() + interval '9 days', null);
insert into storage.objects (bucket_id, name) values
  ('student-documents', 'p1/s1/d1.pdf'), ('student-documents', 'p2/s2/d2.pdf');
insert into public.tasks (title, due) values ('Staff task', now());

-- --------------------------------------------------------------- helpers
-- Switch to an end user: role "authenticated" with the given user id and MFA level.
create or replace function pg_temp.act_as(uid text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg using errcode = 'TF001'; end if;
  raise notice 'pass: %', msg;
end $$;

-- Runs a write and returns how many rows it affected.
create or replace function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- Runs a statement that must be rejected.
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

\set p1admin '''00000000-0000-0000-0000-0000000000b1'''
\set p1staff '''00000000-0000-0000-0000-0000000000b2'''
\set p2admin '''00000000-0000-0000-0000-0000000000c1'''
\set super   '''00000000-0000-0000-0000-0000000000a1'''
\set staff   '''00000000-0000-0000-0000-0000000000a2'''
\set susp    '''00000000-0000-0000-0000-0000000000d1'''

\echo '== anonymous access'
begin; set local role anon;
select pg_temp.denied('select * from public.students', 'anon cannot read students');
select pg_temp.denied('select * from public.profiles', 'anon cannot read profiles');
select pg_temp.denied('select public.log_event(''login'')', 'anon cannot call log_event');
rollback;

\echo '== partner isolation (reads)'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from public.students) = 1, 'p1 sees only its own student');
select pg_temp.check(not exists (select 1 from public.students where id = 's2'), 'p1 cannot fetch p2 student by id (IDOR)');
select pg_temp.check((select count(*) from public.applications) = 1, 'p1 sees only its own applications');
select pg_temp.check((select count(*) from public.documents) = 1, 'p1 sees only its own documents');
select pg_temp.check((select count(*) from public.payments) = 1 and (select partner_id from public.payments) = 'p1', 'p1 admin sees only its own invoices');
select pg_temp.check((select count(*) from public.partners) = 1, 'p1 sees only its own partner record');
select pg_temp.check((select array_agg(id order by id) from public.announcements) = '{n_all}', 'p1 sees only published, addressed announcements');
select pg_temp.check((select count(*) from public.profiles) = 1, 'p1 sees only its own profile');
select pg_temp.check((select count(*) from public.tasks) = 0, 'partners cannot see staff tasks');
select pg_temp.check((select count(*) from public.audit_log) = 0, 'partners cannot read the audit log');
select pg_temp.check(not exists (select 1 from public.activities where partner_id = 'p2'), 'p1 sees no p2 activity');
rollback;

begin; select pg_temp.act_as(:p1staff);
select pg_temp.check((select count(*) from public.payments) = 0, 'partner staff cannot see finance');
select pg_temp.check(pg_temp.affected($q$update public.partners set phone = '+91 2' where id = 'p1'$q$) = 0, 'partner staff cannot edit organisation');
select pg_temp.check((select count(*) from public.students) = 1, 'partner staff sees own org students');
rollback;

\echo '== partner isolation (writes)'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check(pg_temp.affected($q$update public.students set first_name = 'X' where id = 's2'$q$) = 0, 'p1 cannot update p2 student');
select pg_temp.check(pg_temp.affected($q$delete from public.applications where id = 'a2'$q$) = 0, 'p1 cannot delete p2 application');
insert into public.students (id, partner_id, first_name, last_name, email) values ('s_new', 'p2', 'Spoof', 'Tenant', 's@x.test');
select pg_temp.check((select partner_id from public.students where id = 's_new') = 'p1', 'browser-supplied partner_id is ignored (forced to own org)');
select pg_temp.denied($$update public.students set partner_id = 'p2' where id = 's1'$$, 'p1 cannot move a student to another org');
select pg_temp.denied($$insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status)
  values ('a_x', 'x', 's2', 'p1', 'u1', 'c1', 'Jul 2026', 'Draft')$$, 'p1 cannot attach an application to p2 student');
select pg_temp.denied($$insert into public.documents (id, student_id, partner_id, name, type, file_name, storage_path)
  values ('d_x', 's1', 'p1', 'x', 'Passport', 'x.pdf', 'p2/s2/d2.pdf')$$, 'document cannot point at another org file');
select pg_temp.denied($$insert into public.documents (id, student_id, partner_id, name, type, file_name, storage_path)
  values ('d_y', 's1', 'p1', 'x', 'Passport', 'x.pdf', 'p1/s1/../../p2/s2/d2.pdf')$$, 'document path traversal rejected');
select pg_temp.denied($$update public.partners set name = 'Hacked' where id = 'p1'$$, 'partner cannot rename its organisation');
select pg_temp.check(pg_temp.affected($q$update public.partners set phone = '+91 1' where id = 'p1'$q$) = 1, 'partner admin can update own contact details');
select pg_temp.check(pg_temp.affected($q$update public.partners set phone = '+91 1' where id = 'p2'$q$) = 0, 'partner admin cannot update another partner');
select pg_temp.check(pg_temp.affected($q$update public.profiles set full_name = 'New Name' where id = auth.uid()$q$) = 1, 'user can edit own display name');
select pg_temp.denied($$insert into public.payments (id, invoice_no, partner_id, type, amount, due_date) values ('px','INV-X','p1','Service Fee',1,now())$$, 'partners cannot create invoices');
select pg_temp.denied($$insert into public.activities (partner_id, kind, title) values ('p1', 'status', 'forged')$$, 'activity feed cannot be forged');
select pg_temp.denied($$insert into public.audit_log (action) values ('forged')$$, 'audit log cannot be written directly');
select pg_temp.denied($$delete from public.audit_log$$, 'audit log cannot be deleted');
rollback;

\echo '== workflow guards'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.denied($$update public.applications set status = 'Conditional Offer' where id = 'a1'$$, 'partner cannot set offer/visa status');
select pg_temp.denied($$insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status)
  values ('a_v', 'x', 's1', 'p1', 'u1', 'c1', 'Jul 2026', 'Visa Granted')$$, 'partner cannot create a visa-granted application');
select pg_temp.denied($$insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status)
  values ('a_m', 'x', 's1', 'p1', 'u1', 'c2', 'Jul 2026', 'Draft')$$, 'course must belong to the university');
insert into public.applications (id, ref, student_id, partner_id, university_id, course_id, intake, status, timeline)
  values ('a_ok', 'FAKE-REF', 's1', 'p9', 'u1', 'c1', 'Jul 2026', 'Pending Assessment', '[{"status":"Visa Granted"}]');
select pg_temp.check((select ref like 'SSI-%' and partner_id = 'p1' and jsonb_array_length(timeline) = 1
  and timeline -> 0 ->> 'status' = 'Pending Assessment' from public.applications where id = 'a_ok'), 'ref, tenant and timeline are server-managed');
update public.applications set ref = 'CHANGED', timeline = '[]' where id = 'a_ok';
select pg_temp.check((select ref <> 'CHANGED' and jsonb_array_length(timeline) = 1 from public.applications where id = 'a_ok'), 'clients cannot rewrite ref or timeline');
select pg_temp.denied($$update public.documents set status = 'Verified' where id = 'd1'$$, 'partner cannot verify documents');
insert into public.assessments (id, student_id, partner_id, course_id, status, notes) values ('as1', 's1', 'p1', 'c1', 'Eligible', 'self-approved');
select pg_temp.check((select status = 'Pending' and notes = '' from public.assessments where id = 'as1'), 'partner cannot self-approve an assessment');
select pg_temp.denied($$update public.assessments set status = 'Eligible' where id = 'as1'$$, 'partner cannot review an assessment');
rollback;

\echo '== MFA and roles'
begin; select pg_temp.act_as(:staff, 'aal1');
select pg_temp.check((select count(*) from public.students) = 0, 'staff without MFA (aal1) sees no student data');
select pg_temp.check((select count(*) from public.profiles) = 1, 'staff without MFA can read only own profile');
rollback;

begin; select pg_temp.act_as(:staff, 'aal2');
select pg_temp.check((select count(*) from public.students) = 2, 'staff with MFA sees all organisations');
update public.applications set status = 'Conditional Offer', status_note = 'Offer issued' where id = 'a1';
select pg_temp.check((select status = 'Conditional Offer' and jsonb_array_length(timeline) = 2
  and timeline -> 1 ->> 'note' = 'Offer issued' and status_note is null from public.applications where id = 'a1'), 'staff status change appends server timeline entry');
select pg_temp.check(pg_temp.affected($q$update public.profiles set role = 'super_admin' where id <> auth.uid()$q$) = 0, 'admin staff cannot assign roles');
select pg_temp.check((select count(*) from public.audit_log) = 0, 'admin staff cannot read audit log');
select pg_temp.check(pg_temp.affected($q$delete from public.partners where id = 'p2'$q$) = 0, 'admin staff cannot delete partners');
rollback;

begin; select pg_temp.act_as(:super, 'aal2');
update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000c1') = 'suspended', 'super admin can suspend accounts');
select pg_temp.check((select count(*) from public.audit_log where entity = 'profiles' and changes ? 'status') >= 1, 'suspension is audit-logged');
select pg_temp.denied($$update public.profiles set role = 'partner_staff' where id = auth.uid()$$, 'super admin cannot change own role');
rollback;

begin; select pg_temp.act_as(:p1admin);
select pg_temp.denied($$update public.profiles set role = 'super_admin', partner_id = null where id = auth.uid()$$, 'partner cannot escalate own role');
select pg_temp.denied($$update public.profiles set status = 'suspended' where id = auth.uid()$$, 'user cannot change own status');
select pg_temp.check(pg_temp.affected($q$update public.profiles set full_name = 'x' where id <> auth.uid()$q$) = 0, 'partner cannot edit other profiles');
rollback;

begin; select pg_temp.act_as(:susp);
select pg_temp.check((select count(*) from public.students) = 0, 'suspended user sees no data');
select pg_temp.check((select count(*) from public.universities) = 0, 'suspended user cannot read catalogue');
select pg_temp.check((select status from public.profiles where id = auth.uid()) = 'suspended', 'suspended user can read own status (for messaging)');
rollback;

\echo '== audit log'
begin; select pg_temp.act_as(:p1admin);
select public.log_event('login');
select pg_temp.denied($$select public.log_event('grant_me_admin')$$, 'log_event accepts only known events');
select pg_temp.check(public.authorize_document_download('d1') = 'p1/s1/d1.pdf', 'own document download authorised');
select pg_temp.denied($$select public.authorize_document_download('d2')$$, 'other org document download denied');
reset role;
select pg_temp.check((select count(*) from public.audit_log where action in ('login', 'document_download')
  and actor_id = '00000000-0000-0000-0000-0000000000b1' and changes is null) = 2, 'login and download recorded without personal data');
select pg_temp.check((select count(*) from public.audit_log where entity = 'students' and action = 'insert') >= 2, 'record changes are audited');
rollback;

\echo '== document storage'
begin; select pg_temp.act_as(:p1admin);
select pg_temp.check((select count(*) from storage.objects) = 1, 'p1 lists only its own files');
insert into storage.objects (bucket_id, name) values ('student-documents', 'p1/s1/new.pdf');
select pg_temp.denied($$insert into storage.objects (bucket_id, name) values ('student-documents', 'p2/s2/evil.pdf')$$, 'p1 cannot upload into p2 folder');
select pg_temp.denied($$insert into storage.objects (bucket_id, name) values ('student-documents', 'p1/s2/evil.pdf')$$, 'p1 cannot upload for p2 student under own folder');
select pg_temp.denied($$insert into storage.objects (bucket_id, name) values ('student-documents', 'p1/s1/../../p2/x.pdf')$$, 'storage path traversal rejected');
select pg_temp.check(pg_temp.affected($q$delete from storage.objects where name like 'p2/%'$q$) = 0, 'p1 cannot delete p2 files');
rollback;

select pg_temp.check((select public from storage.buckets where id = 'student-documents') = false, 'document bucket is private');

\echo 'ALL SECURITY TESTS PASSED'
