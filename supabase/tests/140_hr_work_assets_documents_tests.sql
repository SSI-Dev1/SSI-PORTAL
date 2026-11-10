-- Work assignments, company assets and employee documents (0027).
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

-- From 70_hr_tests.sql: f1 HR, f2 manager of f3 (officer) and f4 (application team), f5 outside the team.
\set super '''00000000-0000-0000-0000-0000000000a1'''
\set hr  '''00000000-0000-0000-0000-0000000000f1'''
\set mgr '''00000000-0000-0000-0000-0000000000f2'''
\set po  '''00000000-0000-0000-0000-0000000000f3'''
\set app '''00000000-0000-0000-0000-0000000000f4'''
\set pso '''00000000-0000-0000-0000-0000000000f5'''
\set partner '''00000000-0000-0000-0000-0000000000b1'''

\echo '== work assignments'
begin;
select pg_temp.act_as(:mgr);
select public.save_assignment(null, 'Prepare partner pitch deck', 'For the March roadshow', :po, 'High', '2026-12-15 18:00+05:30', '2026-12-01') as a1 \gset
select pg_temp.check((select kind = 'assignment' and status = 'Not Started' and assigned_by = :mgr and assigned_to = :po and progress = 0 from public.tasks where id = :'a1'),
  'a manager assigns work to their team member');
select pg_temp.denied(format($$select public.save_assignment(null, 'Outside team', null, %L, 'Normal', now() + interval '2 days')$$, :pso),
  'a manager cannot assign outside their team', '%your team%');
select pg_temp.denied(format($$select public.save_assignment(null, 'x', null, %L, 'Normal', now() + interval '2 days')$$, :po), 'title needs 3+ characters', '%3 to 300%');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.notifications where user_id = :po and title like 'New work assigned:%'), 'the assignee is notified');

select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.tasks where id = :'a1') = 1, 'the assignee sees the assignment');
update public.tasks set title = 'Renamed by employee', due = now() + interval '90 days' where id = :'a1';
select pg_temp.check((select title from public.tasks where id = :'a1') = 'Prepare partner pitch deck', 'the assignee cannot edit the assignment directly');
select pg_temp.denied(format($$insert into public.tasks (kind, title, due, assigned_to, status) values ('assignment', 'Self made', now(), %L, 'Not Started')$$, :po),
  'assignments cannot be inserted directly', '%row-level security%');
select pg_temp.denied(format($$select public.save_assignment(%L, 'Change mine', null, %L, 'Normal', now() + interval '2 days')$$, :'a1', :po),
  'the assignee cannot change title or deadline', '%Only whoever assigned%');
select public.update_assignment_progress(:'a1', 'In Progress', 40, 'Drafted the outline');
select pg_temp.check((select status = 'In Progress' and progress = 40 and last_note = 'Drafted the outline' from public.tasks where id = :'a1'), 'the assignee updates status and progress');
select pg_temp.denied(format($$select public.update_assignment_progress(%L, 'On Hold', 40, null)$$, :'a1'), 'on hold needs a reason', '%on hold%');
select public.update_assignment_progress(:'a1', 'Completed', 10, null);
select pg_temp.check((select status = 'Completed' and progress = 100 and done and completed_at is not null from public.tasks where id = :'a1'), 'completed means 100% and done');
select pg_temp.check((select count(*) from public.task_events where task_id = :'a1') = 3, 'history: created, progress, completed');
select pg_temp.trusted();
select pg_temp.check(exists (select 1 from public.notifications where user_id = :mgr and title like 'Work completed:%'), 'the manager is told the work is complete');

select pg_temp.act_as(:app);
select pg_temp.check((select count(*) from public.tasks where id = :'a1') = 0, 'a colleague cannot see someone else''s assignment');
select pg_temp.check((select count(*) from public.task_events where task_id = :'a1') = 0, 'nor its history');
select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.tasks where id = :'a1') = 0, 'an employee outside the team cannot see it');
select pg_temp.act_as(:hr);
select pg_temp.check((select count(*) from public.tasks where id = :'a1') = 1, 'HR sees every assignment');
select public.save_assignment(null, 'Update HR policy acknowledgement', null, :pso, 'Normal', now() + interval '5 days') as a2 \gset
select pg_temp.check((select assigned_to = :pso from public.tasks where id = :'a2'), 'HR can assign to anyone');

select pg_temp.act_as(:mgr);
select public.update_assignment_progress(:'a1', 'In Progress', 80, 'Reopened for changes');
select pg_temp.check((select not done and completed_at is null from public.tasks where id = :'a1'), 'reopening clears completion');
select public.save_assignment(:'a1', 'Prepare partner pitch deck', 'For the March roadshow', :app, 'High', '2026-12-20 18:00+05:30', '2026-12-01');
select pg_temp.check((select assigned_to = :app from public.tasks where id = :'a1')
  and exists (select 1 from public.task_events where task_id = :'a1' and action = 'reassigned'), 'a manager reassigns within the team; history kept');
select pg_temp.denied(format($$select public.cancel_assignment(%L, '')$$, :'a1'), 'cancelling needs a reason', '%reason%');
select public.cancel_assignment(:'a1', 'Roadshow postponed');
select pg_temp.denied(format($$select public.update_assignment_progress(%L, 'In Progress', 10, null)$$, :'a1'), 'a cancelled assignment cannot be updated', '%cancelled%');

select pg_temp.act_as(:po);
insert into public.tasks (title, due, priority) values ('Call the bank', now() + interval '1 day', 'Normal');
select pg_temp.check(exists (select 1 from public.tasks where title = 'Call the bank' and kind = 'task'), 'plain CRM tasks still work as before');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.tasks where kind = 'assignment') = 0, 'partner users see no assignments');
rollback;

\echo '== company assets'
begin;
select pg_temp.act_as(:hr);
insert into public.company_assets (id, asset_tag, name, category, serial_number) values ('as1', ' lap-001 ', 'MacBook Air 13', 'Laptop', 'C02XYZ');
select pg_temp.check((select asset_tag = 'LAP-001' and status = 'Available' from public.company_assets where id = 'as1'), 'HR adds an asset (tag normalised)');
select pg_temp.denied($$insert into public.company_assets (asset_tag, name, category) values ('lap-001', 'Duplicate', 'Laptop')$$, 'asset tags are unique', '%company_assets_tag_key%');
select pg_temp.denied($$insert into public.company_assets (asset_tag, name, category, status) values ('LAP-002', 'Sneaky', 'Laptop', 'Assigned')$$, 'an asset cannot be created as Assigned', '%Assign / Return%');
select public.assign_asset('as1', :po, public.company_today(), null, 'New, sealed box', null) as asg \gset
select pg_temp.check((select status = 'Assigned' from public.company_assets where id = 'as1'), 'assigning marks the asset Assigned');
select pg_temp.denied(format($$select public.assign_asset('as1', %L, public.company_today())$$, :pso), 'an assigned asset cannot be issued twice', '%not available%');
select pg_temp.denied($$update public.company_assets set status = 'Available' where id = 'as1'$$, 'status cannot skip the return flow', '%Assign / Return%');
update public.company_assets set notes = 'Charger included' where id = 'as1';
select pg_temp.check((select notes = 'Charger included' from public.company_assets where id = 'as1'), 'HR edits asset details');

select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.company_assets where id = 'as1') = 1, 'the employee sees the asset issued to them');
select pg_temp.check((select count(*) from public.asset_assignments where asset_id = 'as1') = 1, 'and its issue record');
select pg_temp.denied($$insert into public.company_assets (asset_tag, name, category) values ('MINE-1', 'Mine', 'Other')$$, 'an employee cannot add assets', '%row-level security%');
select pg_temp.denied($$select public.return_asset('as1', public.company_today())$$, 'an employee cannot record a return', '%Only HR%');
select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.company_assets where id = 'as1') = 0, 'other employees cannot see it');
select pg_temp.check((select count(*) from public.asset_assignments where asset_id = 'as1') = 0, 'nor who holds it');

select pg_temp.act_as(:hr);
select pg_temp.denied($$select public.return_asset('as1', public.company_today() - 400)$$, 'return before issue is rejected', '%before the issue%');
select public.return_asset('as1', public.company_today(), 'Scratch on lid', 'Returned at exit interview', 'In Repair');
select pg_temp.check((select status = 'In Repair' from public.company_assets where id = 'as1')
  and (select returned_on is not null and condition_in = 'Scratch on lid' from public.asset_assignments where id = :'asg'), 'return closes the assignment and sets the status');
select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.company_assets where id = 'as1') = 0, 'a returned asset is no longer listed for the employee');
select pg_temp.check((select count(*) from public.asset_assignments where asset_id = 'as1') = 1, 'their issue history remains');
rollback;

\echo '== employee documents'
begin;
select pg_temp.act_as(:hr);
insert into public.employee_documents (id, employee_id, category, title, file_name, size, mime, storage_path)
  values ('doc1', :po, 'Offer Letter', 'Offer letter 2025', 'offer.pdf', 1200, 'application/pdf', :po || '/doc1.pdf');
select pg_temp.denied(format($$insert into public.employee_documents (employee_id, category, title, file_name, size, mime, storage_path)
  values (%L, 'Other', 'Wrong folder', 'x.pdf', 10, 'application/pdf', %L)$$, :po, :pso || '/x.pdf'), 'the file must sit in the employee''s folder', '%row-level security%');
select pg_temp.trusted();
insert into storage.objects (bucket_id, name) values ('hr-documents', :po || '/doc1.pdf');

select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.employee_documents where id = 'doc1') = 0, 'an unshared document is hidden from the employee');
select pg_temp.denied($$select public.authorize_hr_document('doc1')$$, 'and cannot be downloaded', '%do not have access%');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'hr-documents') = 0, 'nor read from storage');

select pg_temp.act_as(:hr);
update public.employee_documents set visible_to_employee = true where id = 'doc1';
select pg_temp.act_as(:po);
select pg_temp.check((select count(*) from public.employee_documents where id = 'doc1') = 1, 'a shared document is visible to the employee');
select pg_temp.check(public.authorize_hr_document('doc1') = :po || '/doc1.pdf', 'the employee can download it');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'hr-documents') = 1, 'storage allows only their shared file');
select pg_temp.check((select count(*) from public.employee_document_events where employee_id <> auth.uid()) = 0, 'employees read only the history of their own shared documents (0028)');
select pg_temp.denied(format($$insert into public.employee_documents (employee_id, category, title, file_name, size, mime, storage_path)
  values (%L, 'Payslip', 'Self upload', 'x.pdf', 10, 'application/pdf', %L)$$, :po, :po || '/y.pdf'), 'employees cannot upload HR-only document types', '%row-level security%');
update public.employee_documents set title = 'Hacked' where id = 'doc1';
select pg_temp.check((select title from public.employee_documents where id = 'doc1') = 'Offer letter 2025', 'employees cannot edit HR documents');

select pg_temp.act_as(:pso);
select pg_temp.check((select count(*) from public.employee_documents where id = 'doc1') = 0, 'another employee cannot see it');
select pg_temp.denied($$select public.authorize_hr_document('doc1')$$, 'or download it', '%do not have access%');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'hr-documents') = 0, 'or read the file');
select pg_temp.act_as(:mgr);
select pg_temp.check((select count(*) from public.employee_documents where id = 'doc1') = 0, 'a manager cannot see a team member''s HR documents');
select pg_temp.act_as(:partner);
select pg_temp.check((select count(*) from public.employee_documents) = 0, 'partner users see no HR documents');

select pg_temp.act_as(:hr);
select pg_temp.denied($$update public.employee_documents set storage_path = 'x/y.pdf' where id = 'doc1'$$, 'a stored file cannot be swapped', '%cannot be replaced%');
select pg_temp.denied($$update public.employee_documents set status = 'Archived' where id = 'doc1'$$, 'archiving needs a reason', '%reason%');
update public.employee_documents set status = 'Archived', archive_reason = 'Superseded by new contract' where id = 'doc1';
select pg_temp.check((select status = 'Archived' and not visible_to_employee and archived_by = :hr from public.employee_documents where id = 'doc1'), 'archiving hides it from the employee');
delete from public.employee_documents where id = 'doc1';
select pg_temp.check(exists (select 1 from public.employee_documents where id = 'doc1'), 'HR cannot delete a document');
select pg_temp.check((select array_agg(action order by id) from public.employee_document_events where document_id = 'doc1')
  = array['uploaded', 'shared', 'downloaded', 'archived'], 'history: uploaded, shared, downloaded, archived');
select pg_temp.act_as(:po);
select pg_temp.denied($$select public.authorize_hr_document('doc1')$$, 'an archived document cannot be downloaded by the employee', '%do not have access%');
rollback;
