-- Application assignment by Partner Success Officers, Super Admin-only deletion, manual tasks (0058).
-- Uses the fixtures of 340: PSO 1 (f5) is Sub Officer of Sterling PS + Alpha PS (psa1–psa8),
-- PSO 2 (f6) of Beta PS (psa9, psa10); all ten applications are assigned to Application Team member f4.
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
create or replace function pg_temp.affected(stmt text) returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
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

\set super '''00000000-0000-0000-0000-0000000000a1'''
\set staff '''00000000-0000-0000-0000-0000000000a2'''
\set mgr   '''00000000-0000-0000-0000-0000000000f2'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''
\set ps1   '''00000000-0000-0000-0000-0000000000f5'''
\set ps2   '''00000000-0000-0000-0000-0000000000f6'''
\set app2  '''d0000000-0000-4000-8000-0000000004a1'''
\set nonapp '''d0000000-0000-4000-8000-0000000004a2'''
\set gone  '''d0000000-0000-4000-8000-0000000004a3'''
\set partner '''d0000000-0000-4000-8000-0000000003e1'''

\echo '== fixtures: a second Application Team member, one without Applications access, one deactivated'
insert into auth.users (id, email) values (:app2, 'app2@ssi.test'), (:nonapp, 'nonapp@ssi.test'), (:gone, 'gone@ssi.test');
insert into public.profiles (id, role, full_name, status, permissions) values
  (:app2, 'application_manager', 'Bina Applications', 'active', null),
  (:nonapp, 'support_staff', 'Kiran NoApps', 'active', '{partners,students,updates,tasks}'),
  (:gone, 'application_manager', 'Old Applications', 'deactivated', null);
insert into public.employees (id, employee_code, designation_id, department_id, joining_date, employment_status, shift_id) values
  (:app2, 'SSI-T41', 'application_team', 'applications', '2025-01-01', 'Active', 'standard'),
  (:nonapp, 'SSI-T42', 'application_team', 'applications', '2025-01-01', 'Active', 'standard'),
  (:gone, 'SSI-T43', 'application_team', 'applications', '2025-01-01', 'Active', 'standard');
-- earlier suites narrowed Arun's permissions; give back the Application Team defaults
update public.profiles set permissions = null where id = :app;

\echo '== TEST 1 / 2: Assigned staff choices for a PSO'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check(public.can_assign_application('psa1'), 'PSO 1 may assign an application of their own client');
select pg_temp.check((select string_agg(full_name, ',' order by full_name) from public.application_assignees('psa1')) = 'Arun Applications,Bina Applications',
  'both eligible Application Team members listed; no Application access / deactivated / other staff excluded');
select pg_temp.check((select open_applications from public.application_assignees('psa1') where id = :app::uuid) = 10, 'current workload shown');
select pg_temp.check(not public.can_assign_application('psa9') and (select count(*) from public.application_assignees('psa9')) = 0,
  'another officer''s client: not assignable, no choices');
rollback;

\echo '== TEST 3 / 5: assign and reassign; history kept; employee notified'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((public.assign_application('psa1', :app2::uuid, 'Workload balance') ->> 'changed')::boolean, 'PSO 1 reassigns psa1 to Bina');
select pg_temp.check((select assigned_to = :app2::uuid from public.applications where id = 'psa1'), 'saved on the application');
select pg_temp.check((public.assign_application('psa1', :app::uuid) ->> 'changed')::boolean, 'and back to Arun (reassignment)');
select pg_temp.check((select count(*) from public.application_assignment_history where application_id = 'psa1' and at = now()) = 2, 'two history rows (none lost)');
select pg_temp.check((select previous_staff = :app::uuid and new_staff = :app2::uuid and assigned_by = :ps1::uuid and reason = 'Workload balance' and application_ref = (select ref from public.applications where id = 'psa1')
  from public.application_assignment_history where application_id = 'psa1' and at = now() order by id limit 1), 'history: reference, previous, new, by whom, reason');
select pg_temp.check(not (public.assign_application('psa1', :app::uuid) ->> 'changed')::boolean, 'saving the same person again changes nothing');
select pg_temp.check((select count(*) from public.application_assignment_history where application_id = 'psa1' and at = now()) = 2, 'and writes no extra history');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where user_id = :app2::uuid and kind = 'assignment' and body like (select ref from public.applications where id = 'psa1') || '%') = 1, 'Bina was notified');
select pg_temp.act_as(:app2);
select pg_temp.check((select count(*) from public.application_assignment_history where application_id = 'psa1' and at = now()) = 2, 'Application Team can read the history');
rollback;

\echo '== TEST 6: unauthorised assignments are refused by the backend'
begin; select pg_temp.act_as(:ps1);
select pg_temp.denied($$select public.assign_application('psa9', '00000000-0000-0000-0000-0000000000f4'::uuid)$$, 'PSO 1 cannot assign PSO 2''s client application', '%own clients%');
select pg_temp.denied($$select public.assign_application('psa1', 'd0000000-0000-4000-8000-0000000004a2'::uuid)$$, 'not Application Team-eligible (no Applications access)', '%Application Team%');
select pg_temp.denied($$select public.assign_application('psa1', 'd0000000-0000-4000-8000-0000000004a3'::uuid)$$, 'deactivated employee', '%Application Team%');
select pg_temp.denied($$select public.assign_application('psa1', '00000000-0000-0000-0000-0000000000f2'::uuid)$$, 'other staff (not Application Team)', '%Application Team%');
select pg_temp.denied($$select public.assign_application('psa1', null)$$, 'PSO cannot clear the assignment', '%Only Admin%');
select pg_temp.denied($$update public.applications set assigned_to = 'd0000000-0000-4000-8000-0000000004a1' where id = 'psa1'$$, 'direct table update is refused', '%Assigned staff%');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.denied($$select public.assign_application('psa1', 'd0000000-0000-4000-8000-0000000004a1'::uuid)$$, 'Application Team cannot reassign', '%own clients%');
rollback;
begin; select pg_temp.act_as(:partner);
select pg_temp.denied($$select public.assign_application('psa1', 'd0000000-0000-4000-8000-0000000004a1'::uuid)$$, 'partner logins cannot assign', '%');
rollback;

\echo '== Admin keeps full control'
begin; select pg_temp.act_as(:super);
select pg_temp.check((select count(*) from public.application_assignees('psa9')) >= 3, 'Super Admin sees all active staff for any application');
select pg_temp.check((public.assign_application('psa9', :mgr::uuid) ->> 'changed')::boolean, 'Super Admin can assign any active employee');
select pg_temp.check((public.assign_application('psa9', null) ->> 'changed')::boolean, 'and clear it');
update public.applications set assigned_to = :app2::uuid where id = 'psa10';
select pg_temp.check((select count(*) from public.application_assignment_history where application_id = 'psa10' and assigned_by = :super::uuid) = 1, 'direct admin change is also in the history');
rollback;

\echo '== TEST 4: the assigned employee sees it'
begin; select pg_temp.act_as(:ps1); select public.assign_application('psa2', :app2::uuid); select pg_temp.act_as(:app2);
select pg_temp.check((select count(*) from public.applications where id = 'psa2' and assigned_to = auth.uid()) = 1, 'psa2 is in Bina''s assigned work');
rollback;

\echo '== TEST 7 / 8 / 9: permanent deletion is Super Admin only'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check(pg_temp.affected($q$delete from public.applications where id = 'psa1'$q$) = 0, 'PSO cannot delete an application');
select pg_temp.check(pg_temp.affected($q$delete from public.students where id = 'pss1'$q$) = 0, 'PSO cannot delete a student');
select pg_temp.check(pg_temp.affected($q$delete from public.courses where id = 'cps'$q$) = 0, 'PSO cannot delete a course');
rollback;
begin; select pg_temp.act_as(:app);
select pg_temp.check(pg_temp.affected($q$delete from public.applications where id = 'psa1'$q$) = 0, 'Application Team cannot delete an application');
select pg_temp.check(pg_temp.affected($q$delete from public.documents$q$) = 0, 'Application Team cannot delete documents');
rollback;
begin; update public.profiles set permissions = null where id = :staff; -- Admin Staff defaults (catalogue, finance, applications …)
select pg_temp.act_as(:staff);
select pg_temp.check(pg_temp.affected($q$delete from public.applications$q$) = 0, 'Admin Staff cannot delete applications');
select pg_temp.check(pg_temp.affected($q$delete from public.universities where id = 'ups'$q$) = 0, 'Admin Staff cannot delete a university');
select pg_temp.check(pg_temp.affected($q$delete from public.payments$q$) = 0, 'Admin Staff cannot delete payments');
select pg_temp.check(pg_temp.affected($q$delete from public.assessments$q$) = 0, 'Admin Staff cannot delete assessments');
select pg_temp.check(pg_temp.affected($q$update public.universities set name = name where id = 'ups'$q$) = 1, 'Admin Staff can still edit the catalogue');
select pg_temp.check((select count(*) from public.courses where id = 'cps') = 1, 'and still read it');
rollback;
begin; select pg_temp.act_as(:partner);
select pg_temp.check(pg_temp.affected($q$delete from public.applications where partner_id = 'ps-st'$q$) = 0, 'partner login cannot delete its applications');
select pg_temp.check(pg_temp.affected($q$delete from public.students where partner_id = 'ps-st'$q$) = 0, 'partner login cannot delete its students');
rollback;
begin; select pg_temp.act_as(:ps1);
insert into public.tasks (title, kind, assigned_to, due) values ('Own reminder', 'task', :ps1::uuid, now() + interval '1 day');
select pg_temp.check(pg_temp.affected($q$delete from public.tasks where title = 'Own reminder'$q$) = 0, 'employees cannot permanently delete even their own tasks');
select pg_temp.check(pg_temp.affected($q$update public.tasks set done = true where title = 'Own reminder'$q$) = 1, 'but can still complete them');
rollback;
begin; select pg_temp.act_as(:super);
select pg_temp.denied($$delete from public.students where id = 'pss3'$$, 'a student with applications is not deleted silently', '%Delete the applications first%');
select pg_temp.check(pg_temp.affected($q$delete from public.applications where id = 'psa3'$q$) = 1, 'Super Admin can delete an application');
select pg_temp.check(pg_temp.affected($q$delete from public.students where id = 'pss3'$q$) = 1, 'then the student');
rollback;

\echo '== TEST 10–16: manual Pending Work and Tomorrow''s Plan tasks'
begin; select pg_temp.act_as(:ps1);
create temp table ids (k text, id text) on commit drop;
grant all on ids to authenticated;
insert into ids select 'pending', public.save_my_task(null, 'Call Sterling about documents', 'Missing transcripts', 'High', null, null, 'Sterling PS', 'ask for scans', 'pending_work', '11111111-1111-4111-8111-111111111111');
insert into ids select 'again', public.save_my_task(null, 'Call Sterling about documents', 'Missing transcripts', 'High', null, null, 'Sterling PS', 'ask for scans', 'pending_work', '11111111-1111-4111-8111-111111111111');
select pg_temp.check((select count(distinct id) from ids) = 1, 'the same request saves one task (no duplicates on retry)');
insert into ids select 'plan', public.save_my_task(null, 'Contact Sterling Education regarding pending documents', null, 'Medium', null, null, 'Sterling PS', null, 'tomorrows_plan', null);
select pg_temp.check((select start_date = (public.my_pending_work() ->> 'next_day')::date and status = 'Not Started' and assigned_by = auth.uid() and assigned_to = auth.uid()
  from public.tasks where id = (select id from ids where k = 'plan')), 'Tomorrow''s Plan defaults to the next working day, open, own task');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.my_pending_work() -> 'my_tasks') x where x ->> 'id' = (select id from ids where k = 'pending') and (x ->> 'manual')::boolean),
  'manual task in Pending Work, flagged manual');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_pending_work() -> 'my_tasks') x where x ->> 'id' = (select id from ids where k = 'plan')),
  'planned task is not actionable today');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.my_pending_work() -> 'tomorrow') x where x ->> 'task_id' = (select id from ids where k = 'plan')),
  'planned task is in Tomorrow''s Plan');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.my_pending_work((public.my_pending_work() ->> 'next_day')::date) -> 'my_tasks') x
  where x ->> 'id' = (select id from ids where k = 'plan')), 'on the planned day the same task is actionable (TEST 13)');
select pg_temp.check((select count(*) from public.work_activities where employee_id = auth.uid() and activity_type = 'task_completed') = 0, 'adding tasks counts nothing as completed');
select pg_temp.denied($$select public.save_my_task(null, 'Backdated', null, 'Normal', null, current_date - 30, null, null, 'tomorrows_plan', null)$$, 'planned date cannot be in the past', '%past%');
select public.save_my_task((select id from ids where k = 'plan'), 'Contact Sterling Education regarding pending documents', 'Edited', 'High', null, null, 'Sterling PS', 'n', 'tomorrows_plan', null);
select pg_temp.check((select priority = 'High' and description = 'Edited' from public.tasks where id = (select id from ids where k = 'plan')), 'own task can be edited');
-- TEST 14: complete once, counted once
select public.update_assignment_progress((select id from ids where k = 'pending'), 'Completed', 100, 'Called — scans on the way');
select public.update_assignment_progress((select id from ids where k = 'pending'), 'Completed', 100, null);
select pg_temp.check((select count(*) from public.work_activities where employee_id = auth.uid() and activity_type = 'task_completed' and entity_id = (select id from ids where k = 'pending')) = 1,
  'completion recorded once');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_pending_work() -> 'my_tasks') x where x ->> 'id' = (select id from ids where k = 'pending')), 'completed task leaves Pending Work');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and title like 'Work completed%') = 0, 'no notification to yourself');
select public.cancel_my_task((select id from ids where k = 'plan'), 'Not needed any more');
select pg_temp.check((select status = 'Cancelled' and not done from public.tasks where id = (select id from ids where k = 'plan')), 'cancelled is kept and distinct from completed');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_pending_work() -> 'tomorrow') x where x ->> 'task_id' = (select id from ids where k = 'plan')), 'cancelled task leaves Tomorrow''s Plan');
select pg_temp.check((select count(*) from public.task_events where task_id in (select id from ids)) >= 5, 'task history kept');
-- TEST 17: another employee
select pg_temp.act_as(:ps2);
select pg_temp.check((select count(*) from public.tasks where id in (select id from ids)) = 0, 'PSO 2 cannot see PSO 1''s tasks');
select pg_temp.denied(format($$select public.save_my_task(%L, 'Hijack', null, 'Normal', null, null, null, null, 'pending_work', null)$$, (select id from ids where k = 'pending')), 'cannot edit someone else''s task', '%');
select pg_temp.act_as(:nonapp);
select pg_temp.check(public.my_pending_work() ? 'my_tasks', 'every employee gets Pending Work (no agency or lead access needed)');
select pg_temp.check(public.save_my_task(null, 'Plan the week', null, 'Normal', null, null, null, null, 'tomorrows_plan', null) is not null, 'and can plan tasks');
commit;
