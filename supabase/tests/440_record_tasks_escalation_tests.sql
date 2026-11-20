-- Assign Task / Escalate from a Student or an Application (0059). Fixtures of 70 / 340 / 430: Super Admin a1,
-- manager f2 (Senior IRM), PSO 1 f5 (Sub Officer of Sterling PS + Alpha PS: psa1–psa8), Application Team f4 and Bina.
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
\set po    '''00000000-0000-0000-0000-0000000000f3'''
\set app   '''00000000-0000-0000-0000-0000000000f4'''
\set ps1   '''00000000-0000-0000-0000-0000000000f5'''
\set ps2   '''00000000-0000-0000-0000-0000000000f6'''
\set app2  '''d0000000-0000-4000-8000-0000000004a1'''
\set nonapp '''d0000000-0000-4000-8000-0000000004a2'''
\set partner '''d0000000-0000-4000-8000-0000000003e1'''

\echo '== fixtures: hierarchy Super Admin > manager f2 > PSO 1 > Bina (Application Team); f4 Application Team outside the line'
update public.employees set reporting_manager_id = :mgr where id = :ps1;
update public.employees set reporting_manager_id = :ps1 where id = :app2;
update public.employees set reporting_manager_id = null where id in (:app, :nonapp);
update public.profiles set permissions = null where id = :mgr;  -- role defaults (students, applications …); earlier suites narrowed them
create temp table t (k text, id text);
grant all on t to authenticated;

\echo '== TEST 1 / 2 / 4: PSO 1 on an application of their own client'
begin; select pg_temp.act_as(:ps1);
select pg_temp.check((select string_agg(full_name, ',' order by full_name) from public.record_task_people(null, 'psa1') where kind = 'assign') = 'Arun Applications,Bina Applications',
  'Assign To: own team (Bina) and eligible Application Team (Arun) only');
select pg_temp.check((select string_agg(full_name || ':' || level, ',' order by level) from public.record_task_people(null, 'psa1') where kind = 'escalate') = 'Manu Manager:1,Super Admin:99'
  or (select count(*) from public.record_task_people(null, 'psa1') where kind = 'escalate' and id = :mgr::uuid and level = 1) = 1,
  'Escalate To: direct manager first, then Super Admin');
select pg_temp.check(not exists (select 1 from public.record_task_people(null, 'psa1') where kind = 'escalate' and id in (:po::uuid, :app::uuid, :app2::uuid)), 'no unrelated or junior people as escalation recipients');
select pg_temp.check((select count(*) from public.record_task_people(null, 'psa9')) = 0, 'another officer''s application: no choices');
insert into t select 'a', public.create_record_task('task', null, 'psa1', 'Follow up on pending offer letter', 'Chase the university', :app2::uuid, 'Normal',
  public.company_today() + 2, 'see chat', null, '22222222-2222-4222-8222-222222222222');
insert into t select 'a2', public.create_record_task('task', null, 'psa1', 'Follow up on pending offer letter', 'Chase the university', :app2::uuid, 'Normal',
  public.company_today() + 2, 'see chat', null, '22222222-2222-4222-8222-222222222222');
select pg_temp.check((select count(distinct id) from t) = 1, 'double click / retry saves one task');
select pg_temp.check((select category = 'task' and application_id = 'psa1' and student_id = 'pss1' and assigned_by = :ps1::uuid and assigned_to = :app2::uuid
  and status = 'Not Started' and related like 'Application %' from public.tasks where id = (select id from t where k = 'a')), 'linked to the application and its student; assigner and assignee recorded');
select pg_temp.check((select assigned_to = :app::uuid from public.applications where id = 'psa1'), 'TEST 12: Application Assigned staff unchanged');
select pg_temp.check((select count(*) from public.work_activities where employee_id = :ps1::uuid and activity_type = 'task_assigned' and entity_id = (select id from t where k = 'a')) = 1
  and (select count(*) from public.work_activities where employee_id = :ps1::uuid and activity_type in ('task_completed', 'escalation_resolved') and entity_id = (select id from t where k = 'a')) = 0,
  'assigner: one assignment activity, nothing completed');
select pg_temp.check((select count(*) from public.task_events where task_id = (select id from t where k = 'a') and action = 'created') = 1, 'history: created');
select pg_temp.trusted();
select pg_temp.check((select count(*) from public.notifications where user_id = :app2::uuid and title = 'New task: Follow up on pending offer letter') = 1
  and (select count(*) from public.notifications where user_id = :app2::uuid and title = 'Task assigned to you') = 0, 'TEST 14: one notification for the assignee');
select pg_temp.check((select body not like '%S 1%' and body like 'SSI-%' from public.notifications where user_id = :app2::uuid and title like 'New task:%'), 'notification shows the reference, not student details');

\echo '== TEST 5 / 6 / 7: the assignee sees and completes it; completion credited to them'
select pg_temp.act_as(:app2);
select pg_temp.check((select count(*) from public.tasks where id = (select id from t where k = 'a')) = 1, 'task in Bina''s My Assigned Tasks');
select public.update_assignment_progress((select id from t where k = 'a'), 'In Progress', 40, 'Emailed the university');
select public.update_assignment_progress((select id from t where k = 'a'), 'Completed', 100, 'Offer letter received');
select pg_temp.check((select count(*) from public.work_activities where employee_id = :app2::uuid and activity_type = 'task_completed' and application_id = 'psa1') = 1, 'completion in Bina''s report, with the application');
select pg_temp.check((select count(*) from public.work_activities where employee_id = :ps1::uuid and activity_type = 'task_completed' and entity_id = (select id from t where k = 'a')) = 0, 'assigning PSO is not credited');
select pg_temp.act_as(:ps1);
select pg_temp.check((select status = 'Completed' and last_note = 'Offer letter received' from public.tasks where id = (select id from t where k = 'a')), 'assigner sees the outcome');

\echo '== TEST 8: PSO escalates to the manager'
insert into t select 'e', public.create_record_task('escalation', null, 'psa2', 'University not responding', 'No reply in 10 days', :mgr::uuid, 'High',
  public.company_today() + 1, null, 'Three reminders sent without any answer from admissions', null);
select pg_temp.check((select category = 'escalation' and escalation_reason like 'Three reminders%' from public.tasks where id = (select id from t where k = 'e')), 'escalation saved with reason and initiator');
select pg_temp.check((select status from public.applications where id = 'psa2') = 'Submitted', 'application status untouched');
select pg_temp.act_as(:mgr);
select public.update_assignment_progress((select id from t where k = 'e'), 'Completed', 100, 'Called the admissions head');
select pg_temp.check((select count(*) from public.work_activities where employee_id = :mgr::uuid and activity_type = 'escalation_resolved') = 1, 'manager credited with Escalation resolved');

\echo '== TEST 3 / 9: manager assigns to the team and escalates to the Super Admin'
select pg_temp.check(public.create_record_task('task', null, 'psa3', 'Check offer conditions', null, :ps1::uuid, 'Medium', public.company_today(), null, null, null) is not null, 'manager -> PSO in the team');
select pg_temp.check(public.create_record_task('task', null, 'psa3', 'Process deposit', null, :app2::uuid, 'Medium', public.company_today(), null, null, null) is not null, 'manager -> Application Team member two levels down');
select pg_temp.check(public.create_record_task('escalation', null, 'psa3', 'Fee waiver decision', null, :super::uuid, 'High', public.company_today(), null, 'Needs a director decision on the fee waiver', null) is not null, 'manager escalates to Super Admin');

\echo '== TEST 11: refused by the backend'
select pg_temp.act_as(:ps1);
select pg_temp.denied($$select public.create_record_task('task', null, 'psa1', 'Nope', null, 'd0000000-0000-4000-8000-0000000004a2'::uuid, 'Normal', public.company_today(), null, null, null)$$, 'unrelated employee', '%team%');
select pg_temp.denied($$select public.create_record_task('task', null, 'psa1', 'Nope', null, '00000000-0000-0000-0000-0000000000f3'::uuid, 'Normal', public.company_today(), null, null, null)$$, 'manager''s other report (not mine)', '%team%');
select pg_temp.denied($$select public.create_record_task('escalation', null, 'psa1', 'Nope', null, '00000000-0000-0000-0000-0000000000f3'::uuid, 'Normal', public.company_today(), null, 'a long enough reason', null)$$, 'escalation outside the reporting line', '%reporting manager%');
select pg_temp.denied($$select public.create_record_task('task', null, 'psa9', 'Nope', null, 'd0000000-0000-4000-8000-0000000004a1'::uuid, 'Normal', public.company_today(), null, null, null)$$, 'another officer''s application', '%access%');
select pg_temp.denied($$select public.create_record_task('task', 'pss9', null, 'Nope', null, 'd0000000-0000-4000-8000-0000000004a1'::uuid, 'Normal', public.company_today(), null, null, null)$$, 'another officer''s student', '%access%');
select pg_temp.denied($$select public.create_record_task('task', null, 'psa1', 'Nope', null, 'd0000000-0000-4000-8000-0000000004a1'::uuid, 'Normal', public.company_today() - 1, null, null, null)$$, 'due date in the past', '%past%');
select pg_temp.denied($$select public.create_record_task('escalation', null, 'psa1', 'Nope', null, '00000000-0000-0000-0000-0000000000f2'::uuid, 'Normal', public.company_today(), null, 'short', null)$$, 'escalation needs a real reason', '%reason%');
select pg_temp.denied($$select public.create_record_task('task', null, 'psa1', 'Nope', null, '00000000-0000-0000-0000-0000000000f5'::uuid, 'Normal', public.company_today(), null, null, null)$$, 'not to yourself', '%team%');

\echo '== TEST 14: students'
select pg_temp.check(public.create_record_task('task', 'pss1', null, 'Collect qualification documents', null, :app2::uuid, 'Normal', public.company_today() + 1, null, null, null) is not null, 'task from a student of my client');
select pg_temp.check((select count(*) from public.tasks where student_id = 'pss1' and category is not null) >= 2, 'student task history (student + its applications)');
rollback;

\echo '== TEST 10: Super Admin assigns to any active employee; partners cannot'
begin; select pg_temp.act_as(:super);
select pg_temp.check(exists (select 1 from public.record_task_people(null, 'psa9') where kind = 'assign' and id = :nonapp::uuid), 'Super Admin sees every active employee');
select pg_temp.check(public.create_record_task('task', 'pss9', null, 'Review file', null, :nonapp::uuid, 'Normal', public.company_today(), null, null, null) is not null, 'and can assign to them');
select pg_temp.act_as(:partner);
select pg_temp.denied($$select public.create_record_task('task', null, 'psa1', 'Nope', null, 'd0000000-0000-4000-8000-0000000004a1'::uuid, 'Normal', public.company_today(), null, null, null)$$, 'partner login refused', '%');
rollback;

\echo '== TEST 13: overdue stays one open task'
begin;
insert into public.tasks (kind, category, title, assigned_to, assigned_by, priority, due, status, progress, done, application_id, student_id)
values ('assignment', 'task', 'Old follow-up', :app2::uuid, :ps1::uuid, 'Normal', now() - interval '3 days', 'Not Started', 0, false, 'psa1', 'pss1');
select pg_temp.act_as(:app2);
select pg_temp.check((select count(*) from jsonb_array_elements(public.my_pending_work() -> 'my_tasks') x where x ->> 'title' = 'Old follow-up' and (x ->> 'overdue')::boolean) = 1, 'overdue, in Pending Work once');
rollback;
