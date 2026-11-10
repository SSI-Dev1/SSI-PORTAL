-- Employee self-service: photos, personal details, own documents, team members (0028).
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

-- From 70_hr_tests.sql: f1 HR (Human Resources), f2 manager of f3 + f4, f3 and f5 in Partnerships, f4 in Applications.
\set hr  '''00000000-0000-0000-0000-0000000000f1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set app '''00000000-0000-0000-0000-0000000000f4'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''

\echo '== profile photo'
begin;
select pg_temp.act_as(:po);
select public.set_profile_photo(:po, :po || '/p1.jpg');
select pg_temp.check((select photo_path = :po || '/p1.jpg' from public.profiles where id = :po), 'an employee sets their own photo');
select pg_temp.denied(format($$select public.set_profile_photo(%L, %L)$$, :pso, :pso || '/x.jpg'), 'but not someone else''s', '%your own photo%');
select pg_temp.denied(format($$select public.set_profile_photo(%L, %L)$$, :po, :pso || '/x.jpg'), 'the file must be in their own folder', '%Invalid photo%');
select pg_temp.trusted();
insert into storage.objects (bucket_id, name) values ('employee-photos', :po || '/p1.jpg');
select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'employee-photos') = 1, 'colleagues can see staff photos');
select pg_temp.denied(format($$insert into storage.objects (bucket_id, name) values ('employee-photos', %L)$$, :po || '/evil.jpg'), 'nobody uploads into another employee''s folder', '%row-level security%');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'employee-photos') = 0, 'partner users cannot see staff photos');
select pg_temp.act_as(:hr);
select public.set_profile_photo(:po, null);
select pg_temp.check((select photo_path is null from public.profiles where id = :po), 'HR can remove an employee photo');
rollback;

\echo '== personal details'
begin;
select pg_temp.act_as(:po);
select public.update_personal_details(:po, '+91 98765 43210', 'priya.home@example.test', '12 MG Road, Kochi', 'Ravi', 'Brother', '+91 90000 00000');
select pg_temp.check((select personal_email = 'priya.home@example.test' and emergency_relation = 'Brother' from public.employee_personal_details where employee_id = :po), 'an employee saves their personal details');
select pg_temp.check((select phone = '+91 98765 43210' from public.profiles where id = :po), 'the phone is kept on the account');
select pg_temp.denied(format($$select public.update_personal_details(%L, 'abc', null, null, null, null, null)$$, :po), 'phone format is checked', '%valid phone%');
select pg_temp.denied(format($$select public.update_personal_details(%L, null, 'not-an-email', null, null, null, null)$$, :po), 'email format is checked', '%personal_email%');
select pg_temp.denied(format($$select public.update_personal_details(%L, null, null, null, null, null, null)$$, :pso), 'an employee cannot change a colleague''s details', '%your own details%');
select designation_id as des0, joining_date as join0 from public.employees where id = :po \gset
update public.employees set designation_id = 'application_team', joining_date = '2020-01-01' where id = :po;
select pg_temp.check((select designation_id = :'des0' and joining_date = :'join0' from public.employees where id = :po), 'an employee cannot change employment fields');
select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.employee_personal_details where employee_id = :po) = 0, 'a manager cannot read personal details');
select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.employee_personal_details) = 0, 'colleagues cannot read personal details');
select pg_temp.act_as(:hr);
select pg_temp.check((select count(*) from public.employee_personal_details where employee_id = :po) = 1, 'HR can read them');
select public.update_personal_details(:po, '+91 98765 43210', 'priya.new@example.test', '12 MG Road, Kochi', 'Ravi', 'Brother', '+91 90000 00000');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.notifications where user_id = :po and title = 'HR updated your personal details'), 'the employee is told when HR changes them');
rollback;

\echo '== documents uploaded by the employee'
begin;
select pg_temp.act_as(:po);
insert into public.employee_documents (id, employee_id, category, title, file_name, size, mime, storage_path, visible_to_employee, source)
  values ('mydoc', :po, 'Qualification', 'MBA certificate', 'mba.pdf', 2000, 'application/pdf', :po || '/mydoc.pdf', false, 'employee');
select pg_temp.check((select source = 'employee' and visible_to_employee and review_status = 'Pending Review' from public.employee_documents where id = 'mydoc'),
  'an employee uploads their own document; it waits for HR');
select pg_temp.denied(format($$insert into public.employee_documents (employee_id, category, title, file_name, size, mime, storage_path, source)
  values (%L, 'Payslip', 'Fake payslip', 'p.pdf', 10, 'application/pdf', %L, 'employee')$$, :po, :po || '/p.pdf'), 'employees cannot upload HR-only categories', '%row-level security%');
select pg_temp.denied(format($$insert into public.employee_documents (employee_id, category, title, file_name, size, mime, storage_path, source)
  values (%L, 'Other', 'For colleague', 'x.pdf', 10, 'application/pdf', %L, 'employee')$$, :pso, :pso || '/x.pdf'), 'nor upload for someone else', '%row-level security%');
select pg_temp.denied(format($$insert into storage.objects (bucket_id, name) values ('hr-documents', %L)$$, :pso || '/x.pdf'), 'nor into someone else''s folder', '%row-level security%');
update public.employee_documents set review_status = 'Verified' where id = 'mydoc';
select pg_temp.check((select review_status = 'Pending Review' from public.employee_documents where id = 'mydoc'), 'an employee cannot verify their own document');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.notifications where user_id = :hr and title = 'Document uploaded for review'), 'HR is notified of the upload');

select pg_temp.act_as(:hr);
select pg_temp.denied($$update public.employee_documents set review_status = 'Verified' where id = 'mydoc'$$, 'review goes through Verify / Reject', '%Verify / Reject%');
select pg_temp.denied($$select public.review_employee_document('mydoc', 'Rejected', '')$$, 'rejecting needs a reason', '%why%');
select public.review_employee_document('mydoc', 'Rejected', 'Scan is unreadable');
select pg_temp.check((select review_status = 'Rejected' and review_note = 'Scan is unreadable' and reviewed_by = :hr from public.employee_documents where id = 'mydoc'), 'HR rejects with a note');
update public.employee_documents set visible_to_employee = false where id = 'mydoc';
select pg_temp.check((select visible_to_employee from public.employee_documents where id = 'mydoc'), 'an employee''s own upload stays visible to them');

select pg_temp.act_as(:po);
select pg_temp.check((select array_agg(action order by id) from public.employee_document_events where document_id = 'mydoc') = array['uploaded', 'rejected'],
  'the employee sees the history of their own document');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.notifications where user_id = :po and title = 'Document rejected: MBA certificate'), 'the employee is told the result');

select pg_temp.act_as(:hr);
insert into public.employee_documents (id, employee_id, category, title, file_name, size, mime, storage_path)
  values ('hronly', :po, 'Employment Contract', 'Contract (HR copy)', 'c.pdf', 10, 'application/pdf', :po || '/hronly.pdf');
select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.employee_document_events where document_id = 'hronly') = 0, 'history of HR-only documents stays hidden');
select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.employee_documents where employee_id = :po) = 0, 'a colleague sees none of them');
select pg_temp.check((select count(*) from public.employee_document_events where employee_id = :po) = 0, 'nor their history');
select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.employee_documents where employee_id = :po) = 0, 'nor does the manager');
rollback;

\echo '== team members'
begin;
select pg_temp.trusted();
insert into public.leave_requests (employee_id, leave_type, start_date, end_date, days, reason, status, half_day_session)
  values (:pso, 'sick', public.company_today(), public.company_today(), 0.5, 'Private medical reason', 'Approved', 'morning');
select pg_temp.act_as(:po);
select pg_temp.check((select array_agg(relation order by relation) from public.my_team_members()) = array['department', 'manager', 'peer', 'you'],
  'officer sees: department colleague, manager, peer with the same manager, themselves');
select pg_temp.check((select availability = 'morning_leave' from public.my_team_members() where id = :pso), 'a colleague''s morning leave shows as morning leave');
select pg_temp.check((select attendance_state is null from public.my_team_members() where id = :pso), 'colleagues'' attendance is not shown to non-managers');
select pg_temp.check(not exists (select 1 from public.my_team_members() where id = :hr), 'people outside the department and team are not listed');
select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.my_team_members() where relation = 'my team') = 2, 'a manager sees their team');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.my_team_members()) = 0, 'partner users see no internal team');
rollback;
